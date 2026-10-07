/** A switch: `md` is Beautiful UI's atom, `sm` the harness's compact one (for menu rows). */
export function Switch({ checked, onChange, label, size = "md" }: { checked: boolean; onChange?: (value: boolean) => void; label?: string; size?: "sm" | "md" }) {
  const small = size === "sm";
  return (
    <span
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={onChange === undefined ? -1 : 0}
      onClick={onChange === undefined ? undefined : () => onChange(!checked)}
      onKeyDown={(event) => {
        if (onChange !== undefined && (event.key === " " || event.key === "Enter")) {
          event.preventDefault();
          onChange(!checked);
        }
      }}
      className={`relative inline-block shrink-0 rounded-full align-middle transition-colors duration-200 ${small ? "h-4.5 w-7.5" : "h-6 w-10"} ${checked ? (small ? "bg-accent-blue" : "bg-ink") : "bg-line-strong"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-200 ${small ? "size-3.5" : "size-5"}`}
        style={{
          transform: checked ? `translateX(${small ? 12 : 16}px)` : "translateX(0)",
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      />
    </span>
  );
}
