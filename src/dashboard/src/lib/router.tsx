/**
 * A small router over the History API, under /admin (admin-api answers every path but `/admin/assets/`
 * and its files with index.html, so a reload of any page works). Paths here are relative to /admin:
 * `/conversations/abc` is `/admin/conversations/abc`.
 *
 * A parameter is one path segment, encoded in a link (`encodeURIComponent`: an id such as
 * `email:ana@empresa.com~1` or one with `/`) and decoded by `match`.
 */

import { type AnchorHTMLAttributes, useSyncExternalStore } from "react";

export const BASE = "/admin";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const path = (): string => {
  const { pathname } = window.location;
  const relative = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  return relative === "" ? "/" : relative;
};

/** The current path, relative to /admin. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, path);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const url = `${BASE}${to}`;
  if (options.replace === true) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * The parameters of `pattern` (`/conversations/:id`) in `pathname`, or `undefined` when it does not
 * match.
 */
export function match(pattern: string, pathname: string): Record<string, string> | undefined {
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  if (want.length !== have.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, segment] of want.entries()) {
    const value = have[i] ?? "";
    if (segment.startsWith(":")) {
      try {
        params[segment.slice(1)] = decodeURIComponent(value);
      } catch {
        return undefined;
      }
    } else if (segment !== value) return undefined;
  }
  return params;
}

/** The path of a page with `id` as one segment: `pagePath("/conversations", id)`. */
export function pagePath(base: string, id: string): string {
  return `${base}/${encodeURIComponent(id)}`;
}

/** A link inside the dashboard: `to` is relative to /admin. */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      {...rest}
      href={`${BASE}${to}`}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}
