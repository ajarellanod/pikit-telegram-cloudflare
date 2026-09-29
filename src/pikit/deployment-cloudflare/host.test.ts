/**
 * The entrypoint's logic (`host.ts`) under Bun, with a fake object state and namespace: what reaches
 * each App's start context, when the object's App starts, how a failed or late start ends, and how the
 * Worker serves routes and `/health`. The same code runs in workerd in the workerd lane
 * (`tests/workerd/test/deployment-cloudflare.workerd.ts` in the pikit repository).
 */

import { expect, test } from "bun:test";
import { type AppContext, defineApp, defineComponent, type Logger, silentLogger } from "@pikit/core";
import { type JsonValue, WORKERS_HOST, type WorkersHost } from "@pikit/contracts";
import { createObjectHost, createWorkerHost, HEALTH_OBJECT, type ObjectState } from "./host.ts";

/** A DurableObjectState's part the entrypoint uses; counts `blockConcurrencyWhile` calls and whether one is running. */
function fakeState(id = "object-1") {
  const state = {
    id: { toString: () => id },
    storage: { kind: "storage of " + id },
    blocked: 0,
    inside: false,
    async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      state.blocked++;
      state.inside = true;
      try {
        return await callback();
      } finally {
        state.inside = false;
      }
    },
  };
  return state satisfies ObjectState;
}

/** Records the host it starts with, and registers handlers that record what they receive. */
function recorder() {
  const seen: { host?: WorkersHost | undefined; starts: number; alarms: number; delivered: [string, string, JsonValue][]; insideBlock: boolean[] } = {
    starts: 0,
    alarms: 0,
    delivered: [],
    insideBlock: [],
  };
  const component = (state?: { inside: boolean }) =>
    defineComponent({
      name: "platform-probe",
      setup() {
        return {
          start(ctx: AppContext) {
            seen.starts++;
            seen.insideBlock.push(state?.inside ?? false);
            seen.host = ctx.value(WORKERS_HOST);
            seen.host?.object?.onAlarm(async () => void seen.alarms++);
            seen.host?.object?.onDeliver(async (type, key, message) => void seen.delivered.push([type, key, message]));
          },
        };
      },
    });
  return { seen, component };
}

test("the object's App starts on its first event, once, inside blockConcurrencyWhile, with the object in WORKERS_HOST", async () => {
  const state = fakeState();
  const { seen, component } = recorder();
  const env = { SECRET: "s" };
  const host = createObjectHost(defineApp({ components: [component(state)] }), state, env, { logger: silentLogger });
  expect(seen.starts).toBe(0);

  await Promise.all([host.health(), host.deliver("text", "chat:1", { text: "hi" }), host.alarm()]);
  expect(seen.starts).toBe(1);
  expect(state.blocked).toBe(1);
  expect(seen.insideBlock).toEqual([true]);
  expect(seen.host?.env).toBe(env);
  expect(seen.host?.object?.id).toBe("object-1");
  expect(seen.host?.object?.storage).toBe(state.storage);
  expect(seen.delivered).toEqual([["text", "chat:1", { text: "hi" }]]);
  expect(seen.alarms).toBe(1);
});

test("an alarm nobody handles is logged and dropped; a delivery nobody handles rejects, so its sender retries", async () => {
  const warnings: string[] = [];
  const logger: Logger = { ...silentLogger, warn: (message) => void warnings.push(message) };
  const host = createObjectHost(defineApp({ components: [] }), fakeState(), {}, { logger });
  await host.alarm();
  expect(warnings).toEqual(["pikit: the object's alarm fired, but no component handles it"]);
  await expect(host.deliver("text", "k", null)).rejects.toThrow(/no component in the object's App handles deliveries/);
});

test("a second alarm or delivery handler fails the start: the object has one of each", async () => {
  const twice = defineComponent({
    name: "twice",
    setup: () => ({
      start(ctx) {
        const object = ctx.value(WORKERS_HOST)?.object;
        object?.onAlarm(async () => {});
        object?.onAlarm(async () => {});
      },
    }),
  });
  const host = createObjectHost(defineApp({ components: [twice] }), fakeState(), {}, { logger: silentLogger });
  await expect(host.health()).rejects.toThrow(/failed to start/);
});

test("a failed start rolls back, rethrows (Cloudflare resets the object), and the next event starts a new App", async () => {
  let attempt = 0;
  const stopped: string[] = [];
  const first = defineComponent({ name: "first", setup: () => ({ start() {}, stop: () => void stopped.push("first") }) });
  const flaky = defineComponent({
    name: "flaky",
    setup: () => ({
      start() {
        if (++attempt === 1) throw new Error("no database");
      },
    }),
  });
  const state = fakeState();
  const host = createObjectHost(defineApp({ components: [first, flaky] }), state, {}, { logger: silentLogger });
  const failure = await host.health().catch((error: unknown) => error as Error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe('component "flaky" failed to start');
  expect(((failure as Error).cause as Error).message).toBe("no database");
  expect(stopped).toEqual(["first"]);

  await expect(host.health()).resolves.toEqual({ ok: true });
  expect(state.blocked).toBe(2);
});

test("a start past its deadline, with a rollback that hangs, still ends within both deadlines (K2)", async () => {
  const hangs = defineComponent({
    name: "hangs",
    setup: () => ({
      start: () => new Promise<void>(() => {}),
    }),
  });
  const stuck = defineComponent({ name: "stuck", setup: () => ({ start() {}, stop: () => new Promise<void>(() => {}) }) });
  const host = createObjectHost(defineApp({ components: [stuck, hangs] }), fakeState(), {}, { logger: silentLogger, startDeadlineMs: 50, rollbackDeadlineMs: 50 });
  const started = Date.now();
  await expect(host.alarm()).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(1_000);
});

test("the Worker's App starts once per isolate with WORKERS_HOST { env, origin }, and serves its routes with contexts of their own", async () => {
  let starts = 0;
  let startSignal: AbortSignal | undefined;
  let hostSeen: WorkersHost | undefined;
  const routes = defineComponent({
    name: "routes",
    setup(pikit) {
      pikit.provideKeyed("http.route", "GET /hello", (request, ctx) =>
        Response.json({ env: Object.keys(ctx.value(WORKERS_HOST)?.env ?? {}), sameSignal: ctx.abortSignal === startSignal, url: new URL(request.url).pathname }),
      );
      pikit.provideKeyed("http.route", "GET /chats/:id", (request) => Response.json({ route: "param", path: new URL(request.url).pathname }));
      pikit.provideKeyed("http.route", "GET /chats/new", () => Response.json({ route: "literal" }));
      pikit.provideKeyed("http.route", "POST /boom", () => {
        throw new Error("a secret detail");
      });
      return {
        start(ctx) {
          starts++;
          startSignal = ctx.abortSignal;
          hostSeen = ctx.value(WORKERS_HOST);
        },
      };
    },
  });
  const worker = createWorkerHost(defineApp({ components: [routes] }), { logger: silentLogger });
  const env = { A: "1" };

  const hello = await worker.fetch(new Request("https://w.example/hello"), env);
  expect(hello.status).toBe(200);
  // Handlers never get start's context, nor WORKERS_HOST (it is for start, SPEC C5).
  expect(await hello.json()).toEqual({ env: [], sameSignal: false, url: "/hello" });
  // The origin of the request that started it: where the Worker is reached.
  expect(hostSeen).toEqual({ env, origin: "https://w.example" });
  expect(await (await worker.fetch(new Request("https://w.example/chats/new"), env)).json()).toEqual({ route: "literal" });
  expect(await (await worker.fetch(new Request("https://w.example/chats/42"), env)).json()).toEqual({ route: "param", path: "/chats/42" });
  expect((await worker.fetch(new Request("https://w.example/nothing"), env)).status).toBe(404);
  expect((await worker.fetch(new Request("https://w.example/hello", { method: "POST" }), env)).status).toBe(404);
  const boom = await worker.fetch(new Request("https://w.example/boom", { method: "POST" }), env);
  expect(boom.status).toBe(500);
  expect(await boom.text()).not.toContain("secret");
  expect(starts).toBe(1);
});

test("the Worker refuses routes it cannot serve, and a failed start answers 503 and is retried by the next request", async () => {
  let refuse = true;
  const routes = defineComponent({
    name: "routes",
    setup(pikit) {
      pikit.provideKeyed("http.route", "GET /health", () => new Response("mine"));
      return {
        start() {
          if (refuse) throw new Error("not yet");
        },
      };
    },
  });
  const worker = createWorkerHost(defineApp({ components: [routes] }), { logger: silentLogger });
  expect((await worker.fetch(new Request("https://w.example/x"), {})).status).toBe(503);
  refuse = false;
  // Now it starts, and its "GET /health" is refused: that route is the Worker's own.
  expect((await worker.fetch(new Request("https://w.example/x"), {})).status).toBe(503);
});

/** A namespace whose objects answer `health()` as `answer` does, recording the names asked. */
function fakeNamespace(answer: () => Promise<unknown>) {
  const names: string[] = [];
  return {
    names,
    idFromName: (name: string) => (names.push(name), { name }),
    get: () => ({ health: answer }),
  };
}

test("GET /health starts the Worker's App and one object's App, and answers { ok, version }", async () => {
  const objects = fakeNamespace(async () => ({ ok: true }));
  const worker = createWorkerHost(undefined, { logger: silentLogger });
  const env = { CONVERSATION: objects, CF_VERSION_METADATA: { id: "version-2", tag: "", timestamp: "" } };
  const response = await worker.fetch(new Request("https://w.example/health"), env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, version: "version-2" });
  expect(objects.names).toEqual([HEALTH_OBJECT]);
  // Without a Worker App, the Worker serves /health only.
  expect((await worker.fetch(new Request("https://w.example/other"), env)).status).toBe(404);

  // /health starts the Worker's App too, with its origin: the first request a version serves may be it.
  let hostSeen: WorkersHost | undefined;
  const reader = defineComponent({ name: "reader", setup: () => ({ start: (ctx) => void (hostSeen = ctx.value(WORKERS_HOST)) }) });
  await createWorkerHost(defineApp({ components: [reader] }), { logger: silentLogger }).fetch(new Request("https://bot.acme.workers.dev/health"), env);
  expect(hostSeen?.origin).toBe("https://bot.acme.workers.dev");
});

test("GET /health says which half did not start, never why", async () => {
  const failing = createWorkerHost(undefined, { logger: silentLogger });
  const objects = fakeNamespace(async () => {
    throw new Error("the database password is hunter2");
  });
  const down = await failing.fetch(new Request("https://w.example/health"), { CONVERSATION: objects });
  expect(down.status).toBe(503);
  expect(await down.json()).toEqual({ ok: false, version: null, error: "the object's App did not start" });

  const broken = defineComponent({ name: "broken", setup: () => ({ start: () => Promise.reject(new Error("hunter2")) }) });
  const worker = createWorkerHost(defineApp({ components: [broken] }), { logger: silentLogger });
  const answer = await worker.fetch(new Request("https://w.example/health"), { CONVERSATION: fakeNamespace(async () => ({ ok: true })) });
  expect(answer.status).toBe(503);
  expect(await answer.json()).toEqual({ ok: false, version: null, error: "the Worker's App did not start" });

  const unbound = await createWorkerHost(undefined, { logger: silentLogger }).fetch(new Request("https://w.example/health"), {});
  expect(((await unbound.json()) as { error: string }).error).toContain("no CONVERSATION binding");
});
