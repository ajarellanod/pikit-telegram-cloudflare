/**
 * Claiming the bot from Telegram: `/claim <code>`. Deployed with a "Deploy to Cloudflare" button there
 * is no `pikit configure` to read the owner's first message, so the owner does not know their user id
 * and `TELEGRAM_[<NAME>_]ALLOWED_USERS` may be empty. `TELEGRAM_[<NAME>_]CLAIM_CODE` is a passphrase the
 * owner types in the button's form; a private chat that sends `/claim <that passphrase>` may talk to
 * the bot from then on.
 *
 * Where it lives. The Worker has no storage (C1), and each chat's actor (the object's half) has
 * `storage.kv`. So when the bot can be claimed (a claim code is set, or nobody is listed) the Worker
 * hands the updates of people it does not list to their chat's actor (`telegram.stranger`), and this
 * decides:
 *
 * - **A chat that claimed the bot** is handled as an allowed one (`inbox.ts`). Its claim is kept in
 *   the channel's namespace of `storage.kv` (`claim:<conversation>`), so it survives a restart, an
 *   eviction and a deploy.
 * - **`/claim <code>`**, when a claim code is set: compared in constant time (SHA-256 digests,
 *   `secret.ts`). Right: the chat is claimed. Wrong: counted per chat; after 5 in a row the chat
 *   waits 15 minutes, during which every `/claim` is refused unchecked. Telegram delivering the same
 *   message again is not another guess. The code never reaches the agent nor a log.
 * - **Anyone else** is told their id, and that `/claim` exists only when a claim code is set; told
 *   once (remembered per chat), and nothing reaches the agent.
 *
 * A claim holds while the claim code it was made with is set, or while none is:
 * - removing the claim code closes new claims and keeps the chats that claimed;
 * - changing it revokes every claim made with the old one (those chats `/claim` again with the new
 *   code): that is how to revoke claims.
 */

import type { AppContext } from "@pikit/core";
import { type Account, conversationKeyOf } from "./account.ts";
import type { TelegramMessage } from "./api.ts";
import { commandOf, commandSeenKey, handleMessage, type InboxDeps, type InboxOutcome, NO_TEXT, reply } from "./inbox.ts";
import { type Digest, digest, matches } from "./secret.ts";
import { textOf } from "./update.ts";

/** Wrong codes in a row before a chat waits. */
export const CLAIM_ATTEMPTS = 5;
/** How long a chat waits after `CLAIM_ATTEMPTS` wrong codes. */
export const CLAIM_COOL_DOWN_MS = 15 * 60_000;

/** A claim code, ready to compare: its digest, and its fingerprint kept with each claim. */
export interface ClaimCode {
  digest: Digest;
  fingerprint: string;
}

/** A chat's claim, in `storage.kv`. */
type Claim = { user: number; code: string; at: number };
/** A chat's wrong codes: how many in a row, until when it waits (0: it does not), the last message counted. */
type Attempts = { failures: number; until: number; last: number };

export const claimKey = (conversation: string): string => `claim:${conversation}`;
const attemptsKey = (conversation: string): string => `claim-attempts:${conversation}`;
const toldKey = (conversation: string): string => `stranger:${conversation}`;

/** The claim code in `value` (spaces around it ignored), or `undefined` when there is none. */
export async function claimCodeOf(value: string | undefined): Promise<ClaimCode | undefined> {
  const code = value?.trim();
  if (code === undefined || code === "") return undefined;
  const hash = await digest(code);
  return { digest: hash, fingerprint: [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
}

/** What a stranger is told: their id, and `/claim` only when the bot can be claimed. */
export function strangerText(account: Account, userId: number, claimable: boolean): string {
  const told = `This bot is private. Your Telegram user id is ${userId}: its owner can let you in by adding it to ${account.allowedSecret}.`;
  return claimable ? `${told} If you are its owner, send /claim followed by the claim code.` : told;
}

export interface StrangerDeps extends InboxDeps {
  /** The bot's claim code, or `undefined` when none is set. */
  code: ClaimCode | undefined;
}

/** Whether the chat `conversation` was claimed by `user` with `code` (or with any, when none is set). */
export async function isClaimed(deps: Pick<StrangerDeps, "store" | "code">, conversation: string, user: number): Promise<boolean> {
  const claim = await deps.store.get<Claim>(claimKey(conversation));
  return claim !== undefined && claim.user === user && (deps.code === undefined || claim.code === deps.code.fingerprint);
}

/** A private message from someone the Worker does not list. */
export async function handleStranger(message: TelegramMessage, deps: StrangerDeps, ctx: AppContext): Promise<InboxOutcome> {
  const { bot } = deps;
  const from = message.from;
  if (from === undefined) throw new Error(`channel-telegram-webhook: message ${message.message_id} has no sender`);
  const conversation = conversationKeyOf(bot.account.instance, message.chat.id);
  const text = textOf(message);

  if (await isClaimed(deps, conversation, from.id)) {
    if (text !== undefined) return await handleMessage(message, deps, ctx);
    await reply(bot, message.chat.id, NO_TEXT, ctx);
    return "answered";
  }
  if (deps.code !== undefined && text !== undefined && (await commandOf(text, bot)) === "claim") {
    await claim(message, text, deps, deps.code, conversation, ctx);
    return "answered";
  }

  ctx.logger.warn("channel-telegram-webhook: a message from a user who is not allowed", { instance: bot.account.instance, user: from.id });
  const variant = deps.code === undefined ? "plain" : "claim";
  if ((await deps.store.get<string>(toldKey(conversation))) !== variant) {
    await reply(bot, message.chat.id, strangerText(bot.account, from.id, deps.code !== undefined), ctx);
    await deps.store.set(toldKey(conversation), variant);
  }
  return "answered";
}

async function claim(message: TelegramMessage, text: string, deps: StrangerDeps, code: ClaimCode, conversation: string, ctx: AppContext): Promise<void> {
  const { bot, store } = deps;
  const chatId = message.chat.id;
  const user = message.from?.id as number;
  const now = ctx.clock.now();
  const before = await store.get<Attempts>(attemptsKey(conversation));
  // Telegram delivering the same message again (its 200 was lost) is not another guess.
  if (before !== undefined && message.message_id <= before.last) return;
  if (before !== undefined && now < before.until) {
    await store.set(attemptsKey(conversation), { ...before, last: message.message_id });
    await reply(bot, chatId, `Too many wrong claim codes: try again in ${Math.ceil((before.until - now) / 60_000)} minute(s).`, ctx);
    return;
  }
  // What follows `/claim` (or `/claim@this_bot`): the code.
  const presented = text.trim().replace(/^\S+\s*/, "");
  if (presented === "") {
    await reply(bot, chatId, "Send /claim followed by the claim code, in one message.", ctx);
    return;
  }

  if (await matches(presented, code.digest)) {
    await store.set(claimKey(conversation), { user, code: code.fingerprint, at: now } satisfies Claim);
    await store.delete(attemptsKey(conversation));
    // Handled, as a command is: delivered again, it is not answered twice.
    await store.set(commandSeenKey(conversation), message.message_id);
    ctx.logger.info("channel-telegram-webhook: a chat claimed the bot", { instance: bot.account.instance, user });
    await reply(bot, chatId, "✓ This chat can talk to the agent now. You may delete your /claim message: it holds the claim code.", ctx);
    return;
  }

  // A cool-down that ended starts the count again.
  const failures = (before !== undefined && before.until === 0 ? before.failures : 0) + 1;
  const locked = failures >= CLAIM_ATTEMPTS;
  await store.set(attemptsKey(conversation), { failures: locked ? 0 : failures, until: locked ? now + CLAIM_COOL_DOWN_MS : 0, last: message.message_id } satisfies Attempts);
  ctx.logger.warn("channel-telegram-webhook: a wrong claim code", { instance: bot.account.instance, user, failures });
  await reply(
    bot,
    chatId,
    locked ? `That is not the claim code. Too many wrong codes: try again in ${CLAIM_COOL_DOWN_MS / 60_000} minutes.` : "That is not the claim code.",
    ctx,
  );
}
