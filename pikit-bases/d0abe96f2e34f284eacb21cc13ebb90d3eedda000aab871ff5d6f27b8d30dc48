/**
 * runtime-pi's tests. They are copied with the component and keep running in your project.
 * They use `@pikit/pi-adapter/testing` for a scripted model, so they need no API key and never
 * import Pi.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, type AppEvents, BACKGROUND_CONTEXT, defineApp, defineComponent, silentLogger, withCancel } from "@pikit/core";
import { AGENT_STATE, type AgentCommand, type AgentRuntime, type AgentSubmissions, type AgentTool, type ConversationRef, defineAgent, type WakeupHandler } from "@pikit/contracts";
import { createLifecycleConformance } from "@pikit/core/testing";
import { createAgentCommandConformance, createAgentRuntimeConformance, createMemoryWakeups, createModelCompleteConformance } from "@pikit/contracts/testing";
import type { Credential, CredentialStore } from "@pikit/pi-adapter";
import {
  createPiRuntimeFixture,
  holdTool,
  interruptRun,
  openSqliteDatabase,
  recordingBash,
  scriptedAgent,
  scriptedProvider,
  sqliteStorage,
  testComponents,
} from "@pikit/pi-adapter/testing";
import { createLocalExecution } from "@pikit/pi-adapter/node";
import { envApiKeyAuth } from "@pikit/pi-adapter/provider";
import { defineTool } from "@pikit/pi-adapter/tools";
import Type from "typebox";
import runtimePi, { createRuntimePi, DRIVE } from "./index.ts";

// The agent.runtime contract, including a worker that died mid-run.
for (const c of createAgentRuntimeConformance(() => createPiRuntimeFixture([runtimePi]))) {
  test(`runtime-pi ${c.group}: ${c.name}`, () => c.run(), 30_000);
}

// The same contract with runs driven by wakeups (SPEC §4.1, C4), durable as a Durable Object's are:
// what a channel sees does not change.
for (const c of createAgentRuntimeConformance(() => createPiRuntimeFixture([createMemoryWakeups({ durable: true }), runtimePi]))) {
  test(`runtime-pi with wakeups ${c.group}: ${c.name}`, () => c.run(), 30_000);
}

// Start and stop honour their deadline and leave nothing open, with and without wakeups.
for (const c of createLifecycleConformance(() => {
  const { storage, agents, provider } = testComponents();
  return { component: runtimePi, providers: [storage, agents, provider] };
})) {
  test(`runtime-pi ${c.group}: ${c.name}`, () => c.run());
}
for (const c of createLifecycleConformance(() => {
  const { storage, agents, provider } = testComponents();
  return { component: runtimePi, providers: [storage, agents, provider, createMemoryWakeups({ durable: true })] };
})) {
  test(`runtime-pi with wakeups ${c.group}: ${c.name}`, () => c.run());
}

/** A SQLite file in a temporary directory: the records a run outlives a worker in. */
function databaseFile() {
  const root = mkdtempSync(join(tmpdir(), "pikit-runtime-pi-"));
  const path = join(root, "pikit.db");
  return { path, open: async () => openSqliteDatabase(path), dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("at start, a conversation pi-durable holds a message of is resumed, with no new message, and its answer is in agent.submissions", async () => {
  const file = databaseFile();
  try {
    // A process admitted the message, told its platform, and died mid-run.
    const conversation = await interruptRun(file.open, { requestId: "r-killed", key: "test:resume" });

    const { agents, provider } = testComponents();
    const seen = observer();
    const app = await defineApp({ components: [sqliteStorage(file.path), agents, provider, runtimePi, seen.component], logger: silentLogger }).create();
    await app.start();
    try {
      await until(() => seen.results.length > 0, "the interrupted run to be resumed");
      expect(seen.results.map((r) => [r.requestId, r.kind])).toEqual([["r-killed", "completed"]]);
      const submissions = seen.submissions();
      expect((await submissions.get(conversation, "r-killed", app.context()))?.kind).toBe("settled");
      expect(await submissions.pending(app.context())).toEqual([]);
      expect((await submissions.answers.read(undefined, 10)).items.map((item) => [item.fact.requestIds, item.fact.kind])).toEqual([[["r-killed"], "completed"]]);
    } finally {
      await app.stop();
    }
  } finally {
    file.dispose();
  }
}, 30_000);

test("an answer that ended while the channels were stopped is in agent.submissions' answers at the next start, and keepSettledDays is configurable", async () => {
  const file = databaseFile();
  try {
    const { agents, provider } = testComponents();
    const config = { "runtime-pi": { keepSettledDays: 3 } };
    const first = observer();
    const app = await defineApp({ components: [sqliteStorage(file.path), agents, provider, runtimePi, first.component], config, logger: silentLogger }).create();
    await app.start();
    const conversation = await first.conversation("test:later");
    await first.runtime().dispatch({ requestId: "r1", conversation, prompt: "hello" }, app.context());
    await until(() => first.results.length > 0, "the answer");
    await app.stop();

    const next = observer();
    const again = await defineApp({ components: [sqliteStorage(file.path), agents, provider, runtimePi, next.component], config, logger: silentLogger }).create();
    await again.start();
    try {
      const { items } = await next.submissions().answers.read(undefined, 10);
      expect(items.map((item) => item.fact)).toEqual([{ conversation, requestId: "r1", requestIds: ["r1"], kind: "completed", text: "answer: hello" }]);
    } finally {
      await again.stop();
    }
  } finally {
    file.dispose();
  }
}, 30_000);

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const { storage, agents, provider } = testComponents();
  const app = await defineApp({ components: [storage, agents, provider, runtimePi], logger: silentLogger }).create();

  const described = app.describe().components.find((component) => component.name === "runtime-pi");

  expect(described).toMatchObject({
    provides: ["agent.runtime", "agent.conversations", "agent.submissions", "agent.observe", "model.complete", "agent.command"],
    requires: ["storage.sql"],
    optional: ["agent.definition", "model.provider", "model.credentials", "secrets", "agent.tool", "agent.extension", "execution", "workspace", "wakeups", "settings", "agent.directory"],
  });
});

// With `wakeups` (SPEC §4.1, C4): every run is driven inside a run of the handler `runtime-pi.drive`,
// which waits for it one slice at a time; nothing is left running after the event that started it.

/** Stands for a channel: it reaches `agent.runtime`, `agent.conversations` and `agent.submissions`, and records every result. */
function observer() {
  const results: (AppEvents["agent.settled"] | AppEvents["agent.failed"])[] = [];
  let reached: { runtime: AgentRuntime; submissions: AgentSubmissions; conversation(key: string): Promise<ConversationRef> } | undefined;
  const component = defineComponent({
    name: "observer",
    setup(pikit) {
      const runtimeHandle = pikit.use("agent.runtime");
      const conversations = pikit.use("agent.conversations");
      const submissionsHandle = pikit.use("agent.submissions");
      pikit.on("agent.settled", (result) => void results.push(result));
      pikit.on("agent.failed", (result) => void results.push(result));
      return {
        start: (ctx) =>
          void (reached = {
            runtime: runtimeHandle.get(),
            submissions: submissionsHandle.get(),
            conversation: async (key) => ({ key, agent: "scripted", conversationId: await conversations.get().create(ctx) }),
          }),
      };
    },
  });
  const reach = () => {
    if (reached === undefined) throw new Error("the observer has not started");
    return reached;
  };
  return {
    component,
    results,
    runtime: () => reach().runtime,
    submissions: () => reach().submissions,
    conversation: (key: string) => reach().conversation(key),
  };
}

/** Waits until `probe` holds, polling. */
async function until(probe: () => boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

/** Whether `promise` is still pending after other work had a moment to run. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => false), Bun.sleep(50).then(() => true)]);
}

/**
 * `wakeups` the test drives by hand, standing for Cloudflare's: it records the requests, and `run` takes
 * one and runs its handler with a context the test cancels, as the provider does at its slice deadline.
 */
function handDrivenWakeups() {
  const handlers = new Map<string, WakeupHandler>();
  const requests = new Map<string, number>();
  const component = defineComponent({
    name: "wakeups-by-hand",
    setup(pikit) {
      pikit.provide("wakeups", {
        handle: (name, handler) => void handlers.set(name, handler),
        at: async (name, time) => void requests.set(name, time),
        cancel: async (name) => void requests.delete(name),
      });
      return { stop: () => handlers.clear() };
    },
  });
  return {
    component,
    requests,
    run(app: App, name = DRIVE) {
      const handler = handlers.get(name);
      if (handler === undefined || !requests.has(name)) throw new Error(`no request for ${name}`);
      requests.delete(name);
      const slice = withCancel(BACKGROUND_CONTEXT);
      return { done: handler(app.context(slice.context)), cut: () => slice.cancel(new Error("the slice deadline passed")) };
    },
  };
}

test("with wakeups, a run whose worker died mid-run completes when the next app's wakeup fires, with no new message", async () => {
  const file = databaseFile();
  try {
    // The object's storage: its wakeup rows outlive each App, as a Durable Object's SQL does.
    const wakeups = createMemoryWakeups({ durable: true });
    // The dead worker admitted the message, asked for a wakeup to drive its run, and died mid-run.
    const conversation = await interruptRun(file.open, { requestId: "r-killed", key: "test:killed" });
    const asks = defineComponent({
      name: "dead-worker",
      setup(pikit) {
        const handle = pikit.use("wakeups");
        return { start: (ctx) => handle.get().at(DRIVE, ctx.clock.now(), ctx) };
      },
    });
    const dead = await defineApp({ components: [wakeups, asks], logger: silentLogger }).create();
    await dead.start();
    await dead.stop();

    const { agents, provider } = testComponents();
    const seen = observer();
    const app = await defineApp({
      components: [sqliteStorage(file.path), agents, provider, wakeups, runtimePi, seen.component],
      logger: silentLogger,
    }).create();
    await app.start();
    try {
      await until(() => seen.results.length > 0, "the killed run's answer");
      expect(seen.results.map((r) => [r.requestId, r.kind])).toEqual([["r-killed", "completed"]]);
      expect((await seen.submissions().get(conversation, "r-killed", app.context()))?.kind).toBe("settled");
      expect(await seen.submissions().pending(app.context())).toEqual([]);
    } finally {
      await app.stop();
    }
  } finally {
    file.dispose();
  }
}, 30_000);

test("with wakeups, a long run is driven over several slices: each cut asks again at once, and the last one ends with the run", async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const holding = new Promise<void>((resolve) => (held = resolve));
  const hold = holdTool(async () => {
    held();
    await released;
    return "released";
  });
  const { agents, provider, storage } = testComponents({ agents: [scriptedAgent(hold)] });
  const wakeups = handDrivenWakeups();
  const seen = observer();
  const app = await defineApp({
    components: [storage, agents, provider, wakeups.component, runtimePi, seen.component],
    logger: silentLogger,
  }).create();
  await app.start();
  // At start, a wakeup resumes what is pending: nothing here, so it ends at once.
  await wakeups.run(app).done;
  expect(wakeups.requests.has(DRIVE)).toBe(false);
  const conversation = await seen.conversation("test:slices");
  const runtime = seen.runtime();

  const before = Date.now();
  expect(await runtime.dispatch({ requestId: "r1", conversation, prompt: "hold" }, app.context())).toEqual({ kind: "started", requestId: "r1" });
  // Asked for before the dispatch resolved, for now.
  expect(wakeups.requests.get(DRIVE)).toBeGreaterThanOrEqual(before);
  expect(wakeups.requests.get(DRIVE)).toBeLessThanOrEqual(Date.now());
  await holding;

  for (let slice = 1; slice <= 3; slice++) {
    const run = wakeups.run(app);
    expect(await pending(run.done)).toBe(true);
    run.cut();
    await run.done;
    // Cut with the run still going: it asked again, for now.
    expect(wakeups.requests.has(DRIVE)).toBe(true);
    expect(wakeups.requests.get(DRIVE)).toBeLessThanOrEqual(Date.now());
  }
  expect(seen.results).toEqual([]);

  const last = wakeups.run(app);
  expect(await pending(last.done)).toBe(true);
  release();
  await last.done;
  // The run ended inside the slice, which ends with it and asks for nothing more.
  expect(seen.results.map((r) => [r.requestId, r.kind, r.text])).toEqual([["r1", "completed", "answer: hold"]]);
  expect(wakeups.requests.has(DRIVE)).toBe(false);
  await app.stop();
}, 30_000);

test("with wakeups, a model retry's backoff is a wakeup at its time, not a timer: the slice suspends pi-durable, and the run answers when it fires", async () => {
  let failed = false;
  const { agents, provider, storage } = testComponents({
    // The first model call fails with an error pi-durable retries after its backoff.
    fail: () => (failed ? undefined : ((failed = true), Promise.resolve("503 Service Unavailable"))),
  });
  const wakeups = handDrivenWakeups();
  const seen = observer();
  const app = await defineApp({
    components: [storage, agents, provider, wakeups.component, createRuntimePi({ settings: { retry: { baseDelayMs: 1_000 } } }), seen.component],
    logger: silentLogger,
  }).create();
  await app.start();
  await wakeups.run(app).done;
  const conversation = await seen.conversation("test:retry");
  const runtime = seen.runtime();

  const before = Date.now();
  await runtime.dispatch({ requestId: "r1", conversation, prompt: "hello" }, app.context());
  // The slice drives the run to its retry wait and ends there, asking to be woken when it is due.
  await wakeups.run(app).done;
  const due = wakeups.requests.get(DRIVE) as number;
  expect(due).toBeGreaterThanOrEqual(before + 1_000);
  expect(seen.results).toEqual([]);

  await Bun.sleep(Math.max(0, due - Date.now()) + 50);
  // Suspended: nothing ran the retry in the meantime; the wakeup reopens pi-durable and the run answers.
  expect(seen.results).toEqual([]);
  await wakeups.run(app).done;
  expect(seen.results.map((r) => [r.requestId, r.kind, r.text])).toEqual([["r1", "completed", "answer: hello"]]);
  expect(wakeups.requests.has(DRIVE)).toBe(false);
  await app.stop();
}, 30_000);

test("with wakeups, stop cancels a handler waiting on a run and asks again for the next app", async () => {
  const { storage, agents, provider } = testComponents({
    agents: [
      scriptedAgent(
        holdTool(
          (context) =>
            new Promise<string>((_, reject) => context.abortSignal?.addEventListener("abort", () => reject(context.abortSignal?.reason), { once: true })),
        ),
      ),
    ],
  });
  const wakeups = handDrivenWakeups();
  const seen = observer();
  const app = await defineApp({ components: [storage, agents, provider, wakeups.component, runtimePi, seen.component], logger: silentLogger }).create();
  await app.start();
  // At start, resuming is asked for as a wakeup.
  expect(wakeups.requests.has(DRIVE)).toBe(true);
  await wakeups.run(app).done;
  await seen.runtime().dispatch({ requestId: "r1", conversation: await seen.conversation("test:stop"), prompt: "hold" }, app.context());
  const run = wakeups.run(app);
  expect(await pending(run.done)).toBe(true);

  const stopped = app.stop().then(() => "stopped");

  expect(await Promise.race([stopped, Bun.sleep(2_000).then(() => "still waiting")])).toBe("stopped");
  await run.done;
  expect(wakeups.requests.has(DRIVE)).toBe(true);
});

/** Why `start()` failed: the app reports the component, the cause says why. */
async function startFailure(app: { start(): Promise<void> }): Promise<string> {
  const error = await app.start().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof Error)) throw new Error("expected start() to fail");
  return String(error.cause instanceof Error ? error.cause.message : error.cause);
}

test("it refuses to start without an agent", async () => {
  const { storage, provider } = testComponents();
  const app = await defineApp({ components: [storage, provider, runtimePi], logger: silentLogger }).create();

  expect(await startFailure(app)).toContain("no agent.definition");
});

test("it refuses to start with two stewards, naming both", async () => {
  const { storage, agents, provider } = testComponents({
    agents: [
      defineAgent({ name: "support", model: "faux/scripted", steward: true }),
      defineAgent({ name: "assistant", model: "faux/scripted", steward: true }),
      defineAgent({ name: "triage", model: "faux/scripted" }),
    ],
  });
  const app = await defineApp({ components: [storage, agents, provider, runtimePi], logger: silentLogger }).create();

  expect(await startFailure(app)).toContain('agents "assistant" and "support" are each marked `steward: true`');
});

test("it refuses to start when an agent names a model no provider has", async () => {
  const { storage, agents, provider } = testComponents({
    agents: [defineAgent({ name: "support", model: "anthropic/claude-sonnet" })],
  });
  const app = await defineApp({ components: [storage, agents, provider, runtimePi], logger: silentLogger }).create();

  expect(await startFailure(app)).toContain('"anthropic/claude-sonnet"');
});

/** A provider that is configured only by an API key stored in `model.credentials`. */
const keyedProvider = defineComponent({
  name: "provider-keyed",
  setup: (pikit) => pikit.provideKeyed("model.provider", "faux", scriptedProvider({ apiKey: "made-up-key" })),
});

/** A `model.credentials` holding `stored`, kept in memory for the test. */
function credentialsHolding(stored: Record<string, Credential>) {
  const store: CredentialStore = {
    read: async (id) => stored[id],
    list: async () => Object.entries(stored).map(([providerId, credential]) => ({ providerId, type: credential.type })),
    modify: async (id, fn) => {
      const next = await fn(stored[id]);
      if (next !== undefined) stored[id] = next;
      return next ?? stored[id];
    },
    delete: async (id) => void delete stored[id],
  };
  return defineComponent({ name: "credentials-test", setup: (pikit) => pikit.provide("model.credentials", store) });
}

test("it refuses to start when an agent's provider has no credentials", async () => {
  const { storage, agents } = testComponents();
  const app = await defineApp({ components: [storage, agents, keyedProvider, runtimePi], logger: silentLogger }).create();

  expect(await startFailure(app)).toContain('provider "faux", which has no credentials');
});

/** Starts `components` with runtime-pi and a channel stand-in; `ask` answers with the run's text. */
async function talk(components: Parameters<typeof defineApp>[0]["components"]) {
  const answers = new Map<string, (text: string | undefined) => void>();
  const seen = observer();
  const settledBy = defineComponent({ name: "answers", setup: (pikit) => pikit.on("agent.settled", (result) => answers.get(result.requestId)?.(result.text)) });
  const app = await defineApp({ components: [...components, runtimePi, seen.component, settledBy], logger: silentLogger }).create();
  await app.start();
  const conversation = await seen.conversation("test:talk");
  return {
    app,
    ask(requestId: string, prompt: string) {
      const answer = new Promise<string | undefined>((resolve) => answers.set(requestId, resolve));
      return seen
        .runtime()
        .dispatch({ requestId, conversation, prompt }, app.context())
        .then(() => answer);
    },
  };
}

test("it builds the models with model.credentials: a stored key lets the agent answer", async () => {
  const { storage, agents } = testComponents();
  const credentials = credentialsHolding({ faux: { type: "api_key", key: "made-up-key" } });
  const { app, ask } = await talk([storage, agents, keyedProvider, credentials]);

  expect(await ask("r1", "hello")).toBe("answer: hello");
  await app.stop();
});

/** A provider whose key is the variable `TEST_MODEL_KEY`, as pi-ai's built-in providers read theirs. */
const envKeyedProvider = defineComponent({
  name: "provider-env-keyed",
  setup: (pikit) => pikit.provideKeyed("model.provider", "faux", { ...scriptedProvider(), auth: { apiKey: envApiKeyAuth("Test key", ["TEST_MODEL_KEY"]) } }),
});

test("a provider's variable is read through secrets first: a key there lets the agent answer, with nothing in the environment", async () => {
  const { storage, agents } = testComponents();
  const refused = await defineApp({ components: [storage, agents, envKeyedProvider, runtimePi], logger: silentLogger }).create();
  expect(await startFailure(refused)).toContain('provider "faux", which has no credentials');

  const asked: string[] = [];
  const secrets = defineComponent({
    name: "secrets-test",
    setup: (pikit) => pikit.provide("secrets", { get: async (name) => (asked.push(name), name === "TEST_MODEL_KEY" ? "made-up-key" : undefined) }),
  });
  const { app, ask } = await talk([testComponents().storage, agents, envKeyedProvider, secrets]);
  expect(await ask("r1", "hello")).toBe("answer: hello");
  expect(asked).toContain("TEST_MODEL_KEY");
  await app.stop();
});

/** Provides `bash` as a `tool-bash` component would, recording what it is asked to run. */
function bashComponent(ran: string[], key = "bash") {
  return defineComponent({ name: "tool-test", setup: (pikit) => pikit.provideKeyed("agent.tool", key, recordingBash(ran)) });
}

/** An `execution`, as execution-local provides it: an agent naming `bash` needs one to start. Never touched. */
const execution = defineComponent({ name: "execution-test", setup: (pikit) => pikit.provide("execution", createLocalExecution({ cwd: tmpdir(), env: {} })) });

test("an agent's named tools are the installed agent.tool ones", async () => {
  const ran: string[] = [];
  const { storage, agents, provider } = testComponents({ agents: [defineAgent({ name: "scripted", model: "faux/scripted", tools: ["bash"] })] });
  const { app, ask } = await talk([storage, agents, provider, execution, bashComponent(ran)]);

  expect(await ask("r1", "bash: ls")).toBe("tool said: ran");
  expect(ran).toEqual(["ls"]);
  await app.stop();
});

test("it refuses to start when an agent names a tool no agent.tool provides", async () => {
  const { storage, agents, provider } = testComponents({ agents: [defineAgent({ name: "scripted", model: "faux/scripted", tools: ["bash"] })] });
  const app = await defineApp({ components: [storage, agents, provider, runtimePi], logger: silentLogger }).create();

  expect(await startFailure(app)).toContain('agent "scripted" names the tool "bash", which no agent.tool provides: install the component that provides it');
});

test("it refuses to start when an agent names a coding tool and no execution or workspace is installed", async () => {
  const { storage, agents, provider } = testComponents({ agents: [defineAgent({ name: "scripted", model: "faux/scripted", tools: ["bash"] })] });
  const app = await defineApp({ components: [storage, agents, provider, bashComponent([]), runtimePi], logger: silentLogger }).create();

  expect(await startFailure(app)).toContain('agent "scripted" names the tool "bash", which works on files and commands, and no execution is installed: install one');
});

test("it refuses to start when a tool is provided under another name", async () => {
  const { storage, agents, provider } = testComponents();
  const app = await defineApp({ components: [storage, agents, provider, bashComponent([], "shell"), runtimePi], logger: silentLogger }).create();

  expect(await startFailure(app)).toContain('the agent.tool "shell" is a tool named "bash"');
});

/** Moves the conversation's state to the phase it is called with (`agent.state`). */
const advance = defineTool({
  name: "advance",
  description: "Moves the release to another phase",
  parameters: Type.Object({ phase: Type.String() }),
  execute: async (args, _api, context) => {
    await context.value(AGENT_STATE)?.update({ phase: args.phase }, context);
    return { content: [{ type: "text", text: "advanced" }] };
  },
}) as unknown as AgentTool;

test("an agent's prepare gives it bash once a tool has moved its state on", async () => {
  const ran: string[] = [];
  const release = defineAgent({
    name: "scripted",
    model: "faux/scripted",
    tools: [advance],
    state: { phase: "testing" },
    prepare: (state) => (state.phase === "deploying" ? { tools: [advance, "bash"] } : {}),
  });
  const { storage, agents, provider } = testComponents({ agents: [release] });
  const { app, ask } = await talk([storage, agents, provider, bashComponent(ran)]);

  await ask("r1", "bash: ls");
  await ask("r2", 'call: advance {"phase":"deploying"}');
  const deployed = await ask("r3", "bash: ls");

  // The first `bash` call reached no tool: the agent did not have it yet.
  expect(ran).toEqual(["ls"]);
  expect(deployed).toBe("tool said: ran");
  await app.stop();
});

// model.complete: a text from one of the models the agents run on (the scripted model answers
// `answer: <prompt>`).
for (const c of createModelCompleteConformance(() => {
  const { storage, agents, provider } = testComponents();
  return { components: [storage, agents, provider, runtimePi], model: "faux/scripted", unknownModel: "faux/no-such-model", answer: (prompt) => `answer: ${prompt}` };
})) {
  test(`runtime-pi ${c.group}: ${c.name}`, () => c.run(), 30_000);
}

/** A conversation of the scripted agent with one exchange (`hello`, answered), through `seen`. */
async function oneExchange(seen: ReturnType<typeof observer>, key: string, ctx: Parameters<AgentRuntime["dispatch"]>[1]): Promise<ConversationRef> {
  const conversation = await seen.conversation(key);
  const before = seen.results.length;
  await seen.runtime().dispatch({ requestId: `${key}-1`, conversation, prompt: "hello" }, ctx);
  await until(() => seen.results.length > before, "the first answer");
  return conversation;
}

// /compact (agent.command), Pi's: in the conversation it runs in. A short one has nothing to cut.
for (const c of createAgentCommandConformance(() => {
  const { storage, agents, provider } = testComponents();
  const seen = observer();
  return {
    components: [storage, agents, provider, runtimePi, seen.component],
    conversation: (app) => oneExchange(seen, "test:compact", app.context()),
    runs: [
      {
        name: "compact",
        check: async (outcome) => {
          expect(outcome.text).toStartWith("Nothing to compact");
        },
      },
    ],
  };
})) {
  test(`runtime-pi /compact ${c.group}: ${c.name}`, () => c.run(), 30_000);
}

test("/compact summarizes the older messages of its conversation with its agent's model; the conversation goes on", async () => {
  const { storage, agents, provider } = testComponents();
  const seen = observer();
  let compact: AgentCommand | undefined;
  const commands = defineComponent({
    name: "commands-reader",
    setup(pikit) {
      const handle = pikit.useKeyed("agent.command");
      return { start: () => void (compact = handle.get("compact")) };
    },
  });
  // Keep almost nothing verbatim: every exchange but the last is summarized.
  const runtime = createRuntimePi({ settings: { compaction: { keepRecentTokens: 1 } } });
  const app = await defineApp({ components: [storage, agents, provider, runtime, seen.component, commands], logger: silentLogger }).create();
  await app.start();
  try {
    const ctx = app.context();
    const conversation = await oneExchange(seen, "test:compacted", ctx);
    await seen.runtime().dispatch({ requestId: "test:compacted-2", conversation, prompt: "and again" }, ctx);
    await until(() => seen.results.length > 1, "the second answer");

    const done = await compact?.run(conversation, "keep the greetings", ctx);

    expect(done).toEqual({ text: "Compacted: the older messages are summarized, and the model reads the summary from now on." });
    await seen.runtime().dispatch({ requestId: "test:compacted-3", conversation, prompt: "still here?" }, ctx);
    await until(() => seen.results.length > 2, "the answer after the compaction");
    expect(seen.results.at(-1)).toMatchObject({ kind: "completed", text: "answer: still here?" });
  } finally {
    await app.stop();
  }
}, 30_000);
