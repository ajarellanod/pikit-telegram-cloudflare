/**
 * The settings' admin routes, one set for every component's section (the dashboard's Settings
 * dialog), registered by both halves: over the App's settings on a server, over calls to the
 * settings object in the Worker on Cloudflare.
 *
 * | Route | Answer |
 * |---|---|
 * | `GET /admin/api/settings` | `{ items: SettingsSection[] }`: every declared component, by name, with its schema, defaults and value |
 * | `GET /admin/api/settings/:component` | its `SettingsSection` (`404 unknown_component`) |
 * | `PUT /admin/api/settings/:component` | body: its whole value (a JSON object) → its `SettingsSection`, the value `get` now gives (`400 invalid_value`, `404 unknown_component`) |
 *
 * Every answer asks `admin.auth` first: no operator, `401` (without a provider, nobody). An error is
 * `{ error, message? }`, as admin-api's; a store that cannot be reached is `503 unavailable`, logged.
 * A body is at most `MAX_BODY` bytes (`413`).
 */

import type { AppContext, Handle, Pikit } from "@pikit/core";
import { type AdminAuth, isJsonObject, type Settings, SettingsError, type SettingsSection, type SettingsValue } from "@pikit/contracts";

/** The largest value a component's settings may be sent as: prompts included, well under a Durable Object row (2 MB). */
export const MAX_BODY = 256 * 1024;

const NO_STORE = { "cache-control": "no-store" };

const failure = (status: number, error: string, message?: string): Response =>
  Response.json({ error, ...(message !== undefined && { message }) }, { status, headers: status === 401 ? { ...NO_STORE, "www-authenticate": 'Bearer realm="pikit"' } : NO_STORE });

/** What the routes need of the settings: the App's own, or the settings object's through calls. */
export type SettingsAdmin = Pick<Settings, "set" | "sections">;

export function provideRoutes(pikit: Pikit, options: { auth: Handle<AdminAuth | undefined>; settings: () => SettingsAdmin }): void {
  /** The route's work for an operator, its refusals as statuses. */
  const guarded =
    (work: (request: Request, operator: { id: string }, ctx: AppContext) => Promise<Response>) =>
    async (request: Request, ctx: AppContext): Promise<Response> => {
      const verifier = options.auth.get();
      const operator = verifier === undefined ? undefined : await verifier.verify(request, ctx);
      if (operator === undefined) return failure(401, "unauthorized");
      try {
        return await work(request, operator, ctx);
      } catch (error) {
        if (error instanceof SettingsError) return failure(error.code === "unknown_component" ? 404 : 400, error.code, error.message);
        ctx.logger.error("settings-store: the settings could not be read or written", { error: error instanceof Error ? error.message : String(error) });
        return failure(503, "unavailable", "the settings cannot be reached now");
      }
    };
  const componentOf = (request: Request): string => decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const section = async (component: string, ctx: AppContext): Promise<SettingsSection> => {
    const found = (await options.settings().sections(ctx)).find((each) => each.component === component);
    if (found === undefined) throw new SettingsError("unknown_component", `"${component}" declared no settings`);
    return found;
  };

  pikit.provideKeyed(
    "http.route",
    "GET /admin/api/settings",
    guarded(async (_request, _operator, ctx) => Response.json({ items: await options.settings().sections(ctx) }, { headers: NO_STORE })),
  );
  pikit.provideKeyed(
    "http.route",
    "GET /admin/api/settings/:component",
    guarded(async (request, _operator, ctx) => Response.json(await section(componentOf(request), ctx), { headers: NO_STORE })),
  );
  pikit.provideKeyed(
    "http.route",
    "PUT /admin/api/settings/:component",
    guarded(async (request, operator, ctx) => {
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > MAX_BODY) return failure(413, "too_large", `a component's settings are at most ${MAX_BODY} bytes`);
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY) return failure(413, "too_large", `a component's settings are at most ${MAX_BODY} bytes`);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return failure(400, "invalid_request", "the body is a JSON object: the component's whole value");
      }
      if (!isJsonObject(value)) return failure(400, "invalid_request", "the body is a JSON object: the component's whole value");
      const component = componentOf(request);
      const stored = await options.settings().set(component, value as SettingsValue, operator, ctx);
      const answer = await section(component, ctx).catch(() => undefined);
      return Response.json(answer === undefined ? { component, value: stored } : { ...answer, value: stored }, { headers: NO_STORE });
    }),
  );
}
