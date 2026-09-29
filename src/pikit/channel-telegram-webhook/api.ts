/**
 * The few Telegram Bot API methods this channel uses (https://core.telegram.org/bots/api), over
 * `fetch`. A thin client of our own rather than a library: a handful of methods, and every byte of it
 * is readable in the project that owns it.
 *
 * Copied from channel-telegram's `api.ts` (components never import each other, C6), with the webhook's
 * methods added: `setWebhook`, `deleteWebhook`, and `getWebhookInfo`'s other fields. `getUpdates`
 * stays for `pikit configure`, which reads the first message to the bot before a webhook is set.
 *
 * The bot token is part of every URL (`/bot<token>/<method>`), so a URL is never logged and an
 * error never quotes one: `TelegramError` carries the method, Telegram's code and description only.
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** A Bot API call that failed: Telegram's answer, or no answer at all (`code` 0). */
export class TelegramError extends Error {
  constructor(
    readonly method: string,
    /** Telegram's `error_code` (401 bad token, 409 conflict, 429 too many requests…), or 0 when unreachable. */
    readonly code: number,
    description: string,
    /** Seconds Telegram asks to wait, with a 429. */
    readonly retryAfter?: number,
  ) {
    super(`telegram ${method}: ${code === 0 ? "unreachable" : code} ${description}`);
    this.name = "TelegramError";
  }
}

/** What `getWebhookInfo` says about the bot's webhook; `url` is empty when there is none. */
export interface WebhookInfo {
  url: string;
  pending_update_count?: number;
  allowed_updates?: string[];
  /** Why Telegram's last delivery to the webhook failed, if it did. */
  last_error_message?: string;
}

export interface TelegramApi {
  getMe(signal?: AbortSignal): Promise<TelegramUser>;
  /** Long polling: waits up to `timeout` seconds for updates after `offset`, and confirms the ones before it. */
  getUpdates(options: { offset?: number; timeout: number }, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  getWebhookInfo(signal?: AbortSignal): Promise<WebhookInfo>;
  /** Telegram posts the bot's updates of `allowedUpdates` to `url`, with `secretToken` in `X-Telegram-Bot-Api-Secret-Token`. */
  setWebhook(options: { url: string; secretToken: string; allowedUpdates: string[] }, signal?: AbortSignal): Promise<void>;
  /** No webhook: the bot's updates wait for `getUpdates` again. Pending updates are kept. */
  deleteWebhook(signal?: AbortSignal): Promise<void>;
  /** The message Telegram created: its `message_id` is what an edit or a delete needs. */
  sendMessage(chatId: number, text: string, options?: { html?: boolean }, signal?: AbortSignal): Promise<{ message_id: number }>;
  sendChatAction(chatId: number, action: "typing", signal?: AbortSignal): Promise<void>;
}

export function createTelegramApi(token: string, apiBase: string, fetcher: typeof fetch = fetch): TelegramApi {
  const call = async <T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
    let response: Response;
    try {
      response = await fetcher(`${apiBase.replace(/\/+$/, "")}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(signal !== undefined && { signal }),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      // A network error's message can quote the URL, which holds the token: never pass it on.
      throw new TelegramError(method, 0, error instanceof Error ? error.name : "network error");
    }
    const answer = (await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }))) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (!answer.ok) throw new TelegramError(method, answer.error_code ?? response.status, answer.description ?? "", answer.parameters?.retry_after);
    return answer.result as T;
  };

  return {
    getMe: (signal) => call("getMe", {}, signal),
    getUpdates: ({ offset, timeout }, signal) =>
      call("getUpdates", { timeout, allowed_updates: ["message"], ...(offset !== undefined && { offset }) }, signal),
    getWebhookInfo: (signal) => call("getWebhookInfo", {}, signal),
    setWebhook: ({ url, secretToken, allowedUpdates }, signal) => call("setWebhook", { url, secret_token: secretToken, allowed_updates: allowedUpdates }, signal),
    deleteWebhook: (signal) => call("deleteWebhook", {}, signal),
    sendMessage: (chatId, text, options = {}, signal) =>
      call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, ...(options.html === true && { parse_mode: "HTML" }), link_preview_options: { is_disabled: true } }, signal),
    sendChatAction: (chatId, action, signal) => call("sendChatAction", { chat_id: chatId, action }, signal),
  };
}

/** `https://t.me/<username>`: where a person opens a chat with the bot. */
export function botLink(bot: TelegramUser): string {
  return bot.username === undefined ? "Telegram" : `https://t.me/${bot.username}`;
}

/** The ids in `TELEGRAM_ALLOWED_USERS`: numbers separated by commas or spaces. */
export function parseAllowedUsers(value: string | undefined): Set<number> | Error {
  const parts = (value ?? "").split(/[\s,]+/).filter((part) => part !== "");
  const ids = new Set<number>();
  for (const part of parts) {
    if (!/^\d{1,20}$/.test(part)) return new Error(`TELEGRAM_ALLOWED_USERS: "${part}" is not a Telegram user id (a number)`);
    ids.add(Number(part));
  }
  return ids;
}
