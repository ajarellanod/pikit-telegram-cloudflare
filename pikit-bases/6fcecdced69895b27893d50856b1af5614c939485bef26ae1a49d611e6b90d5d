/**
 * The delivery runs and the `OutboundQueue` they serve (@pikit/contracts' outbound.ts).
 *
 * One send path: `enqueue` only stores, then asks for a run. A run is the `wakeups` handler named
 * `outbound-durable`: it reads the head of every conversation (its oldest open piece), sends the
 * heads that are due and whose channel has a transport attached, a few conversations at a time, looks
 * again whenever a send ends or something changes (an enqueue, an attach), and ends once nothing is
 * in flight and nothing is due. Before it ends it asks for the next run, at the time the next piece is
 * due. So a retry is a wakeup: on a server `wakeups-timers` runs it, and on Cloudflare
 * `platform-cloudflare` runs it in the object's alarm, with no new event (C4). What is due is in the
 * table, and when, in the request: nothing waits in memory.
 *
 * - **A run's context is cut** (its slice's deadline, the app's stop): its sends are aborted, go back
 *   as possible duplicates, and it asks for the next run at once.
 * - **A kick during a run** (an enqueue, an attach) wakes that run instead of asking for another: a
 *   request made during a run replaces the name's request, so only the run asks while it goes.
 *
 * What a failure means is the transport's to say (`DeliveryError.kind`); what to do about it is
 * here: wait and retry, or give up (a permanent failure, or an age of 24 hours).
 */

import { type AppContext, type AppEvents, type Clock, type Logger } from "@pikit/core";
import { type ChannelTransport, DeliveryError, type OutboundQueue, type Wakeups } from "@pikit/contracts";
import type { Piece, Store } from "./store.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
/** The waits after the 1st, 2nd, 3rd and 4th transient failure in a row; the last repeats. Never abandons: only the age does. */
export const BACKOFF_MS = [5 * SECOND, 30 * SECOND, 2 * MINUTE, 10 * MINUTE] as const;
/** A piece not delivered after this long is abandoned, whatever the reason. */
export const MAX_AGE_MS = 24 * 60 * MINUTE;
/** A rate limit that names no wait. */
const DEFAULT_RATE_LIMIT_MS = 30 * SECOND;
/** The wakeup whose handler runs deliveries. */
export const WAKEUP = "outbound-durable";
const HOUSEKEEPING_EVERY_MS = 60 * MINUTE;

export interface QueueOptions {
  store: Store;
  clock: Clock;
  logger: Logger;
  emit<K extends "outbound.delivered" | "outbound.abandoned">(name: K, payload: AppEvents[K]): Promise<void>;
  /** Conversations sent to at once. */
  concurrency: number;
  /** Runs at most about once an hour, at the start of a run: pruning old rows. */
  housekeeping(now: number): Promise<void>;
  /** Runs the deliveries, and wakes them when a piece comes due. */
  wakeups: Wakeups;
  /** The app's context, for the requests made outside a run (an enqueue, an attach). */
  ctx: AppContext;
}

interface InFlight {
  channel: string;
  controller: AbortController;
  done: Promise<void>;
}

export function createQueue(options: QueueOptions) {
  const { store, clock, logger, wakeups } = options;
  const transports = new Map<string, ChannelTransport>();
  /** By conversation key: at most one send per conversation. */
  const inFlight = new Map<string, InFlight>();
  let stopped = false;
  /** This App's run in progress, if one is. */
  let running: Promise<void> | undefined;
  let lastHousekeeping = clock.now();

  /** Something changed since the run last looked. */
  let dirty = false;
  let wake: () => void = () => {};
  let woken = new Promise<void>((resolve) => (wake = resolve));
  const kick = (): void => {
    dirty = true;
    wake();
    woken = new Promise<void>((resolve) => (wake = resolve));
  };

  /** Something may be due now: the run in progress looks again, or a run is asked for. */
  const ask = async (): Promise<void> => {
    kick();
    if (running !== undefined || stopped) return;
    await wakeups.at(WAKEUP, clock.now(), options.ctx);
  };

  const api: OutboundQueue = {
    async enqueue(message) {
      const transport = transports.get(message.channel);
      if (transport === undefined) throw new Error(`outbound-durable: no transport is attached for the channel "${message.channel}"`);
      const pieces = transport.split(message.text).map((text, index) => ({
        key: `${message.idempotencyKey}#${index}`,
        channel: message.channel,
        conversationKey: message.conversationKey,
        text,
      }));
      if (pieces.length === 0) return;
      await store.add(pieces, clock.now());
      // Rejects when the request cannot be recorded: the caller enqueues again, which stores nothing twice.
      await ask();
    },
    attach(channel, transport) {
      transports.set(channel, transport);
      // Its pending pieces (left by the last App, waiting for a retry) are looked at now.
      ask().catch((error: unknown) => logger.error("outbound-durable: could not ask for a delivery run", { channel, error: String(error) }));
    },
    async detach(channel, signal) {
      transports.delete(channel);
      const sends = [...inFlight.values()].filter((f) => f.channel === channel);
      const abort = () => {
        for (const send of sends) send.controller.abort(signal?.reason ?? new Error("outbound-durable: the channel stopped"));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      await Promise.all(sends.map((s) => s.done));
      signal?.removeEventListener("abort", abort);
    },
    receipts: { read: (after, limit) => store.readReceipts(after, limit) },
    pending: (page) => store.readPending(page),
  };

  /** One send of `piece` and what comes of it. */
  const deliver = async (piece: Piece, transport: ChannelTransport, controller: AbortController): Promise<void> => {
    const now = clock.now();
    if (now - piece.createdAt > MAX_AGE_MS) {
      await abandon(piece, piece.attempts, "not delivered within 24 hours");
      return;
    }
    if (!(await store.markSending(piece.key))) return;
    const attempts = piece.attempts + 1;
    try {
      const sent = await transport.send(
        { key: piece.key, conversationKey: piece.conversationKey, text: piece.text, possibleDuplicate: piece.possibleDuplicate },
        controller.signal,
      );
      if (!(await store.markDelivered(piece, attempts, sent.platformMessageId, clock.now()))) return;
      await options.emit("outbound.delivered", {
        channel: piece.channel,
        conversationKey: piece.conversationKey,
        key: piece.key,
        attempts,
        possibleDuplicate: piece.possibleDuplicate,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        // Cut during the send (a stop, a detach, the run's slice): it may have reached the platform.
        await store.retryLater(piece.key, { nextAttemptAt: clock.now(), failed: false, possibleDuplicate: true, error: "aborted while sending" });
        return;
      }
      const failure = error instanceof DeliveryError ? error : new DeliveryError("transient", error instanceof Error ? error.message : String(error));
      const description = `${failure.kind}: ${failure.message}`;
      if (failure.kind === "permanent") {
        await abandon(piece, attempts, description);
        return;
      }
      const rateLimited = failure.kind === "rate_limited";
      const failures = piece.failures + (rateLimited ? 0 : 1);
      const wait = rateLimited ? (failure.retryAfterMs ?? DEFAULT_RATE_LIMIT_MS) : (BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] as number);
      await store.retryLater(piece.key, { nextAttemptAt: clock.now() + wait, failed: !rateLimited, possibleDuplicate: failure.maybeSent, error: description });
    }
  };

  const abandon = async (piece: Piece, attempts: number, reason: string): Promise<void> => {
    if (!(await store.abandon(piece, attempts, reason, clock.now()))) return;
    logger.error("outbound-durable: a piece was abandoned; it will not be sent", { channel: piece.channel, key: piece.key, attempts, reason });
    await options.emit("outbound.abandoned", { channel: piece.channel, conversationKey: piece.conversationKey, key: piece.key, attempts, reason });
  };

  /** Starts the sends that are due; returns when the next piece is due (ms), or `undefined` when none waits on time. */
  const turn = async (signal: AbortSignal | undefined): Promise<number | undefined> => {
    if (stopped || signal?.aborted) return undefined;
    const now = clock.now();
    let next: number | undefined;
    for (const head of await store.heads()) {
      if (inFlight.has(head.conversationKey)) continue;
      const transport = transports.get(head.channel);
      if (transport === undefined) continue;
      if (head.nextAttemptAt > now) {
        next = next === undefined ? head.nextAttemptAt : Math.min(next, head.nextAttemptAt);
        continue;
      }
      // Due, but every slot is taken: a send that ends kicks the run, which starts it then.
      if (inFlight.size >= options.concurrency || stopped || signal?.aborted) break;
      const controller = new AbortController();
      const send: InFlight = { channel: head.channel, controller, done: Promise.resolve() };
      inFlight.set(head.conversationKey, send);
      send.done = deliver(head, transport, controller)
        .catch((error: unknown) => logger.error("outbound-durable: a delivery could not be recorded", { key: head.key, error: String(error) }))
        .finally(() => {
          inFlight.delete(head.conversationKey);
          kick();
        });
    }
    return next;
  };

  /**
   * Sends what is due until nothing is in flight and nothing changed; when to run next (`undefined`:
   * when something is enqueued or attached). Cut by `signal`, it aborts its sends and says now.
   */
  const drain = async (signal: AbortSignal | undefined): Promise<number | undefined> => {
    const cut = () => {
      for (const send of inFlight.values()) send.controller.abort(signal?.reason ?? new Error("outbound-durable: the run was cut"));
    };
    signal?.addEventListener("abort", cut, { once: true });
    // What asked for this run is looked at by it.
    dirty = false;
    try {
      const now = clock.now();
      if (now - lastHousekeeping >= HOUSEKEEPING_EVERY_MS) {
        lastHousekeeping = now;
        await options.housekeeping(now);
      }
      for (;;) {
        const changed = woken;
        dirty = false;
        const next = await turn(signal);
        if (inFlight.size === 0) {
          if (signal?.aborted) return clock.now();
          if (!dirty) return next;
          continue;
        }
        await changed;
      }
    } finally {
      // Never ends with a send in flight, even when it failed: the next run would send it twice.
      await Promise.all([...inFlight.values()].map((s) => s.done));
      signal?.removeEventListener("abort", cut);
    }
  };

  /** The wakeup's handler: a drain, then the request for the next run. Rejects only when that request cannot be recorded. */
  const run = async (ctx: AppContext): Promise<void> => {
    if (stopped || running !== undefined) return;
    let resolve = () => {};
    running = new Promise<void>((r) => (resolve = r));
    try {
      let next: number | undefined;
      try {
        next = await drain(ctx.abortSignal);
      } catch (error) {
        logger.error("outbound-durable: a delivery run failed; trying again", { error: String(error) });
        next = clock.now() + BACKOFF_MS[0];
      }
      if (stopped) return;
      if (next !== undefined) await wakeups.at(WAKEUP, next, ctx);
    } finally {
      running = undefined;
      resolve();
    }
    // A kick while the request was recorded did not ask (a run was going): ask now.
    if (dirty && !stopped) await wakeups.at(WAKEUP, clock.now(), ctx);
  };

  return {
    api,
    /** Registers the handler. The channels' `attach` asks for the first run. */
    start(): void {
      wakeups.handle(WAKEUP, run);
    },
    /**
     * Stops: no more sends start; sends in flight end on their own, or are aborted when `signal`
     * aborts (sent again, as possible duplicates, by the next App). Then waits for the run to end.
     */
    async stop(signal: AbortSignal | undefined): Promise<void> {
      stopped = true;
      kick();
      const sends = [...inFlight.values()];
      const abort = () => {
        for (const send of sends) send.controller.abort(new Error("outbound-durable: stopping"));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      await Promise.all(sends.map((s) => s.done));
      signal?.removeEventListener("abort", abort);
      await running;
    },
  };
}
