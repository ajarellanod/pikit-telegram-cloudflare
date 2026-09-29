/**
 * Where the object's half registers its `actor.inbox` handler: the only place that knows how.
 *
 * `actor.inbox` is a single capability with registration by method, as `wakeups.handle`: the half
 * `use`s it in `setup` and calls `handle(type, handler)` in its `start`. The mailbox's provider then
 * depends on no handler, so this half may also use `wakeups` and the runtime, which drives its runs
 * with the same `wakeups` (platform-cloudflare provides both in the object): no dependency cycle.
 */

import type { Pikit } from "@pikit/core";
import type { ActorInboxHandler } from "@pikit/contracts";

export interface InboxRegistration {
  /** Call in the component's `start`, once its handler can run. Throws if `type` already has a handler. */
  start(): void;
}

/** Declares the use of `actor.inbox` for `handler`, of messages of `type`. Call in `setup`. */
export function registerInbox(pikit: Pikit, type: string, handler: ActorInboxHandler): InboxRegistration {
  const inbox = pikit.use("actor.inbox");
  return { start: () => inbox.get().handle(type, handler) };
}
