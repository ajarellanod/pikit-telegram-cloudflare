/**
 * Opening pi-durable again after a storage error closed it (the runtime's `onFailure`), so what it
 * left pending (a run, queued messages, a retry) does not wait for a message. With `wakeups` the
 * driver asks for a wakeup after `next()` (index.ts), and a handler whose open fails is retried by the
 * wakeups provider; on a server `createReopener` opens it from a timer, and retries a failed open.
 */

import type { AppContext } from "@pikit/core";

/** The wait after the first storage error. */
export const REOPEN_FIRST_MS = 1_000;
/** The longest wait. */
export const REOPEN_MAX_MS = 5 * 60_000;
/** Longer than the longest wait: errors this far apart are not in a row, and the waits start over. */
export const REOPEN_QUIET_MS = 10 * 60_000;

/**
 * The waits before opening pi-durable again: `REOPEN_FIRST_MS` after the first storage error, doubled
 * for each error in a row up to `REOPEN_MAX_MS`. An open that works does not start them over: a
 * storage that opens and fails again at once would be opened every second. They start over once
 * `REOPEN_QUIET_MS` pass without an error.
 */
export function createReopenBackoff(now: () => number): () => number {
  let failures = 0;
  let last: number | undefined;
  return () => {
    const at = now();
    if (last !== undefined && at - last >= REOPEN_QUIET_MS) failures = 0;
    last = at;
    const wait = Math.min(REOPEN_FIRST_MS * 2 ** failures, REOPEN_MAX_MS);
    if (wait < REOPEN_MAX_MS) failures++;
    return wait;
  };
}

export interface Reopener {
  /** The runtime's `onFailure`: opens pi-durable again after the backoff's next wait. */
  failed(): void;
  /** Cancels what is asked; nothing is opened after. */
  stop(): void;
}

/**
 * Without `wakeups` (a server): `open` pi-durable again from a timer after the backoff's next wait. An
 * open that fails counts as one more error, and is tried again.
 */
export function createReopener(open: () => Promise<void>, background: AppContext, backoff: () => number): Reopener {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const failed = (): void => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      open().catch((error: unknown) => {
        if (stopped) return;
        background.logger.error("runtime-pi: opening pi-durable again after a storage error failed; it tries again later", {
          error: error instanceof Error ? error.message : String(error),
        });
        failed();
      });
    }, backoff());
  };
  return {
    failed,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
