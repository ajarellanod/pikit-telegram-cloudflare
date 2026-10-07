import { Computer, HalfMoon, SunLight } from "iconoir-react";
import { setTheme, type Theme, useTheme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: typeof SunLight }[] = [
  { value: "light", label: "Light mode", icon: SunLight },
  { value: "dark", label: "Dark mode", icon: HalfMoon },
  { value: "system", label: "The system's theme", icon: Computer },
];

/** Beautiful UI's sun/moon segmented pill, with a third segment: the system's theme (`lib/theme.ts`). */
export function ThemeToggle() {
  const theme = useTheme();
  const index = OPTIONS.findIndex((option) => option.value === theme);

  return (
    <div role="radiogroup" aria-label="Theme" className="relative inline-grid h-8 grid-cols-3 items-center rounded-full bg-field p-0.5">
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 w-7 rounded-full bg-surface shadow-btn transition-transform duration-200"
        style={{ transform: `translateX(${index * 28}px)`, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      />
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={`relative z-10 flex size-7 items-center justify-center rounded-full transition-colors duration-150 ${theme === value ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
        >
          <Icon width={14} height={14} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
