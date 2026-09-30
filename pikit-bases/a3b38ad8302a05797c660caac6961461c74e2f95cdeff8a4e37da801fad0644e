/**
 * outbound-durable: every answer is stored before it is sent, and delivered even across crashes and
 * platform outages (@pikit/contracts' outbound.ts). It provides `outbound.queue` on `storage.sql`.
 *
 * - A channel attaches its transport while it runs; its answers are enqueued (stored), then sent by
 *   one loop, each conversation's pieces in order.
 * - Failures are the transport's to classify: a transient one is retried after 5 s, 30 s, 2 min and
 *   10 min and abandoned at the fifth; a rate limit waits what the platform asked; a permanent one is
 *   abandoned at once; anything older than 24 hours is abandoned.
 * - A send the process died during is sent again, as a possible duplicate: the platform drops it
 *   (idempotent transports) or the reader sees a marker. At-least-once.
 * - Abandoned pieces stay in `outbound_pieces` for 30 days, with their reason; delivered ones for 7.
 * - Every piece that settles gets one receipt, in the same transaction (`outbound_receipts`), read as a
 *   feed through `receipts` (`Feed`, SPEC K3): what a component that must not miss a delivery reads.
 * - Its tables carry a schema version (`outbound_meta`), so an existing database gains new tables.
 *
 * It follows Hermes' delivery ledger, with what NanoClaw and OpenClaw lack: backoff, order per
 * conversation, progress per piece, one send path.
 *
 * Targets: `server` and `cloudflare`: it imports nothing platform-specific; its storage is
 * `storage.sql` and its time is the app's clock.
 */

import { type AppContext, BACKGROUND_CONTEXT, defineComponent } from "@pikit/core";
import Type from "typebox";
import { createQueue } from "./queue.ts";
import { createStore } from "./store.ts";

const DAY = 24 * 60 * 60 * 1_000;

const Config = Type.Object({
  /** Conversations sent to at the same time. One conversation's pieces always go one at a time. */
  concurrency: Type.Integer({ minimum: 1, maximum: 64, default: 8 }),
  /** How long delivered pieces are kept, in days. */
  keepDeliveredDays: Type.Integer({ minimum: 0, default: 7 }),
  /** How long abandoned pieces are kept, with their reason, in days. */
  keepAbandonedDays: Type.Integer({ minimum: 0, default: 30 }),
});

export default defineComponent({
  name: "outbound-durable",
  config: Config,
  setup(pikit, config) {
    const storage = pikit.use("storage.sql");
    let queue: ReturnType<typeof createQueue> | undefined;

    const running = () => {
      if (queue === undefined) throw new Error("outbound-durable: outbound.queue used while the app is not running");
      return queue.api;
    };
    pikit.provide("outbound.queue", {
      enqueue: (message) => running().enqueue(message),
      attach: (channel, transport) => running().attach(channel, transport),
      detach: (channel, signal) => (queue === undefined ? Promise.resolve() : queue.api.detach(channel, signal)),
      receipts: { read: (after, limit) => running().receipts.read(after, limit) },
    });

    return {
      async start(ctx) {
        const store = createStore(storage.get());
        await store.migrate();
        const recovered = await store.recoverInterrupted();
        if (recovered > 0) ctx.logger.warn("outbound-durable: pieces were being sent when the last process stopped; they will be sent again", { pieces: recovered });
        const prune = (now: number) => store.prune(now, config.keepDeliveredDays * DAY, config.keepAbandonedDays * DAY);
        await prune(ctx.clock.now());

        // Deliveries outlive start: they get the app's context, not start's.
        const background: AppContext = ctx.derive(() => BACKGROUND_CONTEXT);
        queue = createQueue({
          store,
          clock: ctx.clock,
          logger: background.logger,
          emit: (name, payload) => background.emit(name, payload),
          concurrency: config.concurrency,
          housekeeping: prune,
        });
        queue.start();
      },
      async stop(ctx) {
        const stopping = queue;
        queue = undefined;
        await stopping?.stop(ctx.abortSignal);
      },
    };
  },
});
