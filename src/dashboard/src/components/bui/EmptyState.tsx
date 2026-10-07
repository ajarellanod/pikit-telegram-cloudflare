import type { ReactNode } from "react";

/* ---------------------------------------------------------
 * EMPTY STATE
 * Beautiful UI's SearchList "no results", fed by the app: a
 * glyph in a quiet square, what is (not) there, and a hint.
 * --------------------------------------------------------- */

export default function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center" style={{ animation: "fade-in 250ms ease-out both" }}>
      <span className="mb-1.5 flex size-8 items-center justify-center rounded-control bg-inset text-ink-3 shadow-hairline [&_svg]:size-[15px]">
        {icon ?? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        )}
      </span>
      <span className="text-[13px] font-medium text-ink">{title}</span>
      {hint !== undefined && <span className="max-w-sm text-[12px] text-ink-3">{hint}</span>}
    </div>
  );
}
