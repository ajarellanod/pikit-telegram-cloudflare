/**
 * Logging in to the bot from Telegram: `/login <password>`. Deployed with a "Deploy to Cloudflare"
 * button there is no `pikit configure` to read the owner's first message, so the owner does not know
 * their user id and `TELEGRAM_[<NAME>_]ALLOWED_USERS` may be empty. `TELEGRAM_[<NAME>_]PASSWORD` is a
 * password the owner types in the button's form; a private chat that sends `/login <that password>`
 * may talk to the bot from then on.
 *
 * Where it lives. The Worker has no storage (C1), and each chat's actor (the object's half) has
 * `storage.kv`. So when the bot takes logins (a password is set, or nobody is listed) the Worker hands
 * the updates of people it does not list to their chat's actor (`telegram.stranger`), and this decides:
 *
 * - **A chat that logged in** is handled as an allowed one (`inbox.ts`). Its login is kept in the
 *   channel's namespace of `storage.kv`, so it survives a restart, an eviction and a deploy.
 * - **`/login <password>`**, when a password is set: compared in constant time (SHA-256 digests,
 *   `secret.ts`). Right: the chat is logged in. Wrong: counted per chat; after 5 in a row the chat
 *   waits 15 minutes, during which every `/login` is refused unchecked. Telegram delivering the same
 *   message again is not another guess. The password never reaches the agent nor a log.
 * - **Anyone else** is told their id, and that `/login` exists only when a password is set; told once
 *   (remembered per chat), and nothing reaches the agent.
 *
 * A login holds while the password it was made with is set, or while none is (each login keeps the
 * password's fingerprint, its SHA-256):
 * - removing the password closes new logins and keeps the chats that logged in;
 * - changing it logs out every chat that logged in with the old one (they `/login` again with the new
 *   one): that is how to log everyone out. Going back to a former password lets its chats back in.
 *
 * Former names, still accepted and never documented to users: this feature was first "claiming the
 * bot", with the secret `TELEGRAM_[<NAME>_]CLAIM_CODE` and the command `/claim`, and a public template
 * shipped with them. `readPassword` falls back to the old secret (the Worker logs a deprecation warning
 * at start), and `commandOf` (`inbox.ts`) reads `/claim` as `/login`. The `storage.kv` keys keep the
 * old name (`claim:…`), so the chats that logged in before the rename stay logged in: the same value
 * under the new name has the same fingerprint.
 */

import type { AppContext } from "@pikit/core";
import { type Account, conversationKeyOf } from "./account.ts";
import type { TelegramMessage } from "./api.ts";
import { commandOf, commandSeenKey, handleMessage, type InboxDeps, type InboxOutcome, NO_TEXT, reply } from "./inbox.ts";
import { type Digest, digest, matches } from "./secret.ts";
import { textOf } from "./update.ts";

/** Wrong passwords in a row before a chat waits. */
export const LOGIN_ATTEMPTS = 5;
/** How long a chat waits after `LOGIN_ATTEMPTS` wrong passwords. */
export const LOGIN_COOL_DOWN_MS = 15 * 60_000;

/** A password, ready to compare: its digest, and its fingerprint kept with each login. */
export interface Password {
  digest: Digest;
  fingerprint: string;
}

/** A chat's login, in `storage.kv`; `code` is the password's fingerprint. */
type Login = { user: number; code: string; at: number };
/** A chat's wrong passwords: how many in a row, until when it waits (0: it does not), the last message counted. */
type Attempts = { failures: number; until: number; last: number };

// The feature's first name: renaming the keys would log out every chat that logged in before.
export const loginKey = (conversation: string): string => `claim:${conversation}`;
const attemptsKey = (conversation: string): string => `claim-attempts:${conversation}`;
const toldKey = (conversation: string): string => `stranger:${conversation}`;

/**
 * The bot's password as its secrets hold it: `TELEGRAM_[<NAME>_]PASSWORD`, or else the deprecated
 * `TELEGRAM_[<NAME>_]CLAIM_CODE`; spaces around it ignored. `name` is the variable it came from;
 * `undefined` when neither is set.
 */
export async function readPassword(account: Account, get: (name: string) => string | undefined | Promise<string | undefined>): Promise<{ name: string; value: string } | undefined> {
  for (const name of [account.passwordSecret, account.legacyPasswordSecret]) {
    const value = (await get(name))?.trim();
    if (value !== undefined && value !== "") return { name, value };
  }
  return undefined;
}

/** The password `value`, ready to compare; `undefined` when there is none. */
export async function passwordOf(value: string | undefined): Promise<Password | undefined> {
  const password = value?.trim();
  if (password === undefined || password === "") return undefined;
  const hash = await digest(password);
  return { digest: hash, fingerprint: [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
}

/** What a stranger is told: their id, and `/login` only when the bot has a password. */
export function strangerText(account: Account, userId: number, withPassword: boolean): string {
  return withPassword
    ? `This bot is private. If you have its password, send /login <password>. Your Telegram user id is ${userId}: its owner can also let you in by adding it to ${account.allowedSecret}.`
    : `This bot is private. Your Telegram user id is ${userId}: its owner can let you in by adding it to ${account.allowedSecret}.`;
}

export interface StrangerDeps extends InboxDeps {
  /** The bot's password, or `undefined` when none is set. */
  password: Password | undefined;
}

/** Whether the chat `conversation` was logged in by `user` with `password` (or with any, when none is set). */
export async function isLoggedIn(deps: Pick<StrangerDeps, "store" | "password">, conversation: string, user: number): Promise<boolean> {
  const login = await deps.store.get<Login>(loginKey(conversation));
  return login !== undefined && login.user === user && (deps.password === undefined || login.code === deps.password.fingerprint);
}

/** A private message from someone the Worker does not list. */
export async function handleStranger(message: TelegramMessage, deps: StrangerDeps, ctx: AppContext): Promise<InboxOutcome> {
  const { bot } = deps;
  const from = message.from;
  if (from === undefined) throw new Error(`channel-telegram-webhook: message ${message.message_id} has no sender`);
  const conversation = conversationKeyOf(bot.account.instance, message.chat.id);
  const text = textOf(message);

  if (await isLoggedIn(deps, conversation, from.id)) {
    if (text !== undefined) return await handleMessage(message, deps, ctx);
    await reply(bot, message.chat.id, NO_TEXT, ctx);
    return "answered";
  }
  if (deps.password !== undefined && text !== undefined && (await commandOf(text, bot)) === "login") {
    await logIn(message, text, deps, deps.password, conversation, ctx);
    return "answered";
  }

  ctx.logger.warn("channel-telegram-webhook: a message from a user who is not allowed", { instance: bot.account.instance, user: from.id });
  // What the chat was told last: told again when that changes (a password set or changed, so a chat
  // logged out by a new password is told how to log in again).
  const variant = deps.password === undefined ? "plain" : `password:${deps.password.fingerprint.slice(0, 16)}`;
  if ((await deps.store.get<string>(toldKey(conversation))) !== variant) {
    await reply(bot, message.chat.id, strangerText(bot.account, from.id, deps.password !== undefined), ctx);
    await deps.store.set(toldKey(conversation), variant);
  }
  return "answered";
}

async function logIn(message: TelegramMessage, text: string, deps: StrangerDeps, password: Password, conversation: string, ctx: AppContext): Promise<void> {
  const { bot, store } = deps;
  const chatId = message.chat.id;
  const user = message.from?.id as number;
  const now = ctx.clock.now();
  const before = await store.get<Attempts>(attemptsKey(conversation));
  // Telegram delivering the same message again (its 200 was lost) is not another guess.
  if (before !== undefined && message.message_id <= before.last) return;
  if (before !== undefined && now < before.until) {
    await store.set(attemptsKey(conversation), { ...before, last: message.message_id });
    await reply(bot, chatId, `Too many wrong passwords: try again in ${Math.ceil((before.until - now) / 60_000)} minute(s).`, ctx);
    return;
  }
  // What follows `/login` (or `/login@this_bot`): the password.
  const presented = text.trim().replace(/^\S+\s*/, "");
  if (presented === "") {
    await reply(bot, chatId, "Send /login followed by the password, in one message: /login <password>.", ctx);
    return;
  }

  if (await matches(presented, password.digest)) {
    await store.set(loginKey(conversation), { user, code: password.fingerprint, at: now } satisfies Login);
    await store.delete(attemptsKey(conversation));
    // Handled, as a command is: delivered again, it is not answered twice.
    await store.set(commandSeenKey(conversation), message.message_id);
    ctx.logger.info("channel-telegram-webhook: a chat logged in", { instance: bot.account.instance, user });
    await reply(bot, chatId, "✓ You're logged in: this chat can talk to the agent now. You may delete your /login message: it contains the password.", ctx);
    return;
  }

  // A cool-down that ended starts the count again.
  const failures = (before !== undefined && before.until === 0 ? before.failures : 0) + 1;
  const locked = failures >= LOGIN_ATTEMPTS;
  await store.set(attemptsKey(conversation), { failures: locked ? 0 : failures, until: locked ? now + LOGIN_COOL_DOWN_MS : 0, last: message.message_id } satisfies Attempts);
  ctx.logger.warn("channel-telegram-webhook: a wrong password", { instance: bot.account.instance, user, failures });
  await reply(bot, chatId, locked ? `Wrong password. Too many wrong passwords: try again in ${LOGIN_COOL_DOWN_MS / 60_000} minutes.` : "Wrong password.", ctx);
}
