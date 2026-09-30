/**
 * conversations-kv's tests. They are copied with the component and keep running in your project.
 * `storage.kv` is the memory storage from `@pikit/contracts/testing`, and sessions come from Pi's
 * in-memory repository through `@pikit/pi-adapter/testing`. Both are shared by every app of a test,
 * so a second app over them is a restart, or a second process when both run at once.
 */

import { expect, test } from "bun:test";
import { type App, type AppContext, type ComponentDefinition, defineApp, defineComponent, silentLogger } from "@pikit/core";
import type { ConversationRef, ConversationRegistry, ConversationReset, JsonValue, KeyValueStorage } from "@pikit/contracts";
import { createLifecycleConformance } from "@pikit/core/testing";
import { createConversationRegistryConformance, createMemoryKeyValueStorage } from "@pikit/contracts/testing";
import { testComponents } from "@pikit/pi-adapter/testing";
import conversationsKv, { NAMESPACE } from "./index.ts";

/** One `storage.kv` and one session store, shared by every app of a test. */
function records() {
  const { sessions } = testComponents();
  return { kv: createMemoryKeyValueStorage(), sessions };
}

/** A component providing `storage` as `storage.kv`. */
function kvProvider(storage: KeyValueStorage): ComponentDefinition {
  return defineComponent({ name: "storage-kv-fixture", setup: (pikit) => pikit.provide("storage.kv", storage) });
}

type Write = "set" | "setIfAbsent";

/** `storage` with `before` awaited ahead of each write: a test holds a write there to force an interleaving. */
function beforeWrites(storage: KeyValueStorage, before: (write: Write, key: string) => Promise<void>): KeyValueStorage {
  return {
    namespace(name) {
      const store = storage.namespace(name);
      return {
        get: <T extends JsonValue = JsonValue>(key: string) => store.get<T>(key),
        set: async (key, value) => {
          await before("set", key);
          return store.set(key, value);
        },
        setIfAbsent: async (key, value) => {
          await before("setIfAbsent", key);
          return store.setIfAbsent(key, value);
        },
        delete: (key) => store.delete(key),
      };
    },
  };
}

/** A gate: `arrive()` waits until `release()`; `arrived(n)` resolves once `n` callers wait. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let count = 0;
  const waiting: [number, () => void][] = [];
  return {
    async arrive() {
      count += 1;
      for (const [n, done] of waiting) if (count >= n) done();
      await opened;
    },
    arrived: (n: number) => new Promise<void>((resolve) => (count >= n ? resolve() : waiting.push([n, resolve]))),
    release: () => open(),
  };
}

/** The ids of the sessions in a store, read through a small app of its own. */
async function sessionIds(sessions: ComponentDefinition): Promise<string[]> {
  let ids: string[] = [];
  const probe = defineComponent({
    name: "sessions-probe",
    setup(pikit) {
      const handle = pikit.use("sessions.store");
      return {
        async start(ctx) {
          ids = (await handle.get().list(undefined, ctx)).map((metadata: { id: string }) => metadata.id);
        },
      };
    },
  });
  const app = await defineApp({ components: [sessions, probe], logger: silentLogger }).create();
  await app.start();
  await app.stop();
  return ids;
}

interface Worker {
  app: App;
  registry: ConversationRegistry;
  ctx: AppContext;
  resets: ConversationReset[];
}

/** A started app (a worker) over `r`, through `storage` when given instead of `r.kv`. */
async function started(r: ReturnType<typeof records>, storage: KeyValueStorage = r.kv, extra: ComponentDefinition[] = []): Promise<Worker> {
  let registry: ConversationRegistry | undefined;
  const resets: ConversationReset[] = [];
  const reader = defineComponent({
    name: "registry-reader",
    setup(pikit) {
      const handle = pikit.use("conversations.registry");
      pikit.on("conversation.reset", (payload) => void resets.push(payload));
      return { start: () => void (registry = handle.get()) };
    },
  });
  const app = await defineApp({ components: [kvProvider(storage), r.sessions, conversationsKv, reader, ...extra], logger: silentLogger }).create();
  await app.start();
  if (registry === undefined) throw new Error("conversations.registry was not resolved");
  return { app, registry, ctx: app.context(), resets };
}

// The conversations.registry contract, including the sessions it creates in the store.
for (const c of createConversationRegistryConformance(() => {
  const r = records();
  return { components: [kvProvider(r.kv), r.sessions, conversationsKv], sessionIds: () => sessionIds(r.sessions) };
})) {
  test(`conversations-kv ${c.group}: ${c.name}`, () => c.run());
}

// Start and stop honour their deadline.
for (const c of createLifecycleConformance(() => {
  const r = records();
  return { component: conversationsKv, providers: [kvProvider(r.kv), r.sessions] };
})) {
  test(`conversations-kv ${c.group}: ${c.name}`, () => c.run());
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const r = records();
  const app = await defineApp({ components: [kvProvider(r.kv), r.sessions, conversationsKv], logger: silentLogger }).create();

  expect(app.describe().components.find((component) => component.name === "conversations-kv")).toMatchObject({
    provides: ["conversations.registry"],
    requires: ["storage.kv", "sessions.store"],
    optional: [],
  });
});

test("each pointer is a value at its key in the conversations-kv namespace, with the sessions it was in before", async () => {
  const r = records();
  const w = await started(r);
  const first = await w.registry.resolve("http:c1", "assistant", w.ctx);
  const reset = await w.registry.reset("http:c1", w.ctx);

  expect(await r.kv.namespace(NAMESPACE).get("http:c1")).toMatchObject({
    agent: "assistant",
    sessionId: reset?.newSessionId,
    previousSessionIds: [first.sessionId],
  });
  await w.app.stop();
});

test("a key named __proto__ is a key like any other, also after a restart", async () => {
  const r = records();
  const first = await started(r);
  const created = await first.registry.resolve("__proto__", "assistant", first.ctx);
  await first.app.stop();

  const second = await started(r);

  expect(await second.registry.get("__proto__", second.ctx)).toEqual(created);
  expect(await second.registry.get("toString", second.ctx)).toBeUndefined();
  await second.app.stop();
});

test("a value that is not a pointer fails, and is never overwritten by a resolve", async () => {
  const r = records();
  await r.kv.namespace(NAMESPACE).set("http:c1", { agent: "assistant" });
  const w = await started(r);

  await expect(w.registry.get("http:c1", w.ctx)).rejects.toThrow("conversations-kv:");
  await expect(w.registry.resolve("http:c1", "assistant", w.ctx)).rejects.toThrow("conversations-kv:");
  expect(await r.kv.namespace(NAMESPACE).get("http:c1")).toEqual({ agent: "assistant" });
  await w.app.stop();
});

test("the registry is refused while the app is not running", async () => {
  const r = records();
  const w = await started(r);
  await w.app.stop();

  await expect(w.registry.get("http:c1", w.ctx)).rejects.toThrow("while the app is not running");
  await expect(w.registry.resolve("http:c1", "assistant", w.ctx)).rejects.toThrow("while the app is not running");
});

test("conversation.reset is emitted once the new pointer is stored, never when it could not be", async () => {
  const r = records();
  let seen: string | undefined;
  const listener = defineComponent({
    name: "reset-listener",
    setup(pikit) {
      const handle = pikit.use("conversations.registry");
      pikit.on("conversation.reset", async (payload, ctx) => void (seen = (await handle.get().get(payload.conversation.key, ctx))?.sessionId));
    },
  });
  let failing = false;
  const storage = beforeWrites(r.kv, async (write) => {
    if (failing && write === "set") throw new Error("the store is down");
  });
  const w = await started(r, storage, [listener]);
  const created = await w.registry.resolve("http:c1", "assistant", w.ctx);

  const reset = await w.registry.reset("http:c1", w.ctx);
  // A listener that reads the registry finds the new session: it was stored before the event.
  expect(seen).toBe(reset?.newSessionId);

  failing = true;
  await expect(w.registry.reset("http:c1", w.ctx)).rejects.toThrow("the store is down");
  expect(w.resets).toEqual([reset as ConversationReset]);
  expect(await w.registry.get("http:c1", w.ctx)).toEqual(reset?.conversation);
  expect(created.sessionId).not.toBe(reset?.newSessionId);
  await w.app.stop();
});

test("in one process, a reset and a resolve sent together run in order, and two resets both count", async () => {
  const r = records();
  const w = await started(r);
  const created = await w.registry.resolve("http:c1", "assistant", w.ctx);

  const [reset, after] = await Promise.all([w.registry.reset("http:c1", w.ctx), w.registry.resolve("http:c1", "assistant", w.ctx)]);
  expect(after).toEqual(reset?.conversation as ConversationRef);

  const [one, two] = await Promise.all([w.registry.reset("http:c1", w.ctx), w.registry.reset("http:c1", w.ctx)]);
  expect(two?.previousSessionId).toBe(one?.newSessionId);
  expect(await r.kv.namespace(NAMESPACE).get("http:c1")).toMatchObject({
    sessionId: two?.newSessionId,
    previousSessionIds: [created.sessionId, reset?.newSessionId, one?.newSessionId],
  });
  expect(w.resets).toHaveLength(3);
  await w.app.stop();
});

test("two processes racing a first resolve get one conversation; the loser leaves one unused session", async () => {
  const r = records();
  const both = gate();
  const storage = beforeWrites(r.kv, async (write) => {
    if (write === "setIfAbsent") await both.arrive();
  });
  const a = await started(r, storage);
  const b = await started(r, storage);

  const racing = Promise.all([a.registry.resolve("http:c1", "assistant", a.ctx), b.registry.resolve("http:c1", "assistant", b.ctx)]);
  await both.arrived(2); // Both read no pointer and created a session.
  both.release();
  const [one, two] = await racing;

  expect(one).toEqual(two);
  const ids = await sessionIds(r.sessions);
  expect(ids).toHaveLength(2);
  expect(ids).toContain(one.sessionId);
  expect(await a.registry.get("http:c1", a.ctx)).toEqual(one);
  await a.app.stop();
  await b.app.stop();
});

test("a first resolve that loses to another process's resolve and reset returns the reset pointer, and never undoes it", async () => {
  const r = records();
  const held = gate();
  const a = await started(
    r,
    beforeWrites(r.kv, async (write) => {
      if (write === "setIfAbsent") await held.arrive();
    }),
  );
  const b = await started(r);

  const late = a.registry.resolve("http:c1", "assistant", a.ctx);
  await held.arrived(1); // A read no pointer and created a session; its write waits.
  const created = await b.registry.resolve("http:c1", "assistant", b.ctx);
  const reset = await b.registry.reset("http:c1", b.ctx);
  held.release();

  expect(await late).toEqual(reset?.conversation as ConversationRef);
  expect(await b.registry.get("http:c1", b.ctx)).toEqual(reset?.conversation);
  expect(await r.kv.namespace(NAMESPACE).get("http:c1")).toMatchObject({ previousSessionIds: [created.sessionId] });
  expect(await sessionIds(r.sessions)).toHaveLength(3); // B's two, and A's unused one.
  await a.app.stop();
  await b.app.stop();
});

test("two processes resetting one key at once: both succeed, the last write wins, and nothing is deleted", async () => {
  const r = records();
  const both = gate();
  const storage = beforeWrites(r.kv, async (write) => {
    if (write === "set") await both.arrive();
  });
  const a = await started(r, storage);
  const b = await started(r, storage);
  const created = await a.registry.resolve("http:c1", "assistant", a.ctx);

  const racing = Promise.all([a.registry.reset("http:c1", a.ctx), b.registry.reset("http:c1", b.ctx)]);
  await both.arrived(2); // Both read the same pointer and created a session.
  both.release();
  const [one, two] = await racing;

  // What the README says: each reset reports its own move from the same previous session…
  expect([one?.previousSessionId, two?.previousSessionId]).toEqual([created.sessionId, created.sessionId]);
  expect([a.resets.length, b.resets.length]).toEqual([1, 1]);
  // …the pointer names one of the two new sessions, and remembers only the first…
  const now = await a.registry.get("http:c1", a.ctx);
  expect([one?.newSessionId, two?.newSessionId]).toContain(now?.sessionId);
  expect(await r.kv.namespace(NAMESPACE).get("http:c1")).toMatchObject({ previousSessionIds: [created.sessionId] });
  // …and every session is still in the store.
  expect((await sessionIds(r.sessions)).sort()).toEqual([created.sessionId, one?.newSessionId, two?.newSessionId].sort() as string[]);
  await a.app.stop();
  await b.app.stop();
});
