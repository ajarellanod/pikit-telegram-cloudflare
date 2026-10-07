/**
 * Whether the dashboard should ask the API now: only while its tab is visible and the operator has
 * touched it (a key, the pointer, a scroll) within `IDLE_MS`. Polling and live streams pause otherwise
 * and resume at the next touch, so a tab left open asks nothing: on Cloudflare every read is a request
 * of the day's budget (100,000 for the Worker and as many for the Durable Objects on the Free plan),
 * shared with the bot.
 *
 * On Cloudflare (`ApiApp.target` `durable`) polling is also slower (`every`): each list read calls the
 * index and every conversation's object.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

/** Without a touch for this long, the dashboard stops asking. */
export const IDLE_MS = 5 * 60_000;
/** Polling is this many times slower on Cloudflare. */
export const CLOUDFLARE_SLOWER = 3;

const TOUCHES = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"] as const;

let last = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;
let target = "server";
const listeners = new Set<() => void>();

const compute = (): boolean => document.visibilityState === "visible" && Date.now() - last < IDLE_MS;
let active = compute();

function update(): void {
  const next = compute();
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
}

function touch(): void {
  // The pointer moves often: once a second is enough.
  if (active && Date.now() - last < 1000) return;
  last = Date.now();
  update();
  clearTimeout(timer);
  timer = setTimeout(update, IDLE_MS + 100);
}

for (const name of TOUCHES) window.addEventListener(name, touch, { passive: true, capture: true });
document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? touch() : update()));
timer = setTimeout(update, IDLE_MS + 100);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the tab is visible and the operator was there within `IDLE_MS`. */
export function useActive(): boolean {
  return useSyncExternalStore(subscribe, () => active);
}

/** Where the App runs (`ApiApp.target`), which the shell says once it read the composition. */
export function setTarget(value: string): void {
  target = value;
}

/** `ms` for this host: slower on Cloudflare. */
export function every(ms: number): number {
  return target === "durable" ? ms * CLOUDFLARE_SLOWER : ms;
}

/**
 * Calls `tick` every `everyMs` while the dashboard is active (`useActive`), and at once when it
 * becomes active again after a pause. `undefined` polls nothing. Returns whether it is active.
 */
export function usePolling(tick: () => void, everyMs: number | undefined): boolean {
  const isActive = useActive();
  const saved = useRef(tick);
  saved.current = tick;
  const wasActive = useRef(isActive);

  useEffect(() => {
    if (everyMs === undefined || !isActive) {
      wasActive.current = isActive;
      return;
    }
    if (!wasActive.current) saved.current();
    wasActive.current = true;
    const interval = setInterval(() => saved.current(), everyMs);
    return () => clearInterval(interval);
  }, [isActive, everyMs]);

  return isActive;
}
