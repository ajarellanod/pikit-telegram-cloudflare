/**
 * The delivery loop and the `OutboundQueue` it serves (SPEC §5, "Outbound delivery").
 *
 * One loop, one send path: `enqueue` only stores, and the loop sends. Each turn it reads the head of
 * every conversation (its oldest open piece), sends the heads that are due and whose channel has a
 * transport attached, a few conversations at a time, then sleeps until the next piece is due or
 * until something changes (an enqueue, an attach, a send that ended).
 *
 * What a failure means is the transport's to say (`DeliveryError.kind`); what to do about it is
 * here: wait, retry, or give up.
 */

import { type AppEvents, type Clock, type Logger } from "@pikit/core";
import { type ChannelTransport, DeliveryError, type OutboundQueue } from "@pikit/contracts";
import type { Piece, Store } from "./store.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
/** The waits after the 1st, 2nd, 3rd and 4th transient failure; the 5th abandons. */
export const BACKOFF_MS = [5 * SECOND, 30 * SECOND, 2 * MINUTE, 10 * MINUTE] as const;
export const MAX_FAILURES = BACKOFF_MS.length + 1;
/** A piece not delivered after this long is abandoned, whatever the reason. */
export const MAX_AGE_MS = 24 * 60 * MINUTE;
/** A rate limit that names no wait. */
const DEFAULT_RATE_LIMIT_MS = 30 * SECOND;
/** The loop never sleeps longer than this, so a stop never waits on a long timer. */
const LONGEST_SLEEP_MS = SECOND;

export interface QueueOptions {
  store: Store;
  clock: Clock;
  logger: Logger;
  emit<K extends "outbound.delivered" | "outbound.abandoned">(name: K, payload: AppEvents[K]): Promise<void>;
  /** Conversations sent to at once. */
  concurrency: number;
  /** Runs about once an hour from the loop: pruning old rows. */
  housekeeping(now: number): Promise<void>;
}

const HOUSEKEEPING_EVERY_MS = 60 * MINUTE;

interface InFlight {
  channel: string;
  controller: AbortController;
  done: Promise<void>;
}

export function createQueue(options: QueueOptions) {
  const { store, clock, logger } = options;
  const transports = new Map<string, ChannelTransport>();
  /** By conversation key: at most one send per conversation. */
  const inFlight = new Map<string, InFlight>();
  let running = false;
  let loop: Promise<void> | undefined;

  let wake: () => void = () => {};
  let woken = new Promise<void>((resolve) => (wake = resolve));
  /** Something changed: the loop looks again now instead of finishing its sleep. */
  const kick = (): void => {
    wake();
    woken = new Promise<void>((resolve) => (wake = resolve));
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
      kick();
    },
    attach(channel, transport) {
      transports.set(channel, transport);
      kick();
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
  };

  /** One send of `piece` and what comes of it. Never rejects. */
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
        // Stopped during the send: it may have reached the platform.
        await store.retryLater(piece.key, { nextAttemptAt: clock.now(), failed: false, possibleDuplicate: true, error: "aborted while sending" });
        return;
      }
      const failure = error instanceof DeliveryError ? error : new DeliveryError("transient", error instanceof Error ? error.message : String(error));
      const description = `${failure.kind}: ${failure.message}`;
      if (failure.kind === "permanent") {
        await abandon(piece, attempts, description);
        return;
      }
      if (failure.kind === "rate_limited") {
        await store.retryLater(piece.key, {
          nextAttemptAt: clock.now() + (failure.retryAfterMs ?? DEFAULT_RATE_LIMIT_MS),
          failed: false,
          possibleDuplicate: failure.maybeSent,
          error: description,
        });
        return;
      }
      const failures = piece.failures + 1;
      if (failures >= MAX_FAILURES) {
        await abandon(piece, attempts, `${description} (failed ${failures} times)`);
        return;
      }
      await store.retryLater(piece.key, {
        nextAttemptAt: clock.now() + (BACKOFF_MS[failures - 1] as number),
        failed: true,
        possibleDuplicate: failure.maybeSent,
        error: description,
      });
    }
  };

  const abandon = async (piece: Piece, attempts: number, reason: string): Promise<void> => {
    if (!(await store.abandon(piece, attempts, reason, clock.now()))) return;
    logger.warn("outbound-durable: a piece was abandoned", { channel: piece.channel, key: piece.key, attempts, reason });
    await options.emit("outbound.abandoned", { channel: piece.channel, conversationKey: piece.conversationKey, key: piece.key, attempts, reason });
  };

  /** Sends what is due; returns when the next piece is due (ms), or `undefined` when none waits on time. */
  const turn = async (): Promise<number | undefined> => {
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
      if (inFlight.size >= options.concurrency) break;
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

  const run = async (): Promise<void> => {
    let lastHousekeeping = clock.now();
    while (running) {
      const changed = woken;
      let next: number | undefined;
      try {
        if (clock.now() - lastHousekeeping >= HOUSEKEEPING_EVERY_MS) {
          lastHousekeeping = clock.now();
          await options.housekeeping(lastHousekeeping);
        }
        next = await turn();
      } catch (error) {
        logger.error("outbound-durable: the delivery loop failed a turn", { error: String(error) });
        next = clock.now() + LONGEST_SLEEP_MS;
      }
      if (!running) break;
      const wait = next === undefined ? LONGEST_SLEEP_MS : Math.max(0, Math.min(next - clock.now(), LONGEST_SLEEP_MS));
      await Promise.race([changed, clock.sleep(wait)]);
    }
  };

  return {
    api,
    start(): void {
      running = true;
      loop = run();
    },
    /** Stops the loop; sends in flight end on their own, or are aborted when `signal` aborts. */
    async stop(signal: AbortSignal | undefined): Promise<void> {
      running = false;
      kick();
      await loop;
      const sends = [...inFlight.values()];
      const abort = () => {
        for (const send of sends) send.controller.abort(new Error("outbound-durable: stopping"));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      await Promise.all(sends.map((s) => s.done));
      signal?.removeEventListener("abort", abort);
    },
  };
}
