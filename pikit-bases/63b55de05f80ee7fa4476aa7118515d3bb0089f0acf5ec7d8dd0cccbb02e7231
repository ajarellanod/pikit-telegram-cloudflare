/**
 * submissions-sql: no admitted message ends without its answer reaching you, across crashes, restarts
 * and deploys. It provides `agent.submissions` on `storage.sql`.
 *
 * - The runtime (`runtime-pi`) records each message it admits, before the channel acknowledges it,
 *   and settles it when the run that took it ends. At start, it resumes every conversation with a
 *   message still pending, with no new message needed.
 * - Every run's outcome is appended to `answers`, a feed (`Feed`, SPEC K3), in the same transaction as the
 *   requests it settles. Channels deliver from it with a cursor of their own, so an answer that ended
 *   while the channel was stopped (a deploy) is delivered when it starts again.
 * - `get` says where one request is: HTTP's `GET /v1/conversations/:id/messages/:messageId`.
 *
 * The answer itself stays in the conversation's Pi session. A settlement keeps the run's final text
 * (not its transcript) for `keepSettledDays`, then goes with the requests it settled; a reader left
 * behind is told it missed some (`gap`). Pending requests are never pruned: nothing answered them yet.
 *
 * When Pi's durable runtime ships its submissions, the adapter moves to them and the per-session half
 * of this component goes; the index across sessions (`pending`) and the feed stay
 * (features/pi-durable-migration.md).
 *
 * Targets: `server` and `cloudflare`. It imports nothing platform-specific (its storage is
 * `storage.sql`, its time the app's clock); on Cloudflare its storage is the conversation object's
 * (`storage-do`), where pikit's workerd lane runs its suites.
 */

import { type AgentSubmissions, type RunSettlement } from "@pikit/contracts";
import { type AppContext, type Clock, defineComponent } from "@pikit/core";
import Type from "typebox";
import { createStore, type Store } from "./store.ts";

const DAY = 24 * 60 * 60 * 1_000;
/** Settlements older than the retention are pruned at start, and at most this often after. */
const PRUNE_EVERY_MS = 60 * 60 * 1_000;

const Config = Type.Object({
  /**
   * How long a settled run, and the requests it settled, are kept (for `answers` and `get`), in days.
   * At least 1: a channel must be able to read an answer after a deploy. With 0, `start` would prune
   * every answer that ended while the channels were stopped (each a `gap`, never delivered), and the
   * hourly prune could drop one settled a moment earlier that a woken channel has not read yet.
   */
  keepSettledDays: Type.Integer({
    minimum: 1,
    default: 7,
    description: "Days a settled run is kept for answers and get. At least 1, so answers that ended during a deploy are still delivered.",
  }),
});

export default defineComponent({
  name: "submissions-sql",
  config: Config,
  setup(pikit, config) {
    const storage = pikit.use("storage.sql");
    let current: { store: Store; clock: Clock } | undefined;
    let prunedAt = 0;

    /** The store, and the app's clock: times are this app's, whoever calls. */
    const running = (): { store: Store; clock: Clock } => {
      if (current === undefined) throw new Error("submissions-sql: agent.submissions used while the app is not running");
      return current;
    };
    const prune = (s: Store, now: number) => {
      prunedAt = now;
      return s.prune(now - config.keepSettledDays * DAY);
    };

    const submissions: AgentSubmissions = {
      admitted(conversation, requestId) {
        const { store, clock } = running();
        return store.admitted(conversation, requestId, clock.now());
      },
      async settled(run: RunSettlement, ctx: AppContext) {
        const { store: s, clock } = running();
        const now = clock.now();
        await s.settled(run, now);
        // Housekeeping rides on a write: no timer to own. A failure only delays it.
        if (now - prunedAt >= PRUNE_EVERY_MS) {
          await prune(s, now).catch((error: unknown) => ctx.logger.warn("submissions-sql: pruning old settlements failed", { error: String(error) }));
        }
      },
      abandoned(conversation, requestIds, reason) {
        const { store, clock } = running();
        return store.abandoned(conversation, requestIds, reason, clock.now());
      },
      pending: () => running().store.pending(),
      get: (conversation, requestId) => running().store.get(conversation.sessionId, requestId),
      answers: { read: (after, limit) => running().store.readAnswers(after, limit) },
    };
    pikit.provide("agent.submissions", submissions);

    return {
      async start(ctx) {
        const s = createStore(storage.get());
        await s.migrate();
        await prune(s, ctx.clock.now());
        current = { store: s, clock: ctx.clock };
      },
      stop() {
        current = undefined;
      },
    };
  },
});
