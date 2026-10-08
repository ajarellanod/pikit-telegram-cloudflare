/**
 * github-app's routes, served by the Worker (its half, `worker.ts`), each a call to the github-app
 * object (`calls.ts`):
 *
 * | Route | What |
 * |---|---|
 * | `GET /admin/api/github-app/status` | `GitHubAppStatus`; `?check=1` reads the installation's repositories and mints a token now |
 * | `POST /admin/api/github-app/start` | `{ organization? }` → `StartResponse`: the form the dashboard posts to GitHub, and a cookie binding it to this browser |
 * | `GET /admin/api/github-app/callback?code&state` | GitHub's redirect once the App is created: converted and stored, then on to installing it |
 * | `GET /admin/api/github-app/setup?installation_id` | GitHub's redirect once it is installed: the installation and its repositories stored, then back to the dashboard |
 * | `PUT /admin/api/github-app/repository` | `{ repository }`: the one tokens are for, among the installation's |
 * | `DELETE /admin/api/github-app` | forgets the App; it stays on GitHub until deleted there |
 *
 * Every route asks `admin.auth` first (without a provider, nobody). The callback and the setup are a
 * browser's navigations from github.com: they carry the dashboard's session cookie, which is
 * `SameSite=Strict` and so is not sent on a navigation from another site. Without an operator they
 * answer a page that loads the same URL again from this site (`BOUNCE`, no script), which sends it;
 * still without one, `401`. A connection is bound to who started it: its `state` is single-use,
 * expires (`STATE_MS`), and must come back with the operator who started it and the browser that holds
 * its nonce (the cookie `pikit_github_app`, `HttpOnly`, `SameSite=Lax` so GitHub's redirect carries it,
 * for these routes only).
 */

import type { AppContext, Handle, Pikit } from "@pikit/core";
import { ActorCallError, type AdminAuth, GITHUB_REPOSITORY, type Operator } from "@pikit/contracts";
import type { DisconnectResponse } from "./api.ts";
import type { RemoteAdmin } from "./calls.ts";
import { STATE_MS } from "./store.ts";

export const ROUTE = "/admin/api/github-app";
/** The cookie holding a started connection's browser nonce. */
export const NONCE_COOKIE = "pikit_github_app";
/** Where the setup ends: the dashboard, its Settings → GitHub open. */
export const DASHBOARD_SECTION = "/admin/?settings=github-app";
/** The query parameter a page that loaded its URL again adds, so it does it once. */
const BOUNCE = "pikit_bounced";
const MAX_BODY = 4 * 1024;

const NO_STORE = { "cache-control": "no-store" };
/** The pages' policy: no script, nothing loaded, not framed. */
const PAGE_HEADERS = {
  ...NO_STORE,
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/** HTTP statuses of the object's refusals. */
const STATUS: Record<string, number> = {
  invalid_request: 400,
  invalid_state: 403,
  already_connected: 409,
  not_connected: 409,
  not_installed: 409,
  key_changed: 409,
  github_refused: 502,
};

const failure = (status: number, error: string, message?: string, headers: Record<string, string> = {}): Response =>
  Response.json({ error, ...(message !== undefined && { message }) }, { status, headers: { ...NO_STORE, ...headers } });

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small page of its own: the browser's routes answer pages, not JSON. */
function page(status: number, title: string, body: string, refresh?: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${
    refresh === undefined ? "" : `<meta http-equiv="refresh" content="0;url=${escape(refresh)}">`
  }<title>${escape(title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem;color:#222}a{color:inherit}</style></head><body><h1 style="font-size:19px">${escape(title)}</h1><p>${escape(body)}</p><p><a href="/admin/">Back to the dashboard</a></p></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

const redirect = (location: string, cookie?: string): Response =>
  new Response(null, { status: 302, headers: { ...NO_STORE, location, ...(cookie !== undefined && { "set-cookie": cookie }) } });

function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

const isHttps = (request: Request) => new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
const nonceCookie = (request: Request, value: string, maxAge: number) =>
  `${NONCE_COOKIE}=${value}; Path=${ROUTE}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(request) ? "; Secure" : ""}`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function provideRoutes(pikit: Pikit, options: { auth: Handle<AdminAuth | undefined>; admin: RemoteAdmin }): void {
  const { admin } = options;
  const operatorOf = async (request: Request, ctx: AppContext): Promise<Operator | undefined> => options.auth.get()?.verify(request, ctx);

  /** An API route: the operator or `401`; the object's refusals as their statuses. */
  const guarded =
    (work: (request: Request, operator: Operator, ctx: AppContext) => Promise<Response>) =>
    async (request: Request, ctx: AppContext): Promise<Response> => {
      const operator = await operatorOf(request, ctx);
      if (operator === undefined) return failure(401, "unauthorized", undefined, { "www-authenticate": 'Bearer realm="pikit"' });
      try {
        return await work(request, operator, ctx);
      } catch (error) {
        if (error instanceof ActorCallError && STATUS[error.code] !== undefined) return failure(STATUS[error.code] as number, error.code, error.message);
        ctx.logger.error("github-app: the github-app object could not be reached", { error: messageOf(error) });
        return failure(503, "unavailable", "The GitHub connection cannot be reached now: try again");
      }
    };

  /** A browser's navigation from GitHub: the operator, once the page loaded itself again from this site if need be. */
  const browser =
    (work: (url: URL, request: Request, operator: Operator, ctx: AppContext) => Promise<Response>) =>
    async (request: Request, ctx: AppContext): Promise<Response> => {
      const url = new URL(request.url);
      const operator = await operatorOf(request, ctx);
      if (operator === undefined) {
        if (url.searchParams.has(BOUNCE)) {
          return page(401, "Sign in to the dashboard first", "This page needs your dashboard's session. Sign in to the dashboard in this browser, then connect GitHub again from Settings → GitHub.");
        }
        // The session cookie is SameSite=Strict: a navigation started on github.com does not carry it, one started here does.
        url.searchParams.set(BOUNCE, "1");
        return page(200, "Connecting GitHub", "One moment.", `${url.pathname}${url.search}`);
      }
      try {
        return await work(url, request, operator, ctx);
      } catch (error) {
        if (error instanceof ActorCallError && STATUS[error.code] !== undefined) {
          return page(STATUS[error.code] as number, "GitHub was not connected", error.message);
        }
        ctx.logger.error("github-app: the github-app object could not be reached", { error: messageOf(error) });
        return page(503, "GitHub was not connected", "The GitHub connection cannot be reached now: go back and try again.");
      }
    };

  /** The request's JSON object (`{}` without a body). */
  const bodyOf = async (request: Request): Promise<Record<string, unknown>> => {
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new ActorCallError("invalid_request", "the body is too large");
    if (raw.trim() === "") return {};
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ActorCallError("invalid_request", "the body is not JSON");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ActorCallError("invalid_request", "the body is a JSON object");
    return body as Record<string, unknown>;
  };

  pikit.provideKeyed(
    "http.route",
    `GET ${ROUTE}/status`,
    guarded(async (request, _operator, ctx) => Response.json(await admin.status(new URL(request.url).searchParams.get("check") === "1", ctx), { headers: NO_STORE })),
  );

  pikit.provideKeyed(
    "http.route",
    `POST ${ROUTE}/start`,
    guarded(async (request, operator, ctx) => {
      const body = await bodyOf(request);
      const organization = typeof body.organization === "string" && body.organization.trim() !== "" ? body.organization.trim() : undefined;
      if (body.organization !== undefined && typeof body.organization !== "string") throw new ActorCallError("invalid_request", "organization is a GitHub organization's login");
      const { nonce, ...form } = await admin.start({ origin: new URL(request.url).origin, operator: operator.id, ...(organization !== undefined && { organization }) }, ctx);
      return Response.json(form, { headers: { ...NO_STORE, "set-cookie": nonceCookie(request, nonce, STATE_MS / 1000) } });
    }),
  );

  pikit.provideKeyed(
    "http.route",
    `GET ${ROUTE}/callback`,
    browser(async (url, request, operator, ctx) => {
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (state === "") return page(400, "GitHub was not connected", "GitHub's answer has no state: start again from the dashboard's Settings → GitHub.");
      const nonce = cookieOf(request, NONCE_COOKIE);
      const { installUrl } = await admin.connect({ state, code, operator: operator.id, ...(nonce !== undefined && { nonce }) }, ctx);
      // Done with the nonce: forgotten, and on to installing the App.
      return redirect(installUrl, nonceCookie(request, "", 0));
    }),
  );

  pikit.provideKeyed(
    "http.route",
    `GET ${ROUTE}/setup`,
    browser(async (url, _request, operator, ctx) => {
      const id = Number(url.searchParams.get("installation_id"));
      if (!Number.isSafeInteger(id) || id <= 0) return redirect(DASHBOARD_SECTION);
      await admin.install({ installationId: id, operator: operator.id }, ctx);
      return redirect(DASHBOARD_SECTION);
    }),
  );

  pikit.provideKeyed(
    "http.route",
    `PUT ${ROUTE}/repository`,
    guarded(async (request, operator, ctx) => {
      const { repository } = await bodyOf(request);
      if (typeof repository !== "string" || !GITHUB_REPOSITORY.test(repository)) throw new ActorCallError("invalid_request", "repository is owner/name");
      return Response.json(await admin.choose({ repository, operator: operator.id }, ctx), { headers: NO_STORE });
    }),
  );

  pikit.provideKeyed(
    "http.route",
    `DELETE ${ROUTE}`,
    guarded(async (_request, operator, ctx) => {
      const { settingsUrl } = await admin.disconnect(operator.id, ctx);
      const answer: DisconnectResponse = { disconnected: true, ...(settingsUrl !== undefined && { settingsUrl }) };
      return Response.json(answer, { headers: NO_STORE });
    }),
  );
}
