/**
 * Delivering answers, in the object's half (SPEC §4.1, C3, C4): the work of the wakeup
 * `channel-telegram-webhook.deliver`. On Cloudflare nothing runs between events, so nothing waits for
 * a run's end in memory: each run of the wakeup does what is due and asks to run again while work
 * remains.
 *
 * - **Answers come from `agent.submissions`' `answers` feed**, from a cursor this channel keeps in
 *   `storage.kv` (the key `answers-cursor` of its namespace). The cursor moves only past answers that
 *   were delivered: sent to Telegram, or stored in the outbox. An answer that ended while no wakeup
 *   ran (an eviction, a restart, a deploy) is delivered at the next one; the channel asks for one at
 *   every start, whenever a message arrives, and whenever a run ends.
 * - **Without `outbound.queue`**, each piece is sent through the transport and marked in `storage.kv`,
 *   `sending` before it goes and `sent` after. A piece found `sending` (the object died during the
 *   send, or Telegram may have got it before a timeout) is sent again marked `↻ `, since Telegram
 *   cannot tell a repeated send apart. A piece Telegram refused outright is not marked, and goes again
 *   plain. The marks of an answer are deleted once the cursor is past it.
 * - **With `outbound.queue`** (`outbound-durable`), the answer is enqueued under
 *   `answerKey(conversation, requestId)`: enqueued twice, sent once.
 * - **A failure waits**: Telegram's `retry_after` for a 429; 1 s, 5 s, 30 s, then every minute for the
 *   rest, logged as an error from the 3rd in a row. A permanent refusal (the user blocked the bot) is
 *   logged and the answer given up. Answers are delivered in the feed's order, so one that cannot be
 *   delivered holds up the ones after it: on Cloudflare every object owns one conversation, so it holds
 *   up only its own chat.
 * - **"typing…"** is shown in every chat whose conversation has a message waiting for its run
 *   (`agent.submissions`' `pending`), every 4 seconds, for at most 10 minutes per message: the wakeup
 *   runs again for it.
 * - **Slices** (C4): a run stops when its context is cancelled (the provider's slice deadline, or the
 *   App stopping) and after 20 pieces, and asks to run again at once. A send cut by the deadline may
 *   have reached Telegram: its mark stays `sending`.
 *
 * The first time the channel opens its cursor, it starts at the feed's end: answers already there
 * ended before this channel was installed.
 */

import type { AppContext, Logger } from "@pikit/core";
import {
  type AgentSubmissions,
  answerKey,
  DeliveryError,
  type Feed,
  type KeyValueStore,
  type OutboundQueue,
  type RunSettlement,
  type Wakeups,
} from "@pikit/contracts";
import { type Bot, findBot, TELEGRAM_TIMEOUT_MS, within } from "./bot.ts";

/** The wakeup this channel registers and asks for. */
export const DELIVER = "channel-telegram-webhook.deliver";

const PAGE = 50;
/** Pieces one run sends at most: every send is a subrequest, and an invocation has few (C4). */
const PIECES_PER_RUN = 20;
/** How long to wait after the 1st, 2nd, 3rd… failure in a row; the last repeats. */
const RETRY_MS: readonly number[] = [1_000, 5_000, 30_000, 60_000];
/** From this failure in a row on, an answer that cannot be delivered is an error. */
const BLOCKED_AFTER = 3;
/** How often "typing…" is renewed: Telegram shows it for about 5 seconds. */
export const TYPING_EVERY_MS = 4_000;
/** A message whose run has not ended after this long stops showing "typing…". */
const TYPING_AT_MOST_MS = 10 * 60_000;

const CURSOR_KEY = "answers-cursor";
/** The saved cursor before the feed's first answer: a feed's cursors are opaque, but never empty. */
const FROM_START = "";
const SENDING = "sending";
const SENT = "sent";

/** Where the channel's place in the feed is kept. */
export interface Cursors {
  get(): Promise<string | undefined>;
  save(cursor: string): Promise<void>;
}

/**
 * The channel's cursor in its namespace of `storage.kv` (as channel-telegram's `answers.ts` keeps it).
 * With none yet, its place is set at the feed's end.
 */
export async function openCursors(store: KeyValueStore, answers: Feed<RunSettlement>): Promise<Cursors> {
  const cursors: Cursors = {
    async get() {
      const saved = await store.get<string>(CURSOR_KEY);
      return saved === FROM_START ? undefined : saved;
    },
    save: (cursor) => store.set(CURSOR_KEY, cursor),
  };
  if ((await store.get(CURSOR_KEY)) === undefined) {
    let end: string | undefined;
    for (;;) {
      const page = await answers.read(end, 500);
      end = page.items.at(-1)?.cursor ?? end;
      if (page.items.length < 500) break;
    }
    // Only if still missing: another process may have set it meanwhile.
    await store.setIfAbsent(CURSOR_KEY, end ?? FROM_START);
  }
  return cursors;
}

export interface DeliveryDeps {
  bots: readonly Bot[];
  answers: Feed<RunSettlement>;
  cursors: Cursors;
  /** The channel's namespace of `storage.kv`: the pieces' marks. */
  store: KeyValueStore;
  submissions: AgentSubmissions;
  queue: OutboundQueue | undefined;
  wakeups: Wakeups;
  logger: Logger;
  /** Waits after the 1st, 2nd… failure in a row; the last repeats. Tests shorten it. */
  retryMs?: readonly number[];
}

export interface Delivery {
  /** One run of the wakeup: delivers what is due, shows "typing…", and asks for the next run if work remains. */
  run(ctx: AppContext): Promise<void>;
  /** Something to deliver may have come (a message, a run's end): run as soon as possible. */
  kick(ctx: AppContext): Promise<void>;
}

/** What delivering one answer came to. */
type Outcome = { kind: "delivered"; ours: boolean; pieces: number } | { kind: "later"; afterMs: number } | { kind: "cut" };

export function createDelivery(deps: DeliveryDeps): Delivery {
  const { bots, answers, cursors, store, queue, wakeups, logger } = deps;
  const retryMs = deps.retryMs ?? RETRY_MS;
  /** Failures in a row, and when to try the answer that failed again. In memory: a new App just tries. */
  let failures = 0;
  let notBefore = 0;
  /** A kick came during a run: the run's own next request must not put it off. */
  let kicked = false;
  /** The cursor after which a gap was last reported: each gap once. */
  let gapAfter: string | undefined | null = null;

  const cut = (ctx: AppContext): boolean => ctx.abortSignal?.aborted === true;

  const failed = (answer: RunSettlement, error: unknown): Outcome => {
    failures++;
    const details = { conversation: answer.conversation.key, run: answer.requestId, failures, error: error instanceof Error ? error.message : String(error) };
    if (failures >= BLOCKED_AFTER) logger.error("channel-telegram-webhook: an answer still cannot be delivered; the answers after it wait for it", details);
    else logger.warn("channel-telegram-webhook: delivering an answer failed; trying again", details);
    const backoff = retryMs[Math.min(failures, retryMs.length) - 1] as number;
    const rateLimited = error instanceof DeliveryError && error.kind === "rate_limited" && error.retryAfterMs !== undefined;
    return { kind: "later", afterMs: rateLimited ? (error.retryAfterMs as number) : backoff };
  };

  /** Hands one answer to its chat. `budget` is how many pieces this run may still send. */
  const deliverOne = async (answer: RunSettlement, budget: number, ctx: AppContext): Promise<Outcome> => {
    const found = findBot(bots, answer.conversation.key);
    const text = found === undefined ? undefined : replyText(answer);
    if (found === undefined || text === undefined) return { kind: "delivered", ours: false, pieces: 0 };
    const { bot } = found;
    const key = answerKey(answer.conversation, answer.requestId);
    if (queue !== undefined) {
      try {
        await queue.enqueue({ idempotencyKey: key, channel: bot.account.instance, conversationKey: answer.conversation.key, text });
      } catch (error) {
        return failed(answer, error);
      }
      return { kind: "delivered", ours: true, pieces: 0 };
    }

    const pieces = bot.transport.split(text);
    let sent = 0;
    for (const [index, piece] of pieces.entries()) {
      const mark = `piece:${key}#${index}`;
      const state = await store.get<string>(mark);
      if (state === SENT) continue;
      if (cut(ctx) || sent >= budget) return { kind: "cut" };
      await store.set(mark, SENDING);
      try {
        await bot.transport.send({ key: `${key}#${index}`, conversationKey: answer.conversation.key, text: piece, possibleDuplicate: state === SENDING }, within(TELEGRAM_TIMEOUT_MS, ctx.abortSignal));
      } catch (error) {
        // Cut by the slice's deadline, or timed out: it may have reached Telegram, and stays `sending`.
        if (cut(ctx)) return { kind: "cut" };
        if (error instanceof DeliveryError && !error.maybeSent) await store.delete(mark);
        if (error instanceof DeliveryError && error.kind === "permanent") {
          logger.error("channel-telegram-webhook: Telegram refused an answer for good; it is not sent", {
            conversation: answer.conversation.key,
            run: answer.requestId,
            error: error.message,
          });
          return { kind: "delivered", ours: true, pieces: sent };
        }
        return failed(answer, error);
      }
      await store.set(mark, SENT);
      sent++;
    }
    return { kind: "delivered", ours: true, pieces: sent };
  };

  /** Deletes an answer's marks, once the cursor is past it. */
  const forget = async (answer: RunSettlement): Promise<void> => {
    const found = findBot(bots, answer.conversation.key);
    const text = replyText(answer);
    if (queue !== undefined || found === undefined || text === undefined) return;
    const key = answerKey(answer.conversation, answer.requestId);
    for (let index = 0; index < found.bot.transport.split(text).length; index++) await store.delete(`piece:${key}#${index}`);
  };

  /** Delivers answers after the cursor: `done` when caught up, `more` when this run stopped early. */
  const deliverAnswers = async (ctx: AppContext): Promise<{ kind: "done" | "more" } | { kind: "later"; afterMs: number }> => {
    const saved = await cursors.get();
    let cursor = saved;
    let budget = PIECES_PER_RUN;
    const save = async () => {
      if (cursor !== undefined && cursor !== saved) await cursors.save(cursor);
    };
    for (;;) {
      const page = await answers.read(cursor, PAGE);
      if (page.gap && gapAfter !== cursor) {
        gapAfter = cursor;
        logger.warn("channel-telegram-webhook: answers were pruned before this channel read them; some may not have reached their chats", { after: cursor });
      }
      for (const item of page.items) {
        if (cut(ctx) || budget <= 0) {
          await save();
          return { kind: "more" };
        }
        const outcome = await deliverOne(item.fact, budget, ctx);
        if (outcome.kind !== "delivered") {
          await save();
          return outcome.kind === "cut" ? { kind: "more" } : outcome;
        }
        cursor = item.cursor;
        if (outcome.ours) {
          failures = 0;
          // Past it for good before its marks go: a crash in between sends nothing again.
          await cursors.save(cursor);
          await forget(item.fact);
        }
        budget -= outcome.pieces;
      }
      if (page.items.length < PAGE) {
        await save();
        return { kind: "done" };
      }
    }
  };

  /** Shows "typing…" where a message waits for its run; whether any does. */
  const showTyping = async (ctx: AppContext): Promise<boolean> => {
    const now = ctx.clock.now();
    let any = false;
    for (const pending of await deps.submissions.pending(ctx)) {
      const found = findBot(bots, pending.conversation.key);
      if (found === undefined || now - pending.oldestAdmittedAt > TYPING_AT_MOST_MS) continue;
      any = true;
      await found.bot.api.sendChatAction(found.chatId, "typing", within(TELEGRAM_TIMEOUT_MS, ctx.abortSignal)).catch(() => {});
    }
    return any;
  };

  return {
    async run(ctx) {
      kicked = false;
      let next: number | undefined;
      if (ctx.clock.now() < notBefore) next = notBefore;
      else {
        const result = await deliverAnswers(ctx);
        if (result.kind === "more") next = ctx.clock.now();
        if (result.kind === "later") next = notBefore = ctx.clock.now() + result.afterMs;
      }
      if (!cut(ctx) && (await showTyping(ctx))) next = Math.min(next ?? Number.POSITIVE_INFINITY, ctx.clock.now() + TYPING_EVERY_MS);
      if (kicked) next = ctx.clock.now();
      if (next !== undefined) await wakeups.at(DELIVER, next, ctx);
    },
    async kick(ctx) {
      kicked = true;
      await wakeups.at(DELIVER, ctx.clock.now(), ctx);
    },
  };
}

/**
 * What the chat is told about a run: its answer, or that it failed. Nothing for an aborted or empty
 * one. A message the runtime abandoned is never answered: the user is asked to send it again.
 * (channel-telegram's words, so a chat reads the same on both targets.)
 */
export function replyText(answer: Pick<RunSettlement, "kind" | "text" | "error">): string | undefined {
  if (answer.kind === "failed" && answer.error?.code === "abandoned") return "Sorry, we could not answer your message. Please send it again.";
  if (answer.kind === "failed") return `Sorry, something went wrong while answering (${answer.error?.code ?? "error"}). Try again in a moment.`;
  if (answer.kind === "completed" && (answer.text ?? "").trim() !== "") return answer.text;
  return undefined;
}
