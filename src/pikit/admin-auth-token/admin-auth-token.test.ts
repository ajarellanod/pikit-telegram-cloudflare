/**
 * admin-auth-token's tests. They are copied with the component and keep running in your project.
 */

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, type Handle, silentLogger } from "@pikit/core";
import { ADMIN_CLIENT_HEADER, type AdminAuth, type SecretStore } from "@pikit/contracts";
import { createAdminAuthConformance } from "@pikit/contracts/testing";
import { createManualClock } from "@pikit/core/testing";
import adminAuthToken, { MIN_TOKEN_LENGTH, SESSION_COOKIE, SESSION_MS } from "./index.ts";

const TOKEN = "a".repeat(20) + "-operator-token-0123456789";

/** `secrets` holding `values`. */
function secrets(values: Record<string, string>) {
  const store: SecretStore = { get: async (name) => (values[name] === "" ? undefined : values[name]) };
  return defineComponent({ name: "secrets-test", setup: (pikit) => pikit.provide("secrets", store) });
}

// What every admin route can rely on (`admin.auth`).
for (const c of createAdminAuthConformance(() => ({
  components: [secrets({ PIKIT_ADMIN_TOKEN: TOKEN }), adminAuthToken],
  operator: { authorization: `Bearer ${TOKEN}` },
  credential: TOKEN,
  intruders: [
    { authorization: `Bearer ${TOKEN}x` },
    { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
    { authorization: `Basic ${btoa(`operator:${TOKEN}`)}` },
    { authorization: TOKEN },
    { authorization: "Bearer " },
    { "x-admin-token": TOKEN },
  ],
  unconfigured: { components: [secrets({}), adminAuthToken] },
}))) {
  test(`admin-auth-token ${c.group}: ${c.name}`, () => c.run());
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [secrets({}), adminAuthToken], logger: silentLogger }).create();

  expect(app.describe().components.find((c) => c.name === "admin-auth-token")).toEqual({ name: "admin-auth-token", provides: ["admin.auth"], requires: ["secrets"], optional: [] });
});

test("a token shorter than 32 characters stops the start, naming the secret, never the token", async () => {
  const short = "s".repeat(MIN_TOKEN_LENGTH - 1);
  const app = await defineApp({ components: [secrets({ PIKIT_ADMIN_TOKEN: short }), adminAuthToken], logger: silentLogger }).create();

  const error = await app.start().then(
    () => undefined,
    (thrown: unknown) => thrown as Error,
  );

  expect(String(error?.cause)).toContain("PIKIT_ADMIN_TOKEN is shorter than 32 characters");
  expect(String(error?.cause)).not.toContain(short);
});

/** A started App with the token, on a manual clock, and its `admin.auth`. */
async function started(token = TOKEN) {
  let handle: Handle<AdminAuth> | undefined;
  const reader = defineComponent({ name: "reader-test", setup: (pikit) => void (handle = pikit.use("admin.auth")) });
  const clock = createManualClock();
  const app = await defineApp({ components: [secrets({ PIKIT_ADMIN_TOKEN: token }), adminAuthToken, reader], clock, logger: silentLogger }).create();
  await app.start();
  return { auth: handle?.get() as AdminAuth, clock, app, ctx: app.context(BACKGROUND_CONTEXT) };
}

const cookieRequest = (cookie: string, init: RequestInit = {}) =>
  new Request("http://localhost:3000/admin/api/app", { ...init, headers: { cookie: cookie.split(";")[0] as string, ...(init.headers as Record<string, string> | undefined) } });

test("a session lasts 12 hours on the App's clock, then it is no operator", async () => {
  const { auth, clock, app, ctx } = await started();
  const session = await auth.sessions?.open(new Request("http://localhost:3000/admin/api/session", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), ctx);
  expect(session?.cookie).toStartWith(`${SESSION_COOKIE}=`);
  expect(session?.cookie).toContain(`Max-Age=${SESSION_MS / 1000}`);
  expect(session?.cookie).toContain("Path=/admin/api");

  await clock.advance(SESSION_MS - 1);
  expect(await auth.verify(cookieRequest(session?.cookie as string), ctx)).toEqual({ id: "operator" });
  await clock.advance(1);
  expect(await auth.verify(cookieRequest(session?.cookie as string), ctx)).toBeUndefined();
  await app.stop();
});

test("the cookie is Secure over https, and behind a proxy that says so; not over plain http (pikit dev)", async () => {
  const { auth, app, ctx } = await started();
  const open = (url: string, headers: Record<string, string> = {}) =>
    auth.sessions?.open(new Request(url, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, ...headers } }), ctx);

  expect((await open("http://localhost:3000/admin/api/session"))?.cookie).not.toContain("Secure");
  expect((await open("http://app:3000/admin/api/session", { "x-forwarded-proto": "https" }))?.cookie).toContain("; Secure");
  expect((await open("https://bot.example.workers.dev/admin/api/session"))?.cookie).toContain("; Secure");
  await app.stop();
});

test("a bearer token decides alone: a wrong one with a valid cookie is no operator; a new token ends the old sessions", async () => {
  const first = await started();
  const session = await first.auth.sessions?.open(new Request("https://pikit.test/admin/api/session", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), first.ctx);
  const cookie = session?.cookie as string;
  expect(await first.auth.verify(cookieRequest(cookie, { method: "POST", headers: { [ADMIN_CLIENT_HEADER]: "1" } }), first.ctx)).toEqual({ id: "operator" });
  expect(await first.auth.verify(cookieRequest(cookie, { headers: { authorization: "Bearer wrong" } }), first.ctx)).toBeUndefined();
  await first.app.stop();

  const rotated = await started(`${TOKEN}-rotated`);
  expect(await rotated.auth.verify(cookieRequest(cookie), rotated.ctx)).toBeUndefined();
  await rotated.app.stop();
});

test("tokenSecret names another secret", async () => {
  const app = await defineApp({
    components: [secrets({ OPS_TOKEN: TOKEN }), adminAuthToken],
    config: { "admin-auth-token": { tokenSecret: "OPS_TOKEN" } },
    logger: silentLogger,
  }).create();

  await app.start();
  await app.stop();
});
