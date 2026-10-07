/* ---------------------------------------------------------
 * SEARCH FIELD
 * Beautiful UI's SearchList field, fed by the app: a glass,
 * the query, and a clear button once there is one. What it
 * filters is the caller's.
 * --------------------------------------------------------- */

export default function SearchField({ value, onChange, placeholder, label, className = "" }: { value: string; onChange: (value: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <div className={`flex h-8 items-center gap-2 rounded-control bg-surface px-2.5 shadow-btn transition-colors duration-100 focus-within:shadow-[0_0_0_1px_var(--line-strong),0_0_0_3px_var(--accent-tint)] ${className}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
      />
      {value !== "" && (
        <button
          aria-label="Clear search"
          type="button"
          onClick={() => onChange("")}
          className="-mr-1 flex size-6 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
          style={{ animation: "fade-in 150ms ease-out both" }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
