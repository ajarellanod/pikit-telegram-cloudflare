/**
 * platform-cloudflare's tests. They are copied with the component and keep running in your project,
 * under `bun test`, over doubles of a Durable Object (`object.test-support.ts`: its alarm on the
 * app's clock, its RPC, a namespace of objects; `sql.test-support.ts`: its SQL in `node:sqlite`):
 * the `wakeups` suite (with the slice deadline and requests that survive a restart), the
 * `actor.mailbox` suite from a Worker's App to the objects, the lifecycle suite, and what the alarm,
 * the slice, the backoff, requests waiting for a handler and deliveries do. pikit runs the same
 * suites on real Durable Objects, with their alarms and RPC, in workerd (`tests/workerd`).
 */

import { expect, test } from "bun:test";
import {
  type AppContext,
  BACKGROUND_CONTEXT,
  type Clock,
  type ComponentDefinition,
  defineApp,
  defineComponent,
  type Logger,
  silentLogger,
  withContextValue,
} from "@pikit/core";
import { type ActorMailbox, type JsonValue, type WakeupHandler, type Wakeups, WORKERS_HOST, type WorkersHost } from "@pikit/contracts";
import { createLifecycleConformance, createManualClock } from "@pikit/core/testing";
import { createMailboxConformance, createWakeupsConformance, withWorkersHost } from "@pikit/contracts/testing";
import platformCloudflare, { BACKOFF_MS, WAKEUPS_TABLE } from "./index.ts";
import { type SimulatedObject, simulatedNamespace, simulatedObject } from "./object.test-support.ts";
import { fakeSql } from "./sql.test-support.ts";

const SLICE_MS = 90_000;
const HOUR = 60 * 60 * 1_000;

// The wakeups contract in an object's App, held to the declared backoff and slice, over a restart.
for (const c of createWakeupsConformance(
  () => {
    const object = simulatedObject(fakeSql());
    return {
      components: [...withWorkersHost(object.host, [platformCloudflare]), object.component],
      config: { "platform-cloudflare": { sliceMs: SLICE_MS } },
    };
  },
  { backoffMs: BACKOFF_MS, sliceMs: SLICE_MS, durable: true },
)) {
  test(`platform-cloudflare ${c.group}: ${c.name}`, () => c.run());
}

// The actor.mailbox and actor.inbox contract from a Worker's App: each key is an object running its
// own App, where platform-cloudflare also provides wakeups (the suite's actor wakes itself too).
for (const c of createMailboxConformance(
  (inbox) => {
    const objects = simulatedNamespace(() => [platformCloudflare, inbox], fakeSql);
    return { components: withWorkersHost({ env: objects.env }, [platformCloudflare]), dispose: objects.stop };
  },
  { wakeups: true },
)) {
  test(`platform-cloudflare ${c.group}: ${c.name}`, () => c.run());
}

// Start and stop honour their deadline, and a fresh app over the same object starts again.
for (const c of createLifecycleConformance(() => {
  const object = simulatedObject(fakeSql());
  const [hosted = platformCloudflare] = withWorkersHost(object.host, [platformCloudflare]);
  return { component: hosted, providers: [object.component] };
})) {
  test(`platform-cloudflare ${c.group}: ${c.name}`, () => c.run());
}

const noop: WakeupHandler = async () => {};

/**
 * An object's App started as deployment-cloudflare starts it (the object in app.start's context):
 * platform-cloudflare, a component that registers `handlers`, and `components`.
 */
async function openObject(
  object: SimulatedObject,
  clock: Clock,
  handlers: Record<string, WakeupHandler> = {},
  options: { logger?: Logger; sliceMs?: number; components?: ComponentDefinition[] } = {},
) {
  let wakeups: Wakeups | undefined;
  const owner = defineComponent({
    name: "test-owner",
    setup(pikit) {
      const handle = pikit.use("wakeups");
      return {
        start() {
          wakeups = handle.get();
          for (const [name, handler] of Object.entries(handlers)) wakeups.handle(name, handler);
        },
      };
    },
  });
  const app = await defineApp({
    components: [platformCloudflare, owner, object.component, ...(options.components ?? [])],
    clock,
    logger: options.logger ?? silentLogger,
    ...(options.sliceMs !== undefined && { config: { "platform-cloudflare": { sliceMs: options.sliceMs } } }),
  }).create();
  await app.start(withContextValue(WORKERS_HOST, object.host, BACKGROUND_CONTEXT));
  if (wakeups === undefined) throw new Error("wakeups was not resolved");
  return { app, wakeups, ctx: app.context() };
}

/** The rows platform-cloudflare keeps in the object's SQL. */
const rowsOf = (object: SimulatedObject) =>
  (object.host.object?.storage as { sql: { exec(q: string): { toArray(): unknown[] } } }).sql.exec(`SELECT name, time, failures FROM ${WAKEUPS_TABLE} ORDER BY name`).toArray();

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [platformCloudflare], logger: silentLogger }).create();
  expect(app.describe().components.find((component) => component.name === "platform-cloudflare")).toMatchObject({
    provides: ["wakeups", "actor.inbox", "actor.mailbox"],
    requires: [],
    optional: [],
  });
});

test("the alarm is the earliest request that has a handler, set again whenever at, cancel or handle change it", async () => {
  const clock = createManualClock();
  const t0 = clock.now();
  const object = simulatedObject(fakeSql());
  const { app, wakeups, ctx } = await openObject(object, clock, { a: noop, b: noop });
  try {
    await wakeups.at("a", t0 + 5_000, ctx);
    expect(object.alarm()).toBe(t0 + 5_000);
    await wakeups.at("b", t0 + 2_000, ctx);
    expect(object.alarm()).toBe(t0 + 2_000);
    // Nobody handles it yet: it would fire for nothing.
    await wakeups.at("later", t0 + 1_000, ctx);
    expect(object.alarm()).toBe(t0 + 2_000);
    await wakeups.cancel("b", ctx);
    expect(object.alarm()).toBe(t0 + 5_000);
    // Whole milliseconds, rounded up: never early.
    await wakeups.at("a", t0 + 3_000.5, ctx);
    expect(object.alarm()).toBe(t0 + 3_001);
    await wakeups.cancel("a", ctx);
    expect(object.alarm()).toBeNull();
    wakeups.handle("later", noop);
    await clock.advance(0);
    expect(object.alarm()).toBe(t0 + 1_000);
  } finally {
    await app.stop();
  }
});

test("a request nobody handles waits in the table, never spins the alarm, and runs once its handler registers", async () => {
  const clock = createManualClock();
  const t0 = clock.now();
  const sql = fakeSql();
  const first = simulatedObject(sql);
  const before = await openObject(first, clock);
  await before.wakeups.at("late", t0 + 1_000, before.ctx);
  await before.app.stop();

  // A reset lost the alarm: the next App sets it again from the rows, before any handler registers.
  const object = simulatedObject(sql);
  const { app, wakeups } = await openObject(object, clock);
  try {
    expect(object.alarm()).toBe(t0 + 1_000);
    await clock.advance(HOUR);
    expect(object.fired()).toBe(1);
    expect(object.alarm()).toBeNull();
    expect(rowsOf(object)).toEqual([{ name: "late", time: t0 + 1_000, failures: 0 }]);

    const runs: number[] = [];
    wakeups.handle("late", async (ctx) => void runs.push(ctx.clock.now() - t0));
    await clock.advance(0);
    expect(runs).toEqual([HOUR]);
    expect(rowsOf(object)).toEqual([]);
    expect(object.alarm()).toBeNull();
  } finally {
    await app.stop();
  }
});

test("an alarm is one slice: the running handler is cut at the deadline, asks again, and the rest runs in the next alarm", async () => {
  const clock = createManualClock();
  const t0 = clock.now();
  const object = simulatedObject(fakeSql());
  const runs: string[] = [];
  let reason: unknown;
  let wakeups: Wakeups | undefined;
  const long: WakeupHandler = async (ctx) => {
    runs.push(`long@${ctx.clock.now() - t0}`);
    if (runs.length > 1) return;
    await new Promise<void>((resolve) => ctx.abortSignal?.addEventListener("abort", () => resolve(), { once: true }));
    reason = ctx.abortSignal?.reason;
    await wakeups?.at("long", ctx.clock.now(), ctx);
  };
  const short: WakeupHandler = async (ctx) => void runs.push(`short@${ctx.clock.now() - t0}`);
  const opened = await openObject(object, clock, { long, short }, { sliceMs: 10_000 });
  wakeups = opened.wakeups;
  try {
    await wakeups.at("long", t0, opened.ctx);
    await wakeups.at("short", t0 + 1, opened.ctx);
    await clock.advance(0);
    await clock.advance(9_999);
    expect(runs).toEqual(["long@0"]);
    await clock.advance(1);
    expect(String(reason)).toContain("slice deadline (10000 ms)");
    expect(runs).toEqual(["long@0", "short@10000", "long@10000"]);
    expect(object.fired()).toBe(2);
    expect(object.alarm()).toBeNull();
  } finally {
    await opened.app.stop();
  }
});

test("a handler that fails gets a backoff row: its time moves by 1 s, 5 s…, its failures are counted and logged", async () => {
  const clock = createManualClock();
  const t0 = clock.now();
  const object = simulatedObject(fakeSql());
  const warnings: unknown[] = [];
  const logger: Logger = { ...silentLogger, warn: (message, fields) => void warnings.push({ message, fields }) };
  let calls = 0;
  const flaky: WakeupHandler = async () => {
    if (++calls <= 2) throw new Error("the model provider is busy");
  };
  const { app, wakeups, ctx } = await openObject(object, clock, { flaky }, { logger });
  try {
    await wakeups.at("flaky", t0, ctx);
    await clock.advance(0);
    expect(rowsOf(object)).toEqual([{ name: "flaky", time: t0 + BACKOFF_MS[0], failures: 1 }]);
    expect(object.alarm()).toBe(t0 + BACKOFF_MS[0]);
    await clock.advance(BACKOFF_MS[0]);
    expect(rowsOf(object)).toEqual([{ name: "flaky", time: t0 + BACKOFF_MS[0] + BACKOFF_MS[1], failures: 2 }]);
    await clock.advance(BACKOFF_MS[1]);
    expect(calls).toBe(3);
    expect(rowsOf(object)).toEqual([]);
    expect(object.alarm()).toBeNull();
    expect(warnings).toEqual([
      {
        message: 'platform-cloudflare: the wakeup handler "flaky" failed; it runs again later',
        fields: { name: "flaky", failures: 1, retryInMs: BACKOFF_MS[0], error: "the model provider is busy" },
      },
      {
        message: 'platform-cloudflare: the wakeup handler "flaky" failed; it runs again later',
        fields: { name: "flaky", failures: 2, retryInMs: BACKOFF_MS[1], error: "the model provider is busy" },
      },
    ]);
  } finally {
    await app.stop();
  }
});

/** An actor's side: handles "test.message", recording the key, the message and the object it ran in. */
function recordingInbox() {
  const received: { key: string; message: JsonValue; object: string | undefined; ctx: AppContext }[] = [];
  const component = defineComponent({
    name: "test-inbox",
    setup(pikit) {
      const inbox = pikit.use("actor.inbox");
      return {
        start() {
          inbox.get().handle("test.message", async (key, message, ctx) => {
            received.push({ key, message, object: ctx.value(WORKERS_HOST)?.object?.id, ctx });
          });
        },
      };
    },
  });
  return { component, received };
}

test("a delivery to the object reaches its actor.inbox handler, with the key, the message and a context of its own", async () => {
  const clock = createManualClock();
  const object = simulatedObject(fakeSql(), { id: "conversation-object" });
  const inbox = recordingInbox();
  const { app } = await openObject(object, clock, {}, { components: [inbox.component] });
  await object.deliver("test.message", "telegram:1", { update_id: 7 });
  expect(inbox.received.map(({ key, message, object }) => ({ key, message, object }))).toEqual([
    { key: "telegram:1", message: { update_id: 7 }, object: "conversation-object" },
  ]);
  await expect(object.deliver("test.unknown", "telegram:1", 1)).rejects.toThrow('no actor.inbox handler for the type "test.unknown"');
  await app.stop();
  expect(inbox.received[0]?.ctx.abortSignal?.aborted).toBe(true);
  await expect(object.deliver("test.message", "telegram:1", 1)).rejects.toThrow("the conversation object's App is not running");
});

test("in an object, actor.mailbox delivers to its own key locally and to any other key by RPC", async () => {
  const inbox = recordingInbox();
  const others = simulatedNamespace(() => [platformCloudflare, inbox.component], fakeSql);
  // This object is the one `idFromName("conv-a")` names.
  const object = simulatedObject(fakeSql(), { id: "id:conv-a", env: others.env });
  let mailbox: ActorMailbox | undefined;
  const sender = defineComponent({
    name: "test-sender",
    setup(pikit) {
      const handle = pikit.use("actor.mailbox");
      return { start: () => void (mailbox = handle.get()) };
    },
  });
  const { app, ctx } = await openObject(object, createManualClock(), {}, { components: [inbox.component, sender] });
  try {
    await mailbox?.send("conv-a", "test.message", "to myself", ctx);
    await mailbox?.send("conv-b", "test.message", "to another", ctx);
    expect(inbox.received.map(({ key, message, object }) => ({ key, message, object }))).toEqual([
      { key: "conv-a", message: "to myself", object: "id:conv-a" },
      { key: "conv-b", message: "to another", object: "id:conv-b" },
    ]);
    expect([...others.apps.keys()]).toEqual(["conv-b"]);
  } finally {
    await app.stop();
    await others.stop();
  }
});

test("in the Worker's App, wakeups and actor.inbox say they belong in an object's App", async () => {
  const objects = simulatedNamespace(() => [], fakeSql);
  const owner = defineComponent({
    name: "test-owner",
    setup(pikit) {
      const handle = pikit.use("wakeups");
      return { start: () => handle.get().handle("test.wake", noop) };
    },
  });
  expect(await startFailure([platformCloudflare, owner], { env: objects.env })).toContain("wakeups exist only in a Durable Object's App");
  const actor = defineComponent({
    name: "test-actor",
    setup(pikit) {
      const handle = pikit.use("actor.inbox");
      return { start: () => handle.get().handle("test.message", async () => {}) };
    },
  });
  expect(await startFailure([platformCloudflare, actor], { env: objects.env })).toContain("actor.inbox exists only in a Durable Object's App");
});

/** The reason `app.start` fails with, when the host in its context is `host`. */
async function startFailure(components: ComponentDefinition[], host: WorkersHost | undefined, config?: Record<string, unknown>): Promise<string> {
  const app = await defineApp({ components, logger: silentLogger, ...(config !== undefined && { config }) }).create();
  const parent = host === undefined ? BACKGROUND_CONTEXT : withContextValue(WORKERS_HOST, host, BACKGROUND_CONTEXT);
  const error = await app.start(parent).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  // The app wraps a component's start failure; the component's own error is its cause.
  if (!(error instanceof Error) || !(error.cause instanceof Error)) throw new Error("expected start() to fail with a cause");
  return error.cause.message;
}

test("it refuses to start off Cloudflare, in a Worker without the namespace binding, or on an object without SQLite", async () => {
  expect(await startFailure([platformCloudflare], undefined)).toContain("platform-cloudflare: no WORKERS_HOST in the start context");
  expect(await startFailure([platformCloudflare], { env: {} })).toContain("env.CONVERSATION is not a Durable Object namespace");
  // The binding's name comes from config.
  const objects = simulatedNamespace(() => [], fakeSql, { binding: "CONVERSATIONS" });
  expect(await startFailure([platformCloudflare], { env: objects.env })).toContain("env.CONVERSATION is not a Durable Object namespace");
  const app = await defineApp({ components: [platformCloudflare], logger: silentLogger, config: { "platform-cloudflare": { binding: "CONVERSATIONS" } } }).create();
  await app.start(withContextValue(WORKERS_HOST, { env: objects.env }, BACKGROUND_CONTEXT));
  await app.stop();
  // A key-value-backed object (`new_classes`) has no `sql`; reading it throws.
  const withoutSql = {
    get sql(): never {
      throw new Error("SQL is not enabled for this Durable Object class.");
    },
  };
  const host: WorkersHost = { env: {}, object: { id: "kv-object", storage: withoutSql, onAlarm: () => {}, onDeliver: () => {} } };
  expect(await startFailure([platformCloudflare], host)).toContain("new_sqlite_classes");
});

test("sliceMs stays under the platform's 15-minute cut of an alarm", () => {
  expect(() => defineApp({ components: [platformCloudflare], config: { "platform-cloudflare": { sliceMs: 15 * 60 * 1_000 } } })).toThrow("invalid config");
});

test("a slice leaves no timer longer than a second: a pending timer keeps an object from being evicted", async () => {
  const manual = createManualClock();
  const sleeps: number[] = [];
  const clock: Clock = { now: () => manual.now(), sleep: (ms) => (sleeps.push(ms), manual.sleep(ms)) };
  const object = simulatedObject(fakeSql());
  let cut = false;
  const waitForCut: WakeupHandler = (ctx) => new Promise<void>((resolve) => ctx.abortSignal?.addEventListener("abort", () => void ((cut = true), resolve()), { once: true }));
  const { app, wakeups, ctx } = await openObject(object, clock, { long: waitForCut }, { sliceMs: 5 * 60 * 1_000 });
  try {
    await wakeups.at("long", manual.now(), ctx);
    await manual.advance(0);
    for (let i = 0; i < 5 * 60 && !cut; i++) await manual.advance(1_000);
    expect(cut).toBe(true);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(1_000);
  } finally {
    await app.stop();
  }
});
