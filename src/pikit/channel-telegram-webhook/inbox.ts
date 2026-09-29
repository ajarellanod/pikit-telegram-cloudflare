/**
 * One update, in the actor that owns its conversation (the object's half, SPEC §4.1, C1). The Worker
 * already checked the secret, kept only private messages with text, and let through only the allowed
 * users (or `claim.ts` found the chat claimed the bot); this is the rest of what channel-telegram's
 * `inbound.ts` does:
 *
 * 1. Commands the channel answers itself: `/start` and `/help` explain, `/new` (or `/reset`) starts
 *    the conversation over (a reset: a new session, the old one kept), `/claim` says the chat is in
 *    already (it may hold the claim code: it never reaches the agent). Other commands go to the agent
 *    as text. A command Telegram delivers again (its 200 was lost) is recognised by its message id and
 *    not run twice.
 * 2. Everything else takes the inbound path every channel takes (`admitInbound`: `inbound.normalize`,
 *    `route.resolve`, the conversation `<instance>:<chat id>`, `dispatch`). The request id is
 *    `<instance>:<chat id>:<message id>`, as channel-telegram's: a message Telegram delivers twice is
 *    one request, and the runtime answers the second `duplicate`. When the agent will not answer, the
 *    chat is told why.
 *
 * It resolves once the message is durable in its conversation (`admitted` or `duplicate`), which is
 * when the Worker answers Telegram 200; the run and its answer come after, from the delivery wakeup
 * (`delivery.ts`). The channel's own short replies are sent here, once, best effort: a reply lost is
 * logged, never a reason for Telegram to deliver the update again.
 */

import type { AppContext } from "@pikit/core";
import { admitInbound, type AgentRuntime, type ConversationRegistry, type InboundMessage, type KeyValueStore } from "@pikit/contracts";
import { conversationKeyOf } from "./account.ts";
import type { TelegramMessage } from "./api.ts";
import { type Bot, TELEGRAM_TIMEOUT_MS, within } from "./bot.ts";
import { textOf } from "./update.ts";

export interface InboxDeps {
  bot: Bot;
  conversations: ConversationRegistry;
  runtime: AgentRuntime;
  /** The channel's namespace of `storage.kv`: the last command handled in each chat. */
  store: KeyValueStore;
}

/** What became of the update: `dispatched` when its conversation has it, and its answer is to come. */
export type InboxOutcome = "dispatched" | "answered";

/** The reply to a message with no text. */
export const NO_TEXT = "I can only read text messages for now.";

/** Where the last command handled in a chat is kept: its message id. */
export const commandSeenKey = (conversation: string): string => `command:${conversation}`;

const HELP = ["Send me a message and I'll answer.", "", "/new: start a new conversation (I forget this one)", "/help: this message"].join("\n");

export async function handleMessage(message: TelegramMessage, deps: InboxDeps, ctx: AppContext): Promise<InboxOutcome> {
  const { bot } = deps;
  const chatId = message.chat.id;
  const key = conversationKeyOf(bot.account.instance, chatId);
  const text = textOf(message);
  // The Worker sends only messages with text: one without is not this channel's to answer.
  if (text === undefined || message.from === undefined) throw new Error(`channel-telegram-webhook: message ${message.message_id} of ${key} has no text or no sender`);

  const command = await commandOf(text, bot);
  if (command === "start" || command === "help" || command === "new" || command === "claim") {
    const seenKey = commandSeenKey(key);
    const last = await deps.store.get<number>(seenKey);
    if (last !== undefined && message.message_id <= last) return "answered";
    if (command === "new") {
      const reset = await deps.conversations.reset(key, ctx);
      await reply(bot, chatId, reset === undefined ? "This is already a new conversation." : "Started a new conversation.", ctx);
    } else if (command === "claim") {
      await reply(bot, chatId, "This chat can talk to me already.", ctx);
    } else {
      const name = message.from.first_name;
      await reply(bot, chatId, command === "start" ? `Hi${name ? ` ${name}` : ""}! ${HELP}` : HELP, ctx);
    }
    await deps.store.set(seenKey, message.message_id);
    return "answered";
  }

  const inbound: InboundMessage = {
    id: `${key}:${message.message_id}`,
    channel: bot.account.instance,
    conversationId: String(chatId),
    actor: { id: String(message.from.id) },
    text,
    raw: message,
    receivedAt: ctx.clock.now(),
  };
  const outcome = await admitInbound(ctx, inbound, { conversations: deps.conversations, runtime: deps.runtime, key });
  switch (outcome.kind) {
    case "admitted":
    case "duplicate":
      return "dispatched";
    case "halted":
      await reply(bot, chatId, "I can't take that message.", ctx);
      return "answered";
    case "denied":
      await reply(bot, chatId, "Sorry, I can't answer that here.", ctx);
      return "answered";
    case "no_route":
      await reply(bot, chatId, "This bot is not set up to answer yet.", ctx);
      return "answered";
  }
}

/** Sends the channel's own short reply once; a failure is logged, not thrown. */
export async function reply(bot: Bot, chatId: number, text: string, ctx: AppContext): Promise<void> {
  const signal = within(TELEGRAM_TIMEOUT_MS, ctx.abortSignal);
  const conversationKey = conversationKeyOf(bot.account.instance, chatId);
  try {
    for (const [index, piece] of bot.transport.split(text).entries()) {
      await bot.transport.send({ key: `reply:${chatId}:${index}`, conversationKey, text: piece, possibleDuplicate: false }, signal);
    }
  } catch (error) {
    ctx.logger.error("channel-telegram-webhook: a reply could not be sent", { chat: chatId, error: String(error) });
  }
}

/**
 * `/new` or `/new@this_bot` → `new`; `/reset` is `new`. A command for another bot, or no command, →
 * `undefined`. The bot's username is asked (`getMe`) only when a command names one.
 */
export async function commandOf(text: string, bot: Bot): Promise<string | undefined> {
  const match = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/.exec(text.trim());
  if (match === null) return undefined;
  const [, name = "", target] = match;
  if (target !== undefined && target.toLowerCase() !== (await bot.me()).username?.toLowerCase()) return undefined;
  const command = name.toLowerCase();
  return command === "reset" ? "new" : command;
}
