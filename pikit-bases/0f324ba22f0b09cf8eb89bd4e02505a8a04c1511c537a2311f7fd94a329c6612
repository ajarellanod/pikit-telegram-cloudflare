/**
 * A fake Telegram Bot API for this channel's tests, served on a free local port: no bot, token or
 * network needed. Copied from channel-telegram's `fake-telegram.test-support.ts` and extended with the webhook:
 *
 * - `setWebhook`, `getWebhookInfo` and `deleteWebhook`, with Telegram's rules: a secret of `A-Z a-z
 *   0-9 _ -` only, and `getUpdates` refused (409) while a webhook is set;
 * - `write(user, text)`: a user writes to the bot, and the fake posts the update to the webhook with
 *   its secret, as Telegram does; `post(update)` posts one again (Telegram retrying a delivery that was
 *   not answered 2xx, with the same `update_id`);
 * - `say(user, text)` keeps the long polling side, for `pikit configure`'s first message.
 *
 * Test support: only tests import it (`*.test-support.ts`), so it never reaches a Worker's bundle.
 */

import type { TelegramUpdate, TelegramUser } from "./api.ts";

export interface SentMessage {
  chatId: number;
  text: string;
  html: boolean;
}

type Sender = Partial<TelegramUser> & { id: number };
type MessageOptions = { chat?: "private" | "group"; caption?: string };

export interface FakeTelegram {
  /** The `apiBase` to configure. */
  url: string;
  token: string;
  bot: TelegramUser;
  /** A user sends `text` in their private chat with the bot (chat id = user id), for `getUpdates`. Returns the update id. */
  say(user: Sender, text: string | undefined, options?: MessageOptions): number;
  /** The update a user's message makes, with the next ids; nothing is delivered. */
  message(user: Sender, text: string | undefined, options?: MessageOptions): TelegramUpdate;
  /** A user writes to the bot: the update is posted to the webhook. Resolves with the webhook's status. */
  write(user: Sender, text: string | undefined, options?: MessageOptions): Promise<{ update: TelegramUpdate; status: number }>;
  /**
   * Posts `update` to the webhook with its secret (or `secret`: `null` sends none), as Telegram does;
   * resolves with the status. Throws when no webhook is set.
   */
  post(update: TelegramUpdate, options?: { secret?: string | null }): Promise<number>;
  sent: SentMessage[];
  actions: { chatId: number; action: string }[];
  /** Resolves once `count` messages were sent. */
  sentCount(count: number, timeoutMs?: number): Promise<SentMessage[]>;
  /** The webhook `setWebhook` registered (`""` for none), its secret and its updates. */
  webhookUrl: string;
  webhookSecret: string | undefined;
  allowedUpdates: string[] | undefined;
  /** How many times `setWebhook` was called. */
  webhooksSet: number;
  /** How many times `getWebhookInfo` was called. */
  webhookInfoAsked: number;
  rejectHtml: boolean;
  rateLimitNextSend?: number;
  /** The next `sendMessage` fails with this Telegram error (403 blocked, 500…). */
  failNextSend?: { code: number; description: string };
  /** Every `sendMessage` fails with this Telegram error while it is set: an outage. `attempts` counts them. */
  failSends?: { code: number; description: string; attempts: number };
  /** The next sends to a chat fail with a 502, as many as its count: a platform failing for one chat. */
  failChat: Map<number, number>;
  /**
   * The next send to a chat in it reaches the chat (it is in `sent`) but is never answered, until the
   * request is given up or the server stops: a send cut after it left.
   */
  hangChat: Set<number>;
  /** Updates Telegram still holds for `getUpdates` (not confirmed by an offset). */
  pending(): TelegramUpdate[];
  /**
   * Another bot on the same server (the same `apiBase`, as every account of the channel uses): its
   * own token, updates, webhook and sent messages. `stop()` on any bot stops the server.
   */
  addBot(token: string, bot: TelegramUser): FakeTelegram;
  stop(): Promise<void>;
}

type Handler = (method: string, request: Request) => Promise<Response>;

export function startFakeTelegram(): FakeTelegram {
  const handlers = new Map<string, Handler>();
  const endPolls: (() => void)[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const match = /^\/bot([^/]+)\/(\w+)$/.exec(new URL(request.url).pathname);
      if (match === null) return fail(404, "Not Found");
      const [, given = "", method = ""] = match;
      // As the real Bot API: a path that is not a token's shape is not found; a wrong token is refused.
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(given)) return fail(404, "Not Found");
      const handle = handlers.get(given);
      if (handle === undefined) return fail(401, "Unauthorized");
      return await handle(method, request);
    },
  });
  const shared: Shared = {
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      for (const end of endPolls) end();
      await server.stop(true);
    },
    add(token, bot) {
      const { fake, handle, endPoll } = fakeBot(token, bot, shared);
      handlers.set(token, handle);
      endPolls.push(endPoll);
      return fake;
    },
  };
  return shared.add("123456789:fake-token-for-tests", { id: 4242, is_bot: true, first_name: "Test Bot", username: "pikit_test_bot" });
}

interface Shared {
  url: string;
  stop(): Promise<void>;
  add(token: string, bot: TelegramUser): FakeTelegram;
}

const ok = (result: unknown) => Response.json({ ok: true, result });
const fail = (code: number, description: string, extra: Record<string, unknown> = {}) =>
  Response.json({ ok: false, error_code: code, description, ...extra }, { status: code });

/** One bot's state, and the handler of its requests. */
function fakeBot(token: string, bot: TelegramUser, shared: Shared): { fake: FakeTelegram; handle: Handler; endPoll(): void } {
  const updates: TelegramUpdate[] = [];
  let nextUpdate = 1;
  let nextMessage = 1;
  let wake: (() => void) | undefined;
  /** The long poll in progress; a new `getUpdates` ends it with 409, as Telegram does. */
  let polling: ((conflict: Response) => void) | undefined;
  const sentWaiters = new Set<() => void>();
  /** The sends left hanging (`hangChat`): the server's stop ends them. */
  const hung = new Set<() => void>();

  const fake: FakeTelegram = {
    url: shared.url,
    token,
    bot,
    sent: [],
    actions: [],
    webhookUrl: "",
    webhookSecret: undefined,
    allowedUpdates: undefined,
    webhooksSet: 0,
    webhookInfoAsked: 0,
    rejectHtml: false,
    failChat: new Map(),
    hangChat: new Set(),
    message(user, text, options = {}) {
      const from: TelegramUser = { is_bot: false, first_name: "Someone", ...user };
      const chat = options.chat === "group" ? { id: -1000 - user.id, type: "group" as const, title: "A group" } : { id: user.id, type: "private" as const };
      return {
        update_id: nextUpdate++,
        message: {
          message_id: nextMessage++,
          from,
          chat,
          date: Math.floor(Date.now() / 1000),
          ...(text !== undefined && { text }),
          ...(options.caption !== undefined && { caption: options.caption }),
        },
      };
    },
    say(user, text, options = {}) {
      const update = fake.message(user, text, options);
      updates.push(update);
      wake?.();
      return update.update_id;
    },
    async write(user, text, options = {}) {
      const update = fake.message(user, text, options);
      return { update, status: await fake.post(update) };
    },
    async post(update, options = {}) {
      if (fake.webhookUrl === "") throw new Error("fake telegram: no webhook is set");
      const secret = options.secret === undefined ? fake.webhookSecret : options.secret;
      const response = await fetch(fake.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret != null && { "x-telegram-bot-api-secret-token": secret }) },
        body: JSON.stringify(update),
      });
      await response.arrayBuffer();
      return response.status;
    },
    async sentCount(count, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (fake.sent.length < count) {
        if (Date.now() > deadline) throw new Error(`fake telegram: ${fake.sent.length} message(s) sent, expected ${count}: ${JSON.stringify(fake.sent)}`);
        await new Promise<void>((resolve) => {
          sentWaiters.add(resolve);
          setTimeout(resolve, 20);
        });
      }
      return fake.sent.slice(0, count);
    },
    pending: () => [...updates],
    addBot: (otherToken, otherBot) => shared.add(otherToken, otherBot),
    stop: () => shared.stop(),
  };

  const handle: Handler = async (method, request) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    switch (method) {
      case "getMe":
        return ok(bot);
      case "setWebhook": {
        const url = typeof body.url === "string" ? body.url : "";
        if (url === "") return fail(400, "Bad Request: bad webhook: an HTTPS URL must be provided for webhook");
        const secret = body.secret_token;
        if (secret !== undefined && (typeof secret !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(secret))) {
          return fail(400, "Bad Request: secret token contains unallowed characters");
        }
        fake.webhookUrl = url;
        fake.webhookSecret = secret;
        fake.allowedUpdates = Array.isArray(body.allowed_updates) ? body.allowed_updates.map(String) : undefined;
        fake.webhooksSet++;
        return ok(true);
      }
      case "deleteWebhook":
        fake.webhookUrl = "";
        fake.webhookSecret = undefined;
        fake.allowedUpdates = undefined;
        return ok(true);
      case "getWebhookInfo":
        fake.webhookInfoAsked++;
        return ok({ url: fake.webhookUrl, pending_update_count: updates.length, ...(fake.allowedUpdates !== undefined && { allowed_updates: fake.allowedUpdates }) });
      case "sendChatAction":
        fake.actions.push({ chatId: Number(body.chat_id), action: String(body.action) });
        return ok(true);
      case "sendMessage": {
        const chatId = Number(body.chat_id);
        const failing = fake.failChat.get(chatId) ?? 0;
        if (failing > 0) {
          fake.failChat.set(chatId, failing - 1);
          return fail(502, "Bad Gateway");
        }
        if (fake.hangChat.delete(chatId)) {
          fake.sent.push({ chatId, text: String(body.text), html: body.parse_mode === "HTML" });
          for (const resolve of sentWaiters) resolve();
          sentWaiters.clear();
          return await new Promise<Response>((resolve) => {
            const end = () => resolve(fail(504, "Gateway Timeout"));
            hung.add(end);
            request.signal.addEventListener("abort", end, { once: true });
          });
        }
        if (fake.failSends !== undefined) {
          fake.failSends.attempts++;
          return fail(fake.failSends.code, fake.failSends.description);
        }
        if (fake.failNextSend !== undefined) {
          const { code, description } = fake.failNextSend;
          delete fake.failNextSend;
          return fail(code, description);
        }
        if (fake.rateLimitNextSend !== undefined) {
          const retryAfter = fake.rateLimitNextSend;
          delete fake.rateLimitNextSend;
          return fail(429, "Too Many Requests: retry later", { parameters: { retry_after: retryAfter } });
        }
        const html = body.parse_mode === "HTML";
        if (html && fake.rejectHtml) return fail(400, "Bad Request: can't parse entities");
        fake.sent.push({ chatId: Number(body.chat_id), text: String(body.text), html });
        for (const resolve of sentWaiters) resolve();
        sentWaiters.clear();
        return ok({ message_id: nextMessage++ });
      }
      case "getUpdates": {
        if (fake.webhookUrl !== "") return fail(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first");
        polling?.(fail(409, "Conflict: terminated by other getUpdates request"));
        const offset = typeof body.offset === "number" ? body.offset : undefined;
        // An offset confirms every update before it: Telegram forgets them.
        if (offset !== undefined) while (updates[0] !== undefined && updates[0].update_id < offset) updates.shift();
        const ready = () => updates.filter((u) => offset === undefined || u.update_id >= offset);
        const timeout = Math.min(Number(body.timeout ?? 0), 2);
        if (ready().length > 0 || timeout === 0) return ok(ready());
        return new Promise<Response>((resolve) => {
          const finish = (response: Response) => {
            clearTimeout(timer);
            wake = undefined;
            polling = undefined;
            resolve(response);
          };
          const timer = setTimeout(() => finish(ok(ready())), timeout * 1000);
          wake = () => finish(ok(ready()));
          polling = finish;
          request.signal.addEventListener("abort", () => finish(ok([])), { once: true });
        });
      }
      default:
        return fail(404, `Not Found: method ${method}`);
    }
  };
  return {
    fake,
    handle,
    endPoll: () => {
      polling?.(fail(409, "Conflict: server stopped"));
      for (const end of hung) end();
    },
  };
}
