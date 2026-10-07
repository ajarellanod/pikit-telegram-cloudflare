/**
 * Agent extensions through runtime-pi in a real App: a component provides a Pi extension under
 * `agent.extension`, an agent names it, and its sections, hooks and tools reach that agent's runs and
 * no other's. They are copied with the component and keep running in your project.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppEvents, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { type AgentDefinition, type AgentRuntime, type AgentTool, CONVERSATION, type ConversationRef, defineAgent } from "@pikit/contracts";
import { defineDoc, defineExtension, defineTool, GenerationTask, hook, section, ToolTask } from "@pikit/pi-adapter/extensions";
import { createLocalExecution } from "@pikit/pi-adapter/node";
import { type ModelRequest, recordingBash, scriptedProvider, sqliteStorage } from "@pikit/pi-adapter/testing";
import Type from "typebox";
import runtimePi from "./index.ts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** The extension's own state: a conversation document, committed with the transcript. */
const Notes = defineDoc<{ items: string[] }>({
  kind: "test.notes",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ items: [] }),
});

/** A tool of the extension: it notes an item, with the conversation's key (it runs with `CONVERSATION`). */
const note = defineTool({
  name: "note",
  description: "Notes an item",
  parameters: Type.Object({ item: Type.String() }) as never,
  execute: async (args: { item: string }, api, context) => {
    const key = context.value(CONVERSATION)?.key ?? "no conversation";
    await api.commit(async (tx) => void (await tx.doc(Notes, api.conversationId)).items.push(`${key}: ${args.item}`), context);
    return { content: [{ type: "text", text: "noted" }] };
  },
});

/** `notes`: an async section that recalls the document, and the tool that writes it. */
const notes = defineExtension({
  name: "notes",
  tools: [note],
  sections: [
    section("notes", async (input, context) => {
      const doc = await input.read.snapshot(Notes, input.conversationId, context);
      return doc === undefined || doc.items.length === 0 ? undefined : doc.items.join("\n");
    }),
  ],
});

/** `guard`: blocks `bash`, and marks every model request it sees. */
const guard = defineExtension({
  name: "guard",
  hooks: [
    hook(ToolTask, { beforeTool: (call) => (call.name === "bash" ? { block: "bash is not allowed here" } : undefined) }),
    hook(GenerationTask, {
      beforeRequest: ({ messages }) => ({
        messages: messages.map((message) =>
          message.role === "user" && typeof message.content === "string" ? { ...message, content: `${message.content} (guarded)` } : message,
        ),
      }),
    }),
  ],
});

const extensionsComponent = (provided = [notes, guard]) =>
  defineComponent({
    name: "extensions-test",
    setup(pikit) {
      for (const extension of provided) pikit.provideKeyed("agent.extension", extension.name, extension);
    },
  });

const agentsComponent = (agents: AgentDefinition[]) =>
  defineComponent({
    name: "agents-test",
    setup(pikit) {
      for (const agent of agents) pikit.provideKeyed("agent.definition", agent.name, agent);
    },
  });

/** The scripted provider (`faux/scripted`), recording every model request. */
function recordedProvider() {
  const requests: ModelRequest[] = [];
  const provider = scriptedProvider({ onRequest: (request) => void requests.push(structuredClone(request)) });
  return { requests, component: defineComponent({ name: "provider-test", setup: (pikit) => pikit.provideKeyed("model.provider", "faux", provider) }) };
}

/** The system prompt sections a request carried, tagged (`<key>`): pi-durable sends each change as a positional system message. */
function sections(request: ModelRequest | undefined): Record<string, string> {
  const shown: Record<string, string> = {};
  for (const message of request?.messages ?? []) {
    if (message.role !== "system") continue;
    for (const [key, value] of Object.entries(message.sections ?? {})) {
      if (value === null) delete shown[key];
      else shown[key] = value;
    }
  }
  return shown;
}

function databaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "pikit-runtime-pi-extensions-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "pikit.db");
}

/** An App with runtime-pi over the SQLite file at `path`; `ask` dispatches and waits for the run's result. */
async function start(path: string, components: Parameters<typeof defineApp>[0]["components"]) {
  const results: (AppEvents["agent.settled"] | AppEvents["agent.failed"])[] = [];
  let reached: { runtime: AgentRuntime; create: () => Promise<string> } | undefined;
  const observer = defineComponent({
    name: "observer",
    setup(pikit) {
      const runtime = pikit.use("agent.runtime");
      const conversations = pikit.use("agent.conversations");
      pikit.on("agent.settled", (result) => void results.push(result));
      pikit.on("agent.failed", (result) => void results.push(result));
      return { start: (ctx) => void (reached = { runtime: runtime.get(), create: () => conversations.get().create(ctx) }) };
    },
  });
  const app = await defineApp({ components: [sqliteStorage(path), ...components, runtimePi, observer], logger: silentLogger }).create();
  await app.start();
  cleanup.push(() => app.stop());
  const live = () => {
    if (reached === undefined) throw new Error("the observer has not started");
    return reached;
  };
  return {
    app,
    stop: () => app.stop(),
    conversation: async (key: string, agent: string): Promise<ConversationRef> => ({ key, agent, conversationId: await live().create() }),
    async ask(conversation: ConversationRef, requestId: string, prompt: string) {
      await live().runtime.dispatch({ requestId, conversation, prompt }, app.context());
      const deadline = Date.now() + 10_000;
      for (;;) {
        const result = results.find((r) => r.requestId === requestId);
        if (result !== undefined) return result;
        if (Date.now() > deadline) throw new Error(`timed out waiting for the result of ${requestId}`);
        await Bun.sleep(5);
      }
    },
  };
}

/** A `bash` stand-in that records commands, and an `execution` (never touched): the runtime refuses `bash` without one. */
const bash = (ran: string[]) =>
  defineComponent({
    name: "tool-test",
    setup(pikit) {
      pikit.provideKeyed("agent.tool", "bash", recordingBash(ran) as AgentTool);
      pikit.provide("execution", createLocalExecution({ cwd: tmpdir(), env: {} }));
    },
  });

test("an extension's async section reads a conversation document its tool wrote, and its tool runs with the conversation", async () => {
  const provider = recordedProvider();
  const s = await start(databaseFile(), [agentsComponent([defineAgent({ name: "assistant", model: "faux/scripted", extensions: ["notes"] })]), provider.component, extensionsComponent()]);
  const conversation = await s.conversation("test:notes", "assistant");

  await s.ask(conversation, "r1", 'call: note {"item":"buy milk"}');

  // The request after the tool's commit renders the section from the document.
  expect(sections(provider.requests[0]).notes).toBeUndefined();
  expect(sections(provider.requests[1]).notes).toBe("<notes>\ntest:notes: buy milk\n</notes>");
});

test("an extension's beforeTool hook blocks a call, and its beforeRequest hook rewrites the request, only for the agent that names it", async () => {
  const ran: string[] = [];
  const provider = recordedProvider();
  const agents = [
    defineAgent({ name: "guarded", model: "faux/scripted", tools: ["bash"], extensions: ["guard"] }),
    defineAgent({ name: "plain", model: "faux/scripted", tools: ["bash"] }),
  ];
  const s = await start(databaseFile(), [agentsComponent(agents), provider.component, extensionsComponent(), bash(ran)]);

  const guarded = await s.ask(await s.conversation("test:guarded", "guarded"), "r1", "bash: rm -rf /");
  const greeted = await s.ask(await s.conversation("test:guarded-2", "guarded"), "r2", "hello");
  const plain = await s.ask(await s.conversation("test:plain", "plain"), "r3", "bash: ls");

  expect(guarded.text).toContain("bash is not allowed here");
  expect(greeted.text).toBe("answer: hello (guarded)");
  expect(plain.text).toBe("tool said: ran");
  expect(ran).toEqual(["ls"]);
});

test("an agent gets the tools of the extensions it names, and only those", async () => {
  const provider = recordedProvider();
  const agents = [defineAgent({ name: "noting", model: "faux/scripted", extensions: ["notes"] }), defineAgent({ name: "plain", model: "faux/scripted" })];
  const s = await start(databaseFile(), [agentsComponent(agents), provider.component, extensionsComponent()]);

  await s.ask(await s.conversation("test:noting", "noting"), "r1", "hello");
  await s.ask(await s.conversation("test:plain", "plain"), "r2", "hello");

  const offered = (request: ModelRequest | undefined) =>
    (request?.messages ?? []).flatMap((message) => (message.role === "system" ? (message.toolsAdded ?? []).map((tool) => tool.name) : []));
  expect([offered(provider.requests[0]), offered(provider.requests[1])]).toEqual([["note"], []]);
});

test("it refuses to start when an agent names an extension no agent.extension provides", async () => {
  const provider = recordedProvider();
  const components = [agentsComponent([defineAgent({ name: "assistant", model: "faux/scripted", extensions: ["memory"] })]), provider.component];

  const error = await start(databaseFile(), components).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(error instanceof Error ? String(error.cause instanceof Error ? error.cause.message : error.cause) : "started").toContain(
    'agent "assistant" names the extension "memory", which no agent.extension provides',
  );
});

test("it refuses to start when an extension is provided under another name", async () => {
  const provider = recordedProvider();
  const misnamed = defineComponent({ name: "misnamed", setup: (pikit) => pikit.provideKeyed("agent.extension", "memory", notes) });

  const error = await start(databaseFile(), [agentsComponent([defineAgent({ name: "assistant", model: "faux/scripted" })]), provider.component, misnamed]).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(error instanceof Error ? String(error.cause instanceof Error ? error.cause.message : error.cause) : "started").toContain(
    'the agent.extension "memory" is an extension named "notes"',
  );
});

test("an extension's state survives a restart: the next App's section renders what the last one's tool wrote", async () => {
  const path = databaseFile();
  const agents = [defineAgent({ name: "assistant", model: "faux/scripted", extensions: ["notes"] })];
  const first = recordedProvider();
  const before = await start(path, [agentsComponent(agents), first.component, extensionsComponent()]);
  const conversation = await before.conversation("test:restart", "assistant");
  await before.ask(conversation, "r1", 'call: note {"item":"one"}');
  await before.stop();

  const second = recordedProvider();
  const after = await start(path, [agentsComponent(agents), second.component, extensionsComponent()]);
  await after.ask(conversation, "r2", 'call: note {"item":"two"}');

  expect(sections(second.requests.at(-1)).notes).toBe("<notes>\ntest:restart: one\ntest:restart: two\n</notes>");
});
