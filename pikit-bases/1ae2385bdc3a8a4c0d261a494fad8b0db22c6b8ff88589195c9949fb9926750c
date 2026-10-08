import { useState, type ReactNode } from "react";

/* ---------------------------------------------------------
 * TOOL CHIPS
 * An agent run's tool calls as compact rows, each with an inline
 * chip (what it was called on). Beautiful UI's primitive, fed by
 * the run: a running call spins, a failed one says so, and every
 * row expands to what the tool returned (or is returning).
 * Without a `header` the rows stand alone, always shown.
 * --------------------------------------------------------- */

const Icons: Record<string, ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </g>
  ),
  run: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17l6-5-6-5M12 19h8" />
    </g>
  ),
  read: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </g>
  ),
  tool: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </g>
  ),
};

/** `running`: going now; `waiting`: called, not started; `none`: the run ended without its result. */
export type ToolStatus = "running" | "done" | "failed" | "waiting" | "none";

export type ToolStep = {
  id: string;
  icon: "think" | "write" | "run" | "read" | "tool";
  label: string;
  /** what it was called on: a path, a command */
  chip?: string;
  mono: boolean;
  status: ToolStatus;
  /** what it returned, or is returning */
  detail?: string;
};

function Spinner() {
  return <span aria-label="Running" className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: "spin 700ms linear infinite" }} />;
}

export default function ToolChips({ steps, header, className }: { steps: ToolStep[]; header?: string; className?: string }) {
  const [expanded, setExpanded] = useState(true);
  const open = header === undefined || expanded;
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) =>
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={`w-full max-w-80 pb-1${className ? ` ${className}` : ""}`}>
      {/* collapsed run header */}
      {header !== undefined && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setExpanded((current) => !current)}
          className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="tabular-nums">{header}</span>
        </button>
      )}

      <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
        {/* -mx-1 + px-1.5 keeps content at the same x while giving the
            row hover pills room inside this overflow-hidden clip box */}
        <div className="-mx-1 overflow-hidden px-1.5 pb-1">
          <div className={`flex flex-col gap-1 ${header === undefined ? "" : "mt-1.5"}`}>
            {steps.map((row) => {
              const rowOpen = openRows.has(row.id);
              const failed = row.status === "failed";
              return (
                <div key={row.id} style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
                  <button
                    type="button"
                    aria-expanded={rowOpen}
                    onClick={() => toggleRow(row.id)}
                    title={row.chip}
                    className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 hover:bg-hover-2"
                  >
                    <span className={`relative flex size-4 shrink-0 items-center justify-center ${failed ? "text-red" : "text-ink-3"}`}>
                      {row.status === "running" ? (
                        <span className={`flex transition-opacity duration-100 group-hover/row:opacity-0 ${rowOpen ? "opacity-0" : ""}`}>
                          <Spinner />
                        </span>
                      ) : (
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill={row.icon === "think" ? "currentColor" : "none"}
                          stroke="currentColor"
                          className={`transition-opacity duration-100 group-hover/row:opacity-0 ${rowOpen ? "opacity-0" : ""}`}
                          aria-hidden
                        >
                          {Icons[row.icon]}
                        </svg>
                      )}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${rowOpen ? "opacity-100" : "opacity-0"}`}
                        style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                    <span className={`shrink-0 text-[12.5px] font-medium ${failed ? "text-red" : "text-ink"}`}>{row.label}</span>
                    {row.chip !== undefined && row.chip !== "" && (
                      <span
                        className={`inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline transition-colors duration-100 hover:bg-hover-2 ${row.mono ? "font-mono" : ""}`}
                      >
                        <span className="truncate">{row.chip}</span>
                      </span>
                    )}
                  </button>

                  {/* expanded detail */}
                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-300"
                    style={{ gridTemplateRows: rowOpen ? "1fr" : "0fr", opacity: rowOpen ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                        <pre
                          className={`max-h-56 overflow-auto font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere] ${failed ? "text-red" : "text-ink-2"}`}
                        >
                          {row.detail !== undefined && row.detail !== "" ? row.detail : row.status === "running" ? "No output yet." : row.status === "none" ? "No result: the run ended first." : "(no output)"}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
