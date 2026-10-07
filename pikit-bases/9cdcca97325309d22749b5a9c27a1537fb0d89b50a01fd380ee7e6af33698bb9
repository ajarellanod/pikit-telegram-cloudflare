import type { ReactNode } from "react";

/** Monospace token chip, for code values like `agent.runtime`. Beautiful UI's Chip. */
export function Chip({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "accent" | "orange"; className?: string }) {
  const tones = {
    neutral: "bg-inset text-ink-2",
    accent: "bg-accent-tint text-accent-ink",
    orange: "bg-orange-tint text-orange",
  };
  return <code className={`inline rounded-md px-1.5 py-0.5 align-[-1px] font-mono text-[12px] leading-none ${tones[tone]} ${className}`}>{children}</code>;
}

type Tone = "neutral" | "green" | "orange" | "red" | "accent";

const TONES: Record<Tone, { cls: string; ring: string }> = {
  neutral: { cls: "bg-field text-ink-2", ring: "var(--shadow-hairline)" },
  green: { cls: "bg-green-tint text-green", ring: "0 0 0 1px color-mix(in oklch, var(--green) 28%, transparent)" },
  orange: { cls: "bg-orange-tint text-orange", ring: "0 0 0 1px color-mix(in oklch, var(--orange) 28%, transparent)" },
  red: { cls: "bg-red-tint text-red", ring: "0 0 0 1px color-mix(in oklch, var(--red) 28%, transparent)" },
  accent: { cls: "bg-accent-tint text-accent-ink", ring: "0 0 0 1px color-mix(in oklch, var(--accent-blue) 28%, transparent)" },
};

/**
 * Inline value badge: a plain value (a date, a name, a count) set off in prose. Softer than a
 * StatusPill (no dot) and not a mono token (see Chip). Beautiful UI's ValuePill.
 */
export function ValuePill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  const t = TONES[tone];
  return (
    <span className={`mx-0.5 inline-flex items-center rounded-full px-1.5 py-0 align-middle text-[12px] font-medium ${t.cls} ${className}`} style={{ boxShadow: t.ring }}>
      {children}
    </span>
  );
}
