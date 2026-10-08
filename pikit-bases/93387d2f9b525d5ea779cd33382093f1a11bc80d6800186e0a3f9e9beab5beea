import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/* ---------------------------------------------------------
 * THINKING: the agent's expandable reasoning trace
 *
 * Beautiful UI's ThinkingState (Reasoning variant), driven by the
 * model's own thinking: `text` grows while `working`, the header
 * shimmers, the trace stays open; once it settles the header
 * says so and the trace folds, still expandable. `children`
 * replace the text as the trace (a run's steps), and
 * `openWhileWorking={false}` keeps it folded until opened.
 * --------------------------------------------------------- */

export default function ThinkingState({
  text,
  working,
  active = "Thinking",
  done = "Thought",
  icon,
  openWhileWorking = true,
  children,
}: {
  /** the reasoning so far; paragraphs split on blank lines */
  text?: string;
  /** still being written */
  working: boolean;
  active?: string;
  done?: string;
  /** override the header glyph (defaults to the sparkle) */
  icon?: ReactNode;
  /** the trace opens by itself while `working` */
  openWhileWorking?: boolean;
  /** the trace, instead of `text` */
  children?: ReactNode;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? (working && openWhileWorking);
  const rows = (text ?? "")
    .split(/\n\s*\n/)
    .map((row) => row.trim())
    .filter((row) => row !== "");
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  /* the rail follows the trace's height, whatever changes it (a step opening inside) */
  useLayoutEffect(() => {
    const trace = traceRef.current;
    if (!trace) return;
    const measure = () => setLineHeight(trace.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(trace);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex w-full max-w-[620px] flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded(!expanded)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        {icon ? (
          <span className="flex shrink-0 transition-colors duration-200" style={{ color: working ? "var(--ink-2)" : "var(--ink-3)" }}>
            {icon}
          </span>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={working ? "var(--ink-2)" : "var(--ink-3)"} aria-hidden>
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        )}
        <span role="status" className="contents">
          {working ? (
            <span
              className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              style={{
                backgroundImage: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {active}
            </span>
          ) : (
            <span className="text-[13px] font-medium whitespace-nowrap text-ink-2" style={{ animation: "fade-in 350ms ease-out both" }}>
              {done}
            </span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{ top: -8, height: lineHeight ? lineHeight - 2 : 0, transition: "height 500ms cubic-bezier(0.23,1,0.32,1)" }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {children ?? rows.map((row, i) => (
                <div key={i} className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left" style={{ animation: "fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" }}>
                  <span className="min-w-0 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{row}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
