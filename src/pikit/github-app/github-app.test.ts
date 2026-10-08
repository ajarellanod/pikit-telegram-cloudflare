/**
 * github-app's tests. They are copied with the component and keep running in your project, under
 * `bun test`, against a fake GitHub reached through `fetch` (`fake-github.test-support.ts`: the manifest
 * conversion, installations, tokens checked against the App's JWT, pull requests) and a double of
 * Cloudflare's objects (every call reaches the github-app object's App): the `github` suite, the whole
 * connection through the Worker's routes, the state's checks, the credentials sealed at rest, tokens
 * kept and minted again, one, several or no repositories, and disconnecting. pikit also runs it in
 * workerd on a real Durable Object (`tests/workerd`).
 */

import { afterEach, expect, test } from "bun:test";
import { type App, type AppContext, BACKGROUND_CONTEXT, type ComponentDefinition, defineApp, defineComponent, type Logger, silentLogger } from "@pikit/core";
import {
  ActorCallError,
  type ActorCallHandler,
  type ActorMailbox,
  type AdminAuth,
  answerCall,
  callResult,
  compareHttpRoutes,
  type GitHubAccess,
  type HttpRoute,
  isGitHubNotConnected,
  type JsonValue,
  matchesHttpRoute,
  parseHttpRouteKey,
} from "@pikit/contracts";
import { createGitHubConformance } from "@pikit/contracts/testing";
import { createManualClock, type ManualClock } from "@pikit/core/testing";
import { sqliteStorage } from "@pikit/pi-adapter/testing";
import type { GitHubAppStatus, StartResponse } from "./api.ts";
import { CALL, GITHUB_APP_KEY } from "./calls.ts";
import { appJwt, credentialsKey, pkcs8Of, seal, unseal } from "./crypto.ts";
import { createFakeGitHubApp, type FakeGitHubApp } from "./fake-github.test-support.ts";
import githubApp, { worker } from "./index.ts";
import { appNameOf } from "./store.ts";

const ADMIN = "an-admin-token-of-at-least-32-characters";
const realFetch = globalThis.fetch;
const apps: App[] = [];
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop().catch(() => {});
  globalThis.fetch = realFetch;
});

const copy = (value: JsonValue): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

/** Cloudflare's objects, as far as github-app goes: every call reaches the object App started last (the github-app object). */
class Objects {
  readonly calls: string[] = [];
  private readonly live: { answers: Map<string, ActorCallHandler>; ctx: () => AppContext }[] = [];
  readonly mailbox: ActorMailbox = {
    send: async () => {
      throw new Error("github-app sends nothing");
    },
    call: async (key, type, message) => {
      this.calls.push(`${key} ${type}`);
      const object = this.live.at(-1);
      const handler = object?.answers.get(type);
      if (object === undefined || handler === undefined) throw new ActorCallError("no_handler", `no answer handler for ${type}`);
      return callResult(await answerCall(handler, key, copy(message), object.ctx()));
    },
  };
  platform(): ComponentDefinition {
    const answers = new Map<string, ActorCallHandler>();
    const objects = this;
    return defineComponent({
      name: "platform-test",
      setup(pikit) {
        pikit.provide("actor.inbox", { handle: () => {}, answer: (type, handler) => void answers.set(type, handler) });
        pikit.provide("actor.mailbox", objects.mailbox);
        let entry: (typeof objects.live)[number] | undefined;
        return {
          start(ctx) {
            const context = ctx.derive(() => BACKGROUND_CONTEXT);
            entry = { answers, ctx: () => context };
            objects.live.push(entry);
          },
          stop() {
            if (entry !== undefined) objects.live.splice(objects.live.indexOf(entry), 1);
          },
        };
      },
    });
  }
}

const secretsOf = (values: Record<string, string>) =>
  defineComponent({ name: "secrets-test", setup: (pikit) => pikit.provide("secrets", { get: async (name: string) => values[name] }) });

/** The github-app object's App: its storage, the admin token, the platform's double. */
function objectComponents(objects: Objects, storage: ComponentDefinition, secrets: Record<string, string>): ComponentDefinition[] {
  return [storage, secretsOf(secrets), objects.platform(), githubApp];
}

// The contract: what admin-proposals, execution-do and extension-pikit-self rely on.
for (const c of createGitHubConformance(async () => {
  const clock = createManualClock(Date.now());
  const github = await createFakeGitHubApp({ now: clock.now });
  globalThis.fetch = github.fetch as typeof fetch;
  const objects = new Objects();
  const storage = sqliteStorage();
  const ask = (type: string, message: JsonValue, ctx: AppContext) => objects.mailbox.call(GITHUB_APP_KEY, type, message, ctx);
  return {
    components: () => objectComponents(objects, storage, { PIKIT_ADMIN_TOKEN: ADMIN }),
    config: { "github-app": { freshMs: 0 } },
    target: "durable" as const,
    async connect(repository, ctx) {
      if (((await ask(CALL.status, { check: false }, ctx)) as unknown as GitHubAppStatus).app === undefined) {
        const started = (await ask(CALL.start, { origin: "https://bot.ana.workers.dev", operator: "ops" }, ctx)) as unknown as StartResponse & { nonce: string };
        const state = new URL(started.action).searchParams.get("state") as string;
        await ask(CALL.connect, { state, nonce: started.nonce, operator: "ops", code: github.approve(started.manifest) }, ctx);
      }
      await ask(CALL.install, { installationId: github.install([repository]), operator: "ops" }, ctx);
    },
    disconnect: async (ctx) => void (await ask(CALL.disconnect, { operator: "ops" }, ctx)),
    accepts: async (token, repository) => github.accepts(token, repository),
  };
})) {
  test(`github-app ${c.group}: ${c.name}`, () => c.run());
}

/** Operators: a bearer token (a script) or the dashboard's session cookie, each naming who. */
const auth = defineComponent({
  name: "auth-test",
  setup(pikit) {
    const provider: AdminAuth = {
      async verify(request) {
        const bearer = /^Bearer (\w+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        const session = /(?:^|;\s*)session=(\w+)/.exec(request.headers.get("cookie") ?? "")?.[1];
        const who = bearer ?? session;
        return who === "ops" || who === "eve" ? { id: who } : undefined;
      },
    };
    pikit.provide("admin.auth", provider);
  },
});

const OPS = { authorization: "Bearer ops" };

interface Deployment {
  clock: ManualClock;
  github: FakeGitHubApp;
  objects: Objects;
  secrets: Record<string, string>;
  storage: ComponentDefinition;
  logged: { message: string; fields?: Record<string, unknown> }[];
  /** The Worker's `github`. */
  access(): GitHubAccess;
  ctx(): AppContext;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** The github-app object evicted: a new App over the same storage. */
  restartObject(): Promise<void>;
}

/** A deployment: the github-app object's App and the Worker's App (its routes served by a double of a server), over a fake GitHub. */
async function deployment(): Promise<Deployment> {
  const clock = createManualClock(Date.now());
  const github = await createFakeGitHubApp({ now: clock.now });
  globalThis.fetch = github.fetch as typeof fetch;
  const objects = new Objects();
  const storage = sqliteStorage();
  const secrets: Record<string, string> = { PIKIT_ADMIN_TOKEN: ADMIN };
  const logged: Deployment["logged"] = [];
  const record = (message: string, fields?: Record<string, unknown>) => void logged.push({ message, ...(fields !== undefined && { fields }) });
  const logger: Logger = { ...silentLogger, info: record, warn: record, error: record };
  let object: App | undefined;
  const startObject = async () => {
    object = await defineApp({ components: objectComponents(objects, storage, secrets), config: { "github-app": { freshMs: 0 } }, logger, clock, target: "durable" }).create();
    await object.start();
    apps.push(object);
  };
  await startObject();

  let routes: { get(key: string): HttpRoute | undefined; keys(): string[] } | undefined;
  let access: GitHubAccess | undefined;
  const server = defineComponent({
    name: "server-test",
    setup(pikit) {
      const handle = pikit.useKeyed("http.route");
      const github = pikit.use("github");
      return { start: () => void ((routes = handle), (access = github.get())) };
    },
  });
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", objects.mailbox) });
  const app = await defineApp({ components: [mailbox, auth, worker, server], logger, clock, target: "durable" }).create();
  await app.start();
  apps.push(app);
  return {
    clock,
    github,
    objects,
    secrets,
    storage,
    logged,
    access: () => access as GitHubAccess,
    ctx: () => app.context(),
    async fetch(path, init = {}) {
      const request = new Request(`https://bot.ana.workers.dev${path}`, init);
      const { pathname } = new URL(request.url);
      const key = (routes?.keys() ?? [])
        .map((each) => ({ each, parsed: parseHttpRouteKey(each) }))
        .filter((r) => r.parsed !== undefined && matchesHttpRoute(r.parsed, request.method, pathname))
        .sort((a, b) => compareHttpRoutes(a.parsed!, b.parsed!))[0]?.each;
      if (key === undefined) return new Response("not found", { status: 404 });
      return routes!.get(key)!(request, app.context());
    },
    async restartObject() {
      await object?.stop();
      await startObject();
    },
  };
}

/** The cookie a response sets, as `name=value`. */
const cookieSet = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0] as string;

/** The dashboard's Connect: the form for GitHub and this browser's nonce cookie. */
async function start(d: Deployment, body: unknown = {}) {
  const response = await d.fetch("/admin/api/github-app/start", { method: "POST", headers: { ...OPS, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
  const form = (await response.json()) as StartResponse;
  return { form, state: new URL(form.action).searchParams.get("state") as string, nonce: cookieSet(response) };
}

/** GitHub's redirect to a browser route, with the dashboard's session (or not) and the nonce cookie. */
const browse = (d: Deployment, path: string, cookies: string[]) => d.fetch(path, { headers: cookies.length === 0 ? {} : { cookie: cookies.join("; ") } });

/** The whole connection: Connect, create on GitHub, install on `repositories`. */
async function connect(d: Deployment, repositories: string[]) {
  const { form, state, nonce } = await start(d);
  const callback = await browse(d, `/admin/api/github-app/callback?code=${d.github.approve(form.manifest)}&state=${state}`, ["session=ops", nonce]);
  expect(callback.status).toBe(302);
  const installation = d.github.install(repositories);
  const setup = await browse(d, `/admin/api/github-app/setup?installation_id=${installation}&setup_action=install`, ["session=ops"]);
  expect([setup.status, setup.headers.get("location")]).toEqual([302, "/admin/?settings=github-app"]);
  return installation;
}

const status = async (d: Deployment, check = false) => (await (await d.fetch(`/admin/api/github-app/status${check ? "?check=1" : ""}`, { headers: OPS })).json()) as GitHubAppStatus;

test("what setup declares: component.json's provides / requires / optional come from it, for both halves", async () => {
  const objectApp = await defineApp({ components: objectComponents(new Objects(), sqliteStorage(), {}), logger: silentLogger, target: "durable" }).create();
  expect(objectApp.describe().components.find((each) => each.name === "github-app")).toEqual({
    name: "github-app",
    provides: ["github"],
    requires: ["storage.sql", "secrets", "actor.inbox", "actor.mailbox"],
    optional: [],
  });
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", new Objects().mailbox) });
  const workerApp = await defineApp({ components: [mailbox, worker], logger: silentLogger, target: "durable" }).create();
  expect(workerApp.describe().components.find((each) => each.name === "github-app-worker")).toEqual({
    name: "github-app-worker",
    provides: ["github", "http.route"],
    requires: ["actor.mailbox"],
    optional: ["admin.auth"],
  });
});

test("connect in two clicks: the manifest, GitHub's callback, the install; then tokens for the repository, signed with the App's key", async () => {
  const d = await deployment();
  expect(await status(d)).toEqual({ connected: false });
  expect(isGitHubNotConnected(await d.access().token(d.ctx()).catch((error: unknown) => error))).toBe(true);

  const { form, state, nonce } = await start(d);
  expect(form.action).toBe(`https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`);
  expect(nonce).toMatch(/^pikit_github_app=[A-Za-z0-9_-]{43}$/);
  expect(JSON.parse(form.manifest)).toEqual({
    name: "pikit-bot-ana",
    url: "https://bot.ana.workers.dev",
    description: expect.stringContaining("bot.ana.workers.dev"),
    redirect_url: "https://bot.ana.workers.dev/admin/api/github-app/callback",
    setup_url: "https://bot.ana.workers.dev/admin/api/github-app/setup",
    setup_on_update: true,
    public: false,
    hook_attributes: { url: "https://bot.ana.workers.dev", active: false },
    default_permissions: { contents: "write", pull_requests: "write", checks: "read", statuses: "read", metadata: "read" },
    default_events: [],
  });

  // GitHub redirects the browser: the dashboard's session is SameSite=Strict, so the page loads itself again from here.
  const code = d.github.approve(form.manifest);
  const first = await browse(d, `/admin/api/github-app/callback?code=${code}&state=${state}`, [nonce]);
  expect(first.status).toBe(200);
  expect(await first.text()).toContain(`url=/admin/api/github-app/callback?code=${code}&#38;state=${state}&#38;pikit_bounced=1`);
  const callback = await browse(d, `/admin/api/github-app/callback?code=${code}&state=${state}&pikit_bounced=1`, ["session=ops", nonce]);
  expect([callback.status, callback.headers.get("location")]).toEqual([302, "https://github.com/apps/pikit-bot-ana/installations/new"]);
  expect(callback.headers.get("set-cookie")).toContain("pikit_github_app=; Path=/admin/api/github-app; Max-Age=0");

  const installing = await status(d);
  expect(installing).toMatchObject({ connected: false, app: { id: 4242, slug: "pikit-bot-ana", owner: "ana", settingsUrl: "https://github.com/settings/apps/pikit-bot-ana/advanced" } });
  expect(installing.installation).toBeUndefined();

  const installation = d.github.install(["ana/bot"]);
  const setup = await browse(d, `/admin/api/github-app/setup?installation_id=${installation}&setup_action=install`, ["session=ops"]);
  expect([setup.status, setup.headers.get("location")]).toEqual([302, "/admin/?settings=github-app"]);
  expect(await status(d)).toMatchObject({ connected: true, repository: "ana/bot", installation: { id: installation, account: "ana", repositories: ["ana/bot"], url: `https://github.com/settings/installations/${installation}` } });

  // The Worker's `github`: the repository, and a token GitHub takes for it (its pull requests).
  expect(await d.access().repository(d.ctx())).toBe("ana/bot");
  const token = await d.access().token(d.ctx());
  expect(d.github.accepts(token, "ana/bot")).toBe(true);
  expect(d.github.minted.at(-1)?.repositories).toEqual(["ana/bot"]);
  const pulls = await fetch("https://api.github.com/repos/ana/bot/pulls", { headers: { authorization: `Bearer ${token}` } });
  expect(pulls.status).toBe(200);
  expect((await status(d)).lastToken).toMatchObject({ ok: true, at: d.clock.now() });

  // The App's own credentials only ever went to GitHub's API, and no log line holds a secret.
  const logged = JSON.stringify(d.logged);
  expect(logged).toContain("github-app: GitHub App created and stored");
  for (const secret of [token, "fake-client-secret-never-shown", "PRIVATE KEY", ADMIN]) expect(logged).not.toContain(secret);
  expect(d.github.requests.every((request) => request.authorization === null || request.authorization.startsWith("Bearer "))).toBe(true);
});

test("the state: unknown, replayed, expired, another browser's or another operator's, or without a session, is refused before GitHub is asked", async () => {
  const d = await deployment();
  const conversions = () => d.github.requests.filter((request) => request.path.startsWith("/app-manifests/")).length;
  const callback = (state: string, code: string, cookies: string[]) => browse(d, `/admin/api/github-app/callback?code=${code}&state=${state}&pikit_bounced=1`, cookies);

  // Without the dashboard's session, even once loaded again from here: 401.
  const started = await start(d);
  const code = d.github.approve(started.form.manifest);
  const anonymous = await callback(started.state, code, [started.nonce]);
  expect(anonymous.status).toBe(401);
  expect(await anonymous.text()).toContain("Sign in to the dashboard first");
  // Unknown.
  expect((await callback("not-a-state", code, ["session=ops", started.nonce])).status).toBe(403);
  // Another browser (no nonce, or another one): refused, and the state is spent.
  expect((await callback(started.state, code, ["session=ops", "pikit_github_app=someone-elses"])).status).toBe(403);
  const replay = await callback(started.state, code, ["session=ops", started.nonce]);
  expect(replay.status).toBe(403);
  expect(await replay.text()).toContain("unknown or was finished already");

  // Another operator than the one who started it.
  const second = await start(d);
  expect((await callback(second.state, d.github.approve(second.form.manifest), ["session=eve", second.nonce])).status).toBe(403);

  // Expired: fifteen minutes.
  const third = await start(d);
  await d.clock.advance(16 * 60 * 1000);
  const expired = await callback(third.state, d.github.approve(third.form.manifest), ["session=ops", third.nonce]);
  expect(expired.status).toBe(403);
  expect(await expired.text()).toContain("expired");
  expect(conversions()).toBe(0);

  // A good one is used once: the same callback again is refused.
  const good = await start(d);
  const goodCode = d.github.approve(good.form.manifest);
  expect((await callback(good.state, goodCode, ["session=ops", good.nonce])).status).toBe(302);
  expect((await callback(good.state, goodCode, ["session=ops", good.nonce])).status).toBe(403);
  expect(conversions()).toBe(1);

  // Routes need an operator; the start of a second App is refused while one is connected.
  expect((await d.fetch("/admin/api/github-app/start", { method: "POST" })).status).toBe(401);
  expect((await d.fetch("/admin/api/github-app/status")).status).toBe(401);
  const again = await d.fetch("/admin/api/github-app/start", { method: "POST", headers: OPS });
  expect([again.status, ((await again.json()) as { error: string }).error]).toEqual([409, "already_connected"]);
  // An organization's App is created there.
  expect((await d.fetch("/admin/api/github-app", { method: "DELETE", headers: OPS })).status).toBe(200);
  expect((await start(d, { organization: "acme" })).form.action).toStartWith("https://github.com/organizations/acme/settings/apps/new?state=");
});

test("the credentials are sealed at rest with a key derived from the admin token; another admin token cannot read them", async () => {
  const d = await deployment();
  await connect(d, ["ana/bot"]);
  // What the table holds: the key and the secrets only sealed.
  let rows: Record<string, unknown>[] = [];
  const reader = defineComponent({
    name: "reader-test",
    setup(pikit) {
      const sql = pikit.use("storage.sql");
      return { start: async () => void (rows = await sql.get().query("SELECT * FROM github_app")) };
    },
  });
  const peek = await defineApp({ components: [d.storage, reader], logger: silentLogger }).create();
  await peek.start();
  await peek.stop();
  const stored = JSON.stringify(rows);
  expect(rows[0]).toMatchObject({ slug: "pikit-bot-ana", client_id: "Iv23liFakeClientId", repository: "ana/bot" });
  expect(stored).not.toContain("PRIVATE KEY");
  expect(stored).not.toContain("fake-client-secret-never-shown");
  expect(String(rows[0]?.sealed)).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  const opened = JSON.parse(await unseal(await credentialsKey(ADMIN), String(rows[0]?.sealed))) as { pem: string; clientSecret: string };
  expect(opened.pem).toContain("BEGIN RSA PRIVATE KEY");
  expect(opened.clientSecret).toBe("fake-client-secret-never-shown");

  // The admin token changes: the object, started again, cannot read them, and says to connect again.
  d.secrets.PIKIT_ADMIN_TOKEN = "another-admin-token-of-32-characters-at-least";
  await d.restartObject();
  const changed = await status(d);
  expect(changed.connected).toBe(false);
  expect(changed.problem).toContain("PIKIT_ADMIN_TOKEN changed since GitHub was connected");
  const refused = await d.access().token(d.ctx()).catch((error: unknown) => error);
  expect((refused as ActorCallError).code).toBe("key_changed");
});

test("tokens: one is kept while it lasts and shared, a new one minted before it expires", async () => {
  const d = await deployment();
  await connect(d, ["ana/bot"]);
  // The setup minted one for all the installation's repositories, to list them.
  const before = d.github.minted.length;
  const minted = () => d.github.minted.length - before;
  const first = await d.access().token(d.ctx());
  const [second, third] = await Promise.all([d.access().token(d.ctx()), d.access().token(d.ctx())]);
  expect([second, third]).toEqual([first, first]);
  expect(minted()).toBe(1);

  await d.clock.advance(50 * 60 * 1000);
  expect(await d.access().token(d.ctx())).toBe(first);
  // Six minutes before GitHub's hour: a new one, which lasts.
  await d.clock.advance(5 * 60 * 1000);
  const renewed = await d.access().token(d.ctx());
  expect(renewed).not.toBe(first);
  expect(minted()).toBe(2);
  expect(d.github.accepts(renewed, "ana/bot")).toBe(true);

  // GitHub down: the failure is recorded (never a token), and the next call tries again.
  await d.clock.advance(56 * 60 * 1000);
  d.github.down = true;
  const failed = await d.access().token(d.ctx()).catch((error: unknown) => error);
  expect((failed as ActorCallError).code).toBe("github_refused");
  expect((await status(d)).lastToken).toMatchObject({ ok: false, error: expect.stringContaining("GitHub answered 503") });
  d.github.down = false;
  expect(d.github.accepts(await d.access().token(d.ctx()), "ana/bot")).toBe(true);
});

test("repositories: one is the repository; several are the operator's to choose; none says so", async () => {
  const several = await deployment();
  await connect(several, ["ana/bot", "ana/site"]);
  expect(await status(several)).toMatchObject({ connected: false, installation: { repositories: ["ana/bot", "ana/site"] } });
  expect((await status(several)).repository).toBeUndefined();
  expect(await several.access().repository(several.ctx())).toBeUndefined();
  const put = (body: unknown) => several.fetch("/admin/api/github-app/repository", { method: "PUT", headers: { ...OPS, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await put({ repository: "ana/elsewhere" })).status).toBe(400);
  expect((await put({ repository: "no slash" })).status).toBe(400);
  const chosen = await put({ repository: "ANA/site" });
  expect(chosen.status).toBe(200);
  expect(((await chosen.json()) as GitHubAppStatus).repository).toBe("ana/site");
  const token = await several.access().token(several.ctx());
  expect([several.github.accepts(token, "ana/site"), several.github.accepts(token, "ana/bot")]).toEqual([true, false]);

  const none = await deployment();
  await connect(none, []);
  const empty = await status(none);
  expect(empty).toMatchObject({ connected: false, installation: { repositories: [] } });
  expect(((await none.access().token(none.ctx()).catch((error: unknown) => error)) as Error).message).toContain("choose the project's repository");

  // An installation that is not this App's: GitHub refuses the App's JWT for it, and nothing changes.
  const foreign = await browse(none, "/admin/api/github-app/setup?installation_id=999999", ["session=ops"]);
  expect(foreign.status).toBe(502);
  expect(await foreign.text()).toContain("GitHub answered 404");
});

test("disconnect forgets the App, revokes the token it kept, and says where to delete the App on GitHub", async () => {
  const d = await deployment();
  await connect(d, ["ana/bot"]);
  const token = await d.access().token(d.ctx());
  const response = await d.fetch("/admin/api/github-app", { method: "DELETE", headers: OPS });
  expect(await response.json()).toEqual({ disconnected: true, settingsUrl: "https://github.com/settings/apps/pikit-bot-ana/advanced" });
  expect(d.github.accepts(token, "ana/bot")).toBe(false);
  expect(await status(d)).toEqual({ connected: false });
  // The Worker's App kept its last answers a second.
  await d.clock.advance(1_001);
  expect(await d.access().repository(d.ctx())).toBeUndefined();
  expect(isGitHubNotConnected(await d.access().token(d.ctx()).catch((error: unknown) => error))).toBe(true);
  expect(d.logged.map((line) => line.message)).toContain("github-app: disconnected");
});

test("crypto: GitHub's PKCS#1 key signs a JWT the public key verifies; the App's name from the Worker's host", async () => {
  const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer);
  const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...der))}\n-----END ${label}-----`;
  // PKCS#8 as it is; PKCS#1 (its inner key, from offset 26 for a 2048-bit key) wrapped back into the same bytes.
  expect(pkcs8Of(pem("PRIVATE KEY", pkcs8))).toEqual(pkcs8);
  expect(pkcs8Of(pem("RSA PRIVATE KEY", pkcs8.slice(26)))).toEqual(pkcs8);
  const jwt = await appJwt(pem("RSA PRIVATE KEY", pkcs8.slice(26)), "Iv1.abc", 1_700_000_000_000);
  const [header, payload, signature] = jwt.split(".") as [string, string, string];
  const bytes = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keys.publicKey, bytes(signature), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
  expect(JSON.parse(new TextDecoder().decode(bytes(payload)))).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: "Iv1.abc" });

  const key = await credentialsKey(ADMIN);
  const sealed = await seal(key, "hello");
  expect(sealed).not.toBe(await seal(key, "hello"));
  expect(await unseal(key, sealed)).toBe("hello");
  await expect(unseal(await credentialsKey(`${ADMIN}x`), sealed)).rejects.toThrow();

  expect(appNameOf("pikit-telegram-bot.ana.workers.dev")).toBe("pikit-telegram-bot-ana");
  expect(appNameOf("bot.example.com")).toBe("pikit-bot");
  expect(appNameOf("a-very-long-worker-name-for-a-bot.someone-with-a-long-name.workers.dev").length).toBeLessThanOrEqual(34);
});
