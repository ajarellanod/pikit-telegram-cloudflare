/** Small formatting helpers shared by views. */

import type { ApiUsage } from "./api.ts";

/** A cost in dollars: `$0.0042`, `$1.23`. */
export function formatCost(usage: ApiUsage | undefined): string {
  const total = usage?.cost.total ?? 0;
  if (total === 0) return "$0";
  return `$${total < 0.01 ? total.toFixed(4) : total.toFixed(2)}`;
}

/** Tokens, short: `950`, `12.3k`, `1.2M`. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** `3 minutes ago`, from epoch milliseconds. */
export function formatAgo(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return "—";
  const seconds = Math.round((at - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return relative.format(value, unit);
    value = Math.round(value / size);
  }
  return relative.format(value, "year");
}
