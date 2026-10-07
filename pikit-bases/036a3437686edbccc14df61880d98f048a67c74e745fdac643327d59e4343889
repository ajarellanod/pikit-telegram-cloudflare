import { useEffect, useState } from "react";

/* ---------------------------------------------------------
 * LOADING STATE: pixel-grid loader for long-running work
 *
 *   Drive: square cells, a chevron wavefront driving right
 *   Dots:  the same wavefront, circular cells
 *   Orbit: a comet lapping the grid perimeter
 *
 * Paired with a shimmering label and the time elapsed since
 * `since` (epoch ms; by default since it appeared), in mono
 * tabular figures.
 * --------------------------------------------------------- */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3),
    c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<string, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

export function LoaderGrid({ variant = "Dots" }: { variant?: string }) {
  const { delays, dur, round } = PATTERNS[variant] ?? (PATTERNS.Dots as (typeof PATTERNS)[string]);
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {delays.map((delay, index) => (
        <span
          key={index}
          className={`size-[4px] bg-ink ${round ? "rounded-full" : "rounded-[1px]"}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

function useElapsed(since: number | undefined) {
  const [start] = useState(() => since ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(0, now - start) / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export default function LoadingState({ label = "Working", variant = "Dots", since }: { label?: string; variant?: string; since?: number }) {
  const elapsed = useElapsed(since);
  return (
    <div role="status" className="flex w-fit items-center gap-2.5">
      <LoaderGrid variant={variant} />
      <span
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  );
}
