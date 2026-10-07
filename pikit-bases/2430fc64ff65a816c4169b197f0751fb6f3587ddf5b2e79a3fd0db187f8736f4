import type { ReactNode } from "react";

/* ---------------------------------------------------------
 * CONTEXT CARDS
 * Beautiful UI's retrieved chunks, fed by real data: a header
 * with a count, then one card each (a title, a figure, what it
 * says, and its source as a chip that opens it). They enter
 * once, then remain.
 * --------------------------------------------------------- */

export type ContextChunk = {
  key: string;
  title: string;
  /** a short figure at the bar's end: "1,250 characters" */
  meta?: string;
  body: string;
  /** the chip: where it came from */
  source: string;
  /** opens in a new tab */
  href?: string;
  /** a few letters on the chip's mark: "WEB" */
  badge: string;
  /** the mark's colour class: "bg-accent-blue" */
  tone: string;
};

/** The header the harness gives a group of context: its name and a count. */
export function ContextHeader({ title, count }: { title: string; count: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-0.5" style={{ animation: "fade-in 400ms ease-out both" }}>
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      <span className="inline-flex h-5 items-center rounded-md bg-inset px-1.5 text-[11.5px] font-medium text-ink-2 shadow-hairline tabular-nums">{count}</span>
    </div>
  );
}

function SourceChip({ chunk }: { chunk: ContextChunk }) {
  const inner = (
    <>
      <span className={`flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-[4px] px-0.5 ${chunk.tone} text-[7px] font-bold text-white`}>{chunk.badge}</span>
      <span className="min-w-0 truncate">{chunk.source}</span>
      {chunk.href !== undefined && (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <path d="M7 17L17 7M7 7h10v10" />
        </svg>
      )}
    </>
  );
  const className = "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn transition-[background-color] duration-300 hover:bg-hover";
  return chunk.href === undefined ? (
    <span className={className}>{inner}</span>
  ) : (
    <a className={className} href={chunk.href} target="_blank" rel="noreferrer noopener" title={chunk.href}>
      {inner}
    </a>
  );
}

export default function ContextCards({ chunks, header, className = "" }: { chunks: ContextChunk[]; header: string; className?: string }) {
  return (
    <div className={`flex w-full flex-col gap-2 ${className}`}>
      <ContextHeader title={header} count={chunks.length} />
      {chunks.map((chunk, i) => (
        <div key={chunk.key} className="overflow-hidden rounded-card bg-surface shadow-card" style={{ animation: `fade-up 400ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 8) * 60}ms both` }}>
          <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className="shrink-0">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              <span className="truncate" title={chunk.title}>
                {chunk.title}
              </span>
            </span>
            {chunk.meta !== undefined && <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums">{chunk.meta}</span>}
          </div>
          {chunk.body !== "" && <p className="line-clamp-4 px-3 pt-2 pb-1 text-[12.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{chunk.body}</p>}
          <div className="px-3 pt-1 pb-3">
            <SourceChip chunk={chunk} />
          </div>
        </div>
      ))}
    </div>
  );
}
