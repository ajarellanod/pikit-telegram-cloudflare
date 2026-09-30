/**
 * A Telegram update as both halves read it: the Worker from the request Telegram posted, the object
 * from the message the Worker sent it (`actor.mailbox` carries JSON, and JSON is checked, not trusted).
 */

import type { TelegramMessage, TelegramUpdate } from "./api.ts";

/** The type of the message the Worker sends to the conversation's actor: the update, as Telegram posted it. */
export const UPDATE_TYPE = "telegram.update";
/**
 * The type of an update from someone `TELEGRAM_[<NAME>_]ALLOWED_USERS` does not list, sent only when the
 * bot takes logins (`login.ts`): the chat's actor decides, from the login it keeps.
 */
export const STRANGER_TYPE = "telegram.stranger";

/** An update with a message from a person in a private chat. */
export type PrivateUpdate = TelegramUpdate & { message: TelegramMessage & { from: NonNullable<TelegramMessage["from"]> } };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** `value` as an update, or `undefined` when it is not one (no `update_id`, a message without a chat). */
export function readUpdate(value: unknown): TelegramUpdate | undefined {
  if (!isObject(value) || !Number.isSafeInteger(value.update_id)) return undefined;
  const message = value.message;
  if (message === undefined) return value as unknown as TelegramUpdate;
  if (!isObject(message) || !Number.isSafeInteger(message.message_id) || !isObject(message.chat) || !Number.isSafeInteger(message.chat.id)) return undefined;
  if (message.from !== undefined && (!isObject(message.from) || !Number.isSafeInteger(message.from.id))) return undefined;
  for (const field of ["text", "caption"] as const) if (message[field] !== undefined && typeof message[field] !== "string") return undefined;
  return value as unknown as TelegramUpdate;
}

/**
 * Whether the update is one this channel handles: a message from a person (not a bot) in a private
 * chat. Groups are ignored for now, as channel-telegram does (they need privacy mode and mention rules).
 */
export function isPrivateMessage(update: TelegramUpdate): update is PrivateUpdate {
  const message = update.message;
  return message !== undefined && message.chat.type === "private" && message.from !== undefined && !message.from.is_bot;
}

/** The message's text, or its caption; `undefined` when it has neither (a sticker, a photo alone). */
export function textOf(message: TelegramMessage): string | undefined {
  const text = message.text ?? message.caption;
  return text === undefined || text.trim() === "" ? undefined : text;
}
