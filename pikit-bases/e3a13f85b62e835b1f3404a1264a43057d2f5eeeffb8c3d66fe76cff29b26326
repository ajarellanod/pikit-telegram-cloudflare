/**
 * settings-store's tests. They are copied with the component and keep running in your project: the
 * `settings` conformance suite on both targets (a server's table; on Cloudflare an object's App reading
 * the settings object through calls, a double of the platform's), the admin routes, and what an
 * object's cache spends in calls.
 */

import { afterEach, expect, test } from "bun:test";
import { type App, type AppContext, BACKGROUND_CONTEXT, type ComponentDefinition, defineApp, defineComponent, type Handle, type Logger, silentLogger, type Target } from "@pikit/core";
import {
  ActorCallError,
  type ActorCallHandler,
  type ActorMailbox,
  type AdminAuth,
  answerCall,
  callResult,
  compareHttpRoutes,
  type HttpRoute,
  type JsonValue,
  matchesHttpRoute,
  parseHttpRouteKey,
  type Settings,
  type SettingsSection,
} from "@pikit/contracts";
import { createSettingsConformance } from "@pikit/contracts/testing";
import { createManualClock } from "@pikit/core/testing";
import { sqliteStorage } from "@pikit/pi-adapter/testing";
import Type from "typebox";
import { CALL, SETTINGS_KEY } from "./calls.ts";
import settingsStore, { worker } from "./index.ts";
import { MAX_BODY } from "./routes.ts";

const copy = (value: JsonValue): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

// On a server: the App's own table.
for (const c of createSettingsConformance(() => {
  const storage = sqliteStorage();
  return { components: () => [storage, settingsStore] };
})) {
  test(`settings-store (server) ${c.group}: ${c.name}`, () => c.run());
}

/**
 * Cloudflare's objects, as far as settings go: every key's calls reach the App started last that
 * answers them (the settings object; a restart replaces it), as `actor.mailbox.call` reaches a Durable
 * Object. `calls` counts them.
 */
class Objects {
  readonly calls: string[] = [];
  private readonly live: { answers: Map<string, ActorCallHandler>; ctx: () => AppContext }[] = [];
  unreachable = false;

  readonly mailbox: ActorMailbox = {
    send: async () => {
      throw new Error("settings-store sends nothing");
    },
    call: async (key, type, message) => {
      this.calls.push(`${key} ${type}`);
      if (this.unreachable) throw new ActorCallError("unreachable", "the settings object could not be reached");
      const object = this.live.at(-1);
      const handler = object?.answers.get(type);
      if (object === undefined || handler === undefined) throw new ActorCallError("no_handler", `no answer handler for ${type}`);
      return callResult(await answerCall(handler, key, copy(message), object.ctx()));
    },
  };

  /** The platform of one object's App: its inbox, and the mailbox to the settings object. */
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
            const at = entry === undefined ? -1 : objects.live.indexOf(entry);
            if (at !== -1) objects.live.splice(at, 1);
          },
        };
      },
    });
  }
}

// On Cloudflare: each App reads and writes the settings object through calls (read through: freshMs 0).
for (const c of createSettingsConformance(() => {
  const storage = sqliteStorage();
  const objects = new Objects();
  return {
    components: () => [storage, objects.platform(), settingsStore],
    config: { "settings-store": { freshMs: 0 } },
    target: "durable" as Target,
  };
})) {
  test(`settings-store (durable) ${c.group}: ${c.name}`, () => c.run());
}

const AUTH = { authorization: "Bearer operator-token" };
const auth = defineComponent({
  name: "auth-test",
  setup(pikit) {
    const provider: AdminAuth = { verify: async (request) => (request.headers.get("authorization") === AUTH.authorization ? { id: "ops" } : undefined) };
    pikit.provide("admin.auth", provider);
  },
});

const AGENT = Type.Object({
  model: Type.Union([Type.Literal("faux/small"), Type.Literal("faux/large")], { title: "Model" }),
  prompt: Type.String({ title: "System prompt" }),
});

/** A component that declares its settings in start, as one does, and keeps the handle. */
function declarer(holder: { settings?: Settings }): ComponentDefinition {
  return defineComponent({
    name: "declarer-test",
    setup(pikit) {
      const handle: Handle<Settings> = pikit.use("settings");
      return {
        start() {
          holder.settings = handle.get();
          holder.settings.declare("agent", AGENT, { model: "faux/small", prompt: "Be brief." });
        },
      };
    },
  });
}

interface Served {
  app: App;
  logged: { message: string; fields?: Record<string, unknown> }[];
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

const apps: App[] = [];
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop().catch(() => {});
});

/** An App of `components` whose routes are served by a double of a server. */
async function serve(components: ComponentDefinition[], options: { target?: Target; config?: Record<string, unknown>; logger?: Logger; clock?: ReturnType<typeof createManualClock> } = {}): Promise<Served> {
  const logged: Served["logged"] = [];
  const logger: Logger = options.logger ?? { ...silentLogger, info: (message, fields) => void logged.push({ message, ...(fields !== undefined && { fields }) }), error: (message, fields) => void logged.push({ message, ...(fields !== undefined && { fields }) }) };
  let routes: { get(key: string): HttpRoute | undefined; keys(): string[] } | undefined;
  const server = defineComponent({
    name: "server-test",
    setup(pikit) {
      const handle = pikit.useKeyed("http.route");
      return { start: () => void (routes = handle) };
    },
  });
  const app = await defineApp({
    components: [...components, server],
    logger,
    ...(options.target !== undefined && { target: options.target }),
    ...(options.config !== undefined && { config: options.config }),
    ...(options.clock !== undefined && { clock: options.clock }),
  }).create();
  await app.start();
  apps.push(app);
  return {
    app,
    logged,
    async fetch(path, init = {}) {
      const request = new Request(`http://pikit.test${path}`, init);
      const { pathname } = new URL(request.url);
      const key = (routes?.keys() ?? [])
        .map((each) => ({ each, parsed: parseHttpRouteKey(each) }))
        .filter((r) => r.parsed !== undefined && matchesHttpRoute(r.parsed, request.method, pathname))
        .sort((a, b) => compareHttpRoutes(a.parsed!, b.parsed!))[0]?.each;
      if (key === undefined) return new Response("not found", { status: 404 });
      return routes!.get(key)!(request, app.context());
    },
  };
}

const put = (value: unknown): RequestInit => ({ method: "PUT", headers: { ...AUTH, "content-type": "application/json" }, body: JSON.stringify(value) });

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", new Objects().mailbox) });
  const objectApp = await defineApp({ components: [sqliteStorage(), settingsStore], logger: silentLogger }).create();
  const workerApp = await defineApp({ components: [mailbox, worker], logger: silentLogger }).create();

  expect(objectApp.describe().components.slice(1)).toEqual([{ name: "settings-store", provides: ["settings", "http.route"], requires: ["storage.sql"], optional: ["admin.auth", "actor.inbox", "actor.mailbox"] }]);
  expect(workerApp.describe().components.slice(1)).toEqual([{ name: "settings-store-worker", provides: ["settings", "http.route"], requires: ["actor.mailbox"], optional: ["admin.auth"] }]);
});

test("the routes answer an operator only: 401 without the credential, and without an admin.auth", async () => {
  const holder: { settings?: Settings } = {};
  const served = await serve([sqliteStorage(), settingsStore, declarer(holder)]);
  for (const [path, init] of [
    ["/admin/api/settings", {}],
    ["/admin/api/settings/agent", {}],
    ["/admin/api/settings/agent", { method: "PUT", body: "{}" }],
  ] as const) {
    expect((await served.fetch(path, init)).status).toBe(401);
  }
  const authed = await serve([sqliteStorage(), auth, settingsStore, declarer({})]);
  expect((await authed.fetch("/admin/api/settings", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
});

test("GET lists every section with its schema, defaults and value; PUT sets one, and GET reads it", async () => {
  const holder: { settings?: Settings } = {};
  const served = await serve([sqliteStorage(), auth, settingsStore, declarer(holder)]);

  const listed = (await (await served.fetch("/admin/api/settings", { headers: AUTH })).json()) as { items: SettingsSection[] };
  expect(listed.items).toEqual([{ component: "agent", schema: JSON.parse(JSON.stringify(AGENT)), defaults: { model: "faux/small", prompt: "Be brief." }, value: { model: "faux/small", prompt: "Be brief." } }]);

  const response = await served.fetch("/admin/api/settings/agent", put({ prompt: "Answer in French." }));
  expect(response.status).toBe(200);
  expect(((await response.json()) as SettingsSection).value).toEqual({ model: "faux/small", prompt: "Answer in French." });
  expect(((await (await served.fetch("/admin/api/settings/agent", { headers: AUTH })).json()) as SettingsSection).value).toEqual({ model: "faux/small", prompt: "Answer in French." });
  expect(await holder.settings?.get("agent", served.app.context())).toEqual({ model: "faux/small", prompt: "Answer in French." });
  // Logged with the operator, never the value.
  expect(served.logged).toContainEqual({ message: "settings-store: settings changed", fields: { component: "agent", operator: "ops", keys: ["prompt"] } });
  expect(JSON.stringify(served.logged)).not.toContain("French");
});

test("PUT refuses what is not a valid value: 400 invalid_value or invalid_request, 404 for an unknown component, 413 past MAX_BODY", async () => {
  const served = await serve([sqliteStorage(), auth, settingsStore, declarer({})]);
  const refused = async (path: string, init: RequestInit) => {
    const response = await served.fetch(path, init);
    return { status: response.status, error: ((await response.json()) as { error: string }).error };
  };

  expect(await refused("/admin/api/settings/agent", put({ model: "faux/huge" }))).toEqual({ status: 400, error: "invalid_value" });
  expect(await refused("/admin/api/settings/agent", put(["not", "an", "object"]))).toEqual({ status: 400, error: "invalid_request" });
  expect(await refused("/admin/api/settings/agent", { ...put({}), body: "{not json" })).toEqual({ status: 400, error: "invalid_request" });
  expect(await refused("/admin/api/settings/nobody", put({}))).toEqual({ status: 404, error: "unknown_component" });
  expect(await refused("/admin/api/settings/nobody", { headers: AUTH })).toEqual({ status: 404, error: "unknown_component" });
  expect(await refused("/admin/api/settings/agent", put({ prompt: "x".repeat(MAX_BODY) }))).toEqual({ status: 413, error: "too_large" });
});

test("on Cloudflare the Worker's routes are calls to the settings object, which validates, stores and logs", async () => {
  const objects = new Objects();
  const holder: { settings?: Settings } = {};
  const object = await serve([sqliteStorage(), auth, objects.platform(), settingsStore, declarer(holder)], { target: "durable" });
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", objects.mailbox) });
  const workerApp = await serve([auth, mailbox, worker], { target: "durable" });

  expect(((await (await workerApp.fetch("/admin/api/settings", { headers: AUTH })).json()) as { items: SettingsSection[] }).items.map((each) => each.component)).toEqual(["agent"]);
  expect((await workerApp.fetch("/admin/api/settings/agent", put({ model: "faux/large" }))).status).toBe(200);
  expect(((await (await workerApp.fetch("/admin/api/settings/agent", put({ model: "faux/huge" }))).json()) as { error: string }).error).toBe("invalid_value");
  expect((await workerApp.fetch("/admin/api/settings/nobody", { headers: AUTH })).status).toBe(404);
  expect(object.logged).toContainEqual({ message: "settings-store: settings changed", fields: { component: "agent", operator: "ops", keys: ["model"] } });
  expect(objects.calls.every((call) => call.startsWith(`${SETTINGS_KEY} `))).toBe(true);
  // The settings object's App reads its own value, through the same call as any object.
  expect(await holder.settings?.get("agent", object.app.context())).toEqual({ model: "faux/large", prompt: "Be brief." });

  objects.unreachable = true;
  const unreachable = await workerApp.fetch("/admin/api/settings", { headers: AUTH });
  expect(unreachable.status).toBe(503);
});

test("on Cloudflare the Worker's App reads its components' settings from the settings object too, and sets them there", async () => {
  const objects = new Objects();
  const clock = createManualClock();
  const inObject: { settings?: Settings } = {};
  const inWorker: { settings?: Settings } = {};
  const object = await serve([sqliteStorage(), auth, objects.platform(), settingsStore, declarer(inObject)], { target: "durable", clock });
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", objects.mailbox) });
  const workerApp = await serve([auth, mailbox, worker, declarer(inWorker)], { target: "durable", clock });
  const settings = inWorker.settings as Settings;

  expect(await settings.get("agent", workerApp.app.context())).toEqual({ model: "faux/small", prompt: "Be brief." });
  // Set from the dashboard (the Worker's route): the Worker reads it once its second is past.
  expect((await workerApp.fetch("/admin/api/settings/agent", put({ model: "faux/large" }))).status).toBe(200);
  await clock.advance(1_000);
  expect(await settings.get("agent", workerApp.app.context())).toEqual({ model: "faux/large", prompt: "Be brief." });
  // Its own set goes to the settings object, and its next get asks again.
  await settings.set("agent", { prompt: "Shorter." }, { id: "ops" }, workerApp.app.context());
  expect(await settings.get("agent", workerApp.app.context())).toEqual({ model: "faux/small", prompt: "Shorter." });
  expect(await inObject.settings?.get("agent", object.app.context())).toEqual({ model: "faux/small", prompt: "Shorter." });
  await expect(settings.set("nobody", {}, { id: "ops" }, workerApp.app.context())).rejects.toThrow("declared no settings");
});

test("an object asks the settings object at most once per freshMs, and only for what changed; unreachable, it keeps what it read", async () => {
  const objects = new Objects();
  const clock = createManualClock();
  const holder: { settings?: Settings } = {};
  const logged: string[] = [];
  const logger: Logger = { ...silentLogger, warn: (message) => void logged.push(message) };
  const served = await serve([sqliteStorage(), objects.platform(), settingsStore, declarer(holder)], { target: "durable", clock, logger });
  const settings = holder.settings as Settings;
  const ctx = served.app.context();

  await settings.get("agent", ctx);
  await Promise.all([settings.get("agent", ctx), settings.get("agent", ctx)]);
  expect(objects.calls).toEqual([`${SETTINGS_KEY} ${CALL.read}`]);

  await clock.advance(1_000);
  await settings.set("agent", { prompt: "Shorter." }, { id: "ops" }, ctx);
  // Its own set: the next get asks at once.
  expect(await settings.get("agent", ctx)).toEqual({ model: "faux/small", prompt: "Shorter." });
  expect(objects.calls).toEqual([`${SETTINGS_KEY} ${CALL.read}`, `${SETTINGS_KEY} ${CALL.set}`, `${SETTINGS_KEY} ${CALL.read}`]);

  await clock.advance(1_000);
  objects.unreachable = true;
  expect(await settings.get("agent", ctx)).toEqual({ model: "faux/small", prompt: "Shorter." });
  expect(logged).toContain("settings-store: the settings object could not be read; the values read last apply");
});

test("an object that never read the settings object, which cannot be reached, rejects get: its caller keeps what it had", async () => {
  const objects = new Objects();
  objects.unreachable = true;
  const holder: { settings?: Settings } = {};
  const served = await serve([sqliteStorage(), objects.platform(), settingsStore, declarer(holder)], { target: "durable" });

  await expect(holder.settings?.get("agent", served.app.context()) as Promise<unknown>).rejects.toThrow("could not be reached");
});

test("in an object's App it needs actor.inbox and actor.mailbox; without them its start says so", async () => {
  const app = await defineApp({ components: [sqliteStorage(), settingsStore], target: "durable", logger: silentLogger }).create();

  const error = (await app.start().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )) as { cause?: Error } | undefined;
  expect(error?.cause?.message).toContain("needs actor.inbox, actor.mailbox: install platform-cloudflare");
});
