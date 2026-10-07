import { type ReactNode, useEffect, useState } from "react";

/* ---------------------------------------------------------
 * CODE BLOCK
 * Beautiful UI's editor panel, fed by the app: a file's
 * name, a copy button, and its lines numbered and coloured
 * (strings and numbers orange, keywords blue, keys and
 * calls in ink). Lines wrap.
 * --------------------------------------------------------- */

const KEYWORDS = new Set(["import", "from", "export", "default", "async", "function", "const", "let", "var", "await", "return", "if", "else", "for", "while", "new", "throw", "try", "catch", "null", "true", "false", "undefined"]);
const TOKEN =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined)\b|[A-Za-z_$][\w$]*(?=\s*\())/g;

function highlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    const t = m[0];
    if (idx > last) nodes.push(<span key={k++}>{text.slice(last, idx)}</span>);
    const end = idx + t.length;
    let color: string;
    let weight: number | undefined;
    // a JSON key: a string a colon follows
    if (t.startsWith('"') && /^\s*:/.test(text.slice(end))) {
      color = "var(--ink)";
      weight = 500;
    } else if (/^["'`]/.test(t) || /^-?\d/.test(t)) color = "var(--orange)";
    else if (KEYWORDS.has(t)) color = "var(--accent-ink)";
    else {
      color = "var(--ink)";
      weight = 500;
    }
    nodes.push(
      <span key={k++} style={{ color, fontWeight: weight }}>
        {t}
      </span>,
    );
    last = end;
  }
  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>);
  return nodes;
}

function FileIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3">
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

export default function CodeBlock({ code, filename, meta, className = "" }: { code: string; filename: string; /** after the name: what the code is */ meta?: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");
  // the gutter grows with the line numbers' digits
  const gutter = Math.max(20, String(lines.length).length * 7 + 8);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <div className={`w-full overflow-hidden rounded-card bg-surface shadow-card ${className}`}>
      <div className="flex h-11 items-center gap-2 border-b border-line px-4 text-[12.5px]">
        <span className="inline-flex min-w-0 items-center gap-[7px]">
          <FileIcon />
          <span className="truncate font-mono leading-none text-ink">{filename}</span>
        </span>
        {meta !== undefined && <span className="truncate text-[12px] text-ink-3">{meta}</span>}
        <button
          type="button"
          aria-label="Copy code"
          onClick={copy}
          className={`-mr-1 ml-auto flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-medium transition-colors duration-100 hover:bg-hover ${copied ? "text-green" : "text-ink-3 hover:text-ink"}`}
        >
          {copied ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="12" height="12" rx="2.5" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="py-3 font-mono text-[12.5px] leading-[1.65] text-ink-2">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 w-px bg-line" style={{ left: gutter }} />
          {lines.map((line, i) => (
            <div key={i} className="grid items-start" style={{ gridTemplateColumns: `${gutter}px minmax(0,1fr)` }}>
              <span className="select-none text-center text-[11px] text-ink-3">{i + 1}</span>
              <code className="pr-3 pl-2 break-words whitespace-pre-wrap">{highlight(line)}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
