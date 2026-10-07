/**
 * The theme: light, dark, or the system's (the default), remembered in this browser
 * (`localStorage["pikit-theme"]`). `public/theme.js` applies it before the first paint (no inline
 * script: the Content-Security-Policy); this module keeps `<html class="dark">` in step afterwards,
 * the system's changes included.
 */

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "pikit-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let theme = stored();

function apply(): void {
  const dark = theme === "dark" || (theme === "system" && media.matches);
  const root = document.documentElement;
  if (root.classList.contains("dark") === dark) return;
  // Every token flips at once: no transition while it does.
  root.classList.add("theme-switching");
  root.classList.toggle("dark", dark);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

media.addEventListener("change", apply);
apply();

export function setTheme(next: Theme): void {
  theme = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Not remembered: this page still switches.
  }
  apply();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The operator's choice (not what it resolves to). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => theme);
}
