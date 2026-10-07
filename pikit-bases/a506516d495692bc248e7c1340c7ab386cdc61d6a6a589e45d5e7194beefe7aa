/**
 * The dashboard's built files, served under `/admin/`. They are a module (`dashboard-files.ts`), which
 * the dashboard's own build writes (`src/dashboard/scripts/embed.ts`, after `vite build`): bundled
 * with the app, so every host serves them the same way, a Worker included, with no disk and no binding.
 *
 * - They hold no data: the page asks the operator for the token once, and the browser's session is a
 *   cookie sent to `/admin/api/` only. The files are served to anyone, and every `/admin/api/*` answer
 *   asks `admin.auth`.
 * - A path is decoded and looked up among the files: `..`, an encoded `/` or `\` and a NUL find none.
 * - `/admin` redirects to `/admin/`, so the page's relative URLs resolve under it.
 * - Only `/admin/assets/…` is files alone: a missing one there is a `404` (an old page's script must
 *   not get HTML). Any other path that is not a file is a page of the app and gets `index.html`, whatever
 *   it holds (`/admin/conversations/email%3Aana%40empresa.com~1`, an id with `.`, or `%2F`): the app's
 *   router shows it, and a reload works.
 * - Every answer has a Content-Security-Policy (`CSP`): scripts, styles, fonts, images and API calls
 *   from the same origin only (images also `data:` and `blob:`: one in a transcript, one attached and
 *   not sent yet), no inline script, no framing. Inline styles are allowed: the dialogs'
 *   scroll lock (Radix) sets some, and a style runs no code.
 * - Vite's hashed files (`assets/`) are cached for good; everything else is revalidated.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** What the dashboard's page may load: its own files and its own API, nothing inline but styles. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const HEADERS = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": CSP };

/** Where the files are mounted. */
export const BASE = "/admin";

/** The built files: path under `dist/` (`assets/index-abc.js`) → its bytes in base64. */
export type DashboardFiles = Readonly<Record<string, string>>;

export interface Assets {
  /** Whether a dashboard is built in (`index.html`). */
  built(): boolean;
  /** How many files. */
  size(): number;
  /** The answer to a `GET` of `pathname` (under `/admin`). */
  serve(pathname: string): Response;
}

export function createAssets(files: DashboardFiles): Assets {
  const decoded = new Map<string, Uint8Array<ArrayBuffer>>();
  const bytes = (path: string): Uint8Array<ArrayBuffer> => {
    let found = decoded.get(path);
    if (found === undefined) {
      const binary = atob(files[path] as string);
      found = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) found[i] = binary.charCodeAt(i);
      decoded.set(path, found);
    }
    return found;
  };
  const has = (path: string): boolean => Object.hasOwn(files, path);

  const send = (path: string, cache: string): Response =>
    new Response(bytes(path), { headers: { ...HEADERS, "content-type": TYPES[extension(path)] ?? "application/octet-stream", "cache-control": cache } });

  const notFound = (): Response => new Response("not found", { status: 404, headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" } });

  return {
    built: () => has("index.html"),
    size: () => Object.keys(files).length,
    serve(pathname) {
      if (pathname === BASE) return new Response(null, { status: 308, headers: { ...HEADERS, location: `${BASE}/` } });
      const raw = pathname.slice(BASE.length + 1);
      const segments = segmentsOf(raw.split("/"));
      const path = segments?.join("/") ?? "";

      if (path !== "" && has(path)) return send(path, segments?.[0] === "assets" ? "public, max-age=31536000, immutable" : "no-cache");
      // Under assets/ there are files only; anything else is a page of the app.
      if (segments?.[0] === "assets" || raw.startsWith("assets/")) return notFound();
      if (!has("index.html")) {
        return new Response("no dashboard is built here: the project has no src/dashboard/, or it was not built (its own `bun run build`)", {
          status: 404,
          headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" },
        });
      }
      return send("index.html", "no-cache");
    },
  };
}

/** `.js` of `index-abc.js`, lowercased; `""` without one (a leading dot is a name, not an extension): its type. */
function extension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/** The path's segments, decoded; `undefined` when one is malformed or tries to leave the folder. */
function segmentsOf(raw: string[]): string[] | undefined {
  const segments: string[] = [];
  for (const each of raw) {
    let segment: string;
    try {
      segment = decodeURIComponent(each);
    } catch {
      return undefined;
    }
    if (segment === "..") return undefined;
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return undefined;
    if (segment !== "" && segment !== ".") segments.push(segment);
  }
  return segments;
}
