/**
 * The agents' live overrides (`overrides.ts`): with a `settings` provider installed, an operator's
 * system prompt, model and tools for an agent apply from its next admission, after its `prepare`, and
 * after a restart too; without one, every agent is its definition. `settings` is a double here (a map,
 * validating against the declared schema): settings-store passes the contract's suite on its own.
 */

import { expect, test } from "bun:test";
import { type AppContext, type AppEvents, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { type AgentRuntime, type AgentTool, type ConversationRef, defineAgent, type Settings, SettingsError, type SettingsValue } from "@pikit/contracts";
import { type ModelRequest, scriptedProvider, sqliteStorage } from "@pikit/pi-adapter/testing";
import { defineTool } from "@pikit/pi-adapter/tools";
import Type from "typebox";
import Value from "typebox/value";
import runtimePi from "./index.ts";
import { withOverride } from "./overrides.ts";

const tool = (name: string) =>
  defineTool({ name, description: `The ${name} tool`, parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: name }] }) }) as unknown as AgentTool;
const lookup = tool("lookup");
const notes = tool("notes");

/** `settings` in memory: what was declared, and what was stored, shared by every App of a test. */
function memorySettings() {
  const stored = new Map<string, SettingsValue>();
  const declared = new Map<string, { schema: object; defaults: SettingsValue }>();
  let reads = 0;
  const provider: Settings = {
    declare(component, schema, defaults) {
      declared.set(component, { schema, defaults });
    },
    async get<T extends SettingsValue>(component: string) {
      reads++;
      const found = declared.get(component);
      if (found === undefined) throw new SettingsError("unknown_component", component);
      return structuredClone({ ...found.defaults, ...stored.get(component) }) as T;
    },
    async set(component, value) {
      const found = declared.get(component);
      if (found === undefined) throw new SettingsError("unknown_component", component);
      if (!Value.Check(found.schema as never, { ...found.defaults, ...value })) throw new SettingsError("invalid_value", component);
      stored.set(component, structuredClone(value));
      return value;
    },
    async sections() {
      return [];
    },
  };
  return {
    provider,
    schema: () => declared.get("runtime-pi")?.schema,
    reads: () => reads,
    component: () => defineComponent({ name: "settings-test", setup: (pikit) => pikit.provide("settings", provider) }),
  };
}

/** A system entry of pi-durable's, as far as these tests read it. */
type SystemEntry = { role: string; sections?: { instructions?: string }; toolsAdded?: { name: string }[]; toolsRemoved?: (string | { name: string })[] };

/** Two scripted providers, `faux` and `alt`, recording which was asked and what it was told. */
function providers() {
  const asked: { provider: string; system: string; tools: string[] }[] = [];
  // pi-durable tells the model its instructions and tools in system entries: each one's changes, in order.
  const record = (provider: string) => (request: ModelRequest) => {
    let system = "";
    const tools = new Set<string>();
    for (const message of request.messages as unknown as SystemEntry[]) {
      if (message.role !== "system") continue;
      if (message.sections?.instructions !== undefined) system = message.sections.instructions;
      for (const each of message.toolsRemoved ?? []) tools.delete(typeof each === "string" ? each : each.name);
      for (const each of message.toolsAdded ?? []) tools.add(each.name);
    }
    asked.push({ provider, system, tools: [...tools].sort() });
  };
  const faux = scriptedProvider({ id: "faux", onRequest: record("faux") });
  const alt = scriptedProvider({ id: "alt", onRequest: record("alt") });
  return {
    asked,
    component: defineComponent({
      name: "providers-test",
      setup(pikit) {
        pikit.provideKeyed("model.provider", "faux", faux);
        pikit.provideKeyed("model.provider", "alt", alt);
      },
    }),
  };
}

const assistant = defineAgent({ name: "assistant", model: "faux/scripted", systemPrompt: "Be brief.", tools: [lookup, notes] });

const agents = (definition = assistant) =>
  defineComponent({ name: "agents-test", setup: (pikit) => pikit.provideKeyed("agent.definition", definition.name, definition) });

/** An App of runtime-pi with `extra`, and a channel's way to ask it and wait for the answer. */
async function started(extra: ReturnType<typeof defineComponent>[]) {
  const results: (AppEvents["agent.settled"] | AppEvents["agent.failed"])[] = [];
  let runtime: AgentRuntime | undefined;
  let create: ((ctx: AppContext) => Promise<string>) | undefined;
  const channel = defineComponent({
    name: "channel-test",
    setup(pikit) {
      const handle = pikit.use("agent.runtime");
      const conversations = pikit.use("agent.conversations");
      pikit.on("agent.settled", (result) => void results.push(result));
      pikit.on("agent.failed", (result) => void results.push(result));
      return {
        start() {
          runtime = handle.get();
          create = (ctx) => conversations.get().create(ctx);
        },
      };
    },
  });
  const app = await defineApp({ components: [...extra, runtimePi, channel], logger: silentLogger }).create();
  await app.start();
  const ctx = app.context();
  const ask = async (conversation: ConversationRef, requestId: string, prompt: string) => {
    const before = results.length;
    await runtime?.dispatch({ requestId, conversation, prompt }, ctx);
    const deadline = Date.now() + 10_000;
    while (results.length === before) {
      if (Date.now() > deadline) throw new Error(`no answer to ${requestId}`);
      await Bun.sleep(10);
    }
    return results.at(-1);
  };
  const conversation = async (key: string): Promise<ConversationRef> => ({ key, agent: "assistant", conversationId: await (create as (ctx: AppContext) => Promise<string>)(ctx) });
  return { app, ctx, ask, conversation };
}

test("an operator's override changes the next run's system prompt, model and tools; a restart builds the same agent", async () => {
  const settings = memorySettings();
  const models = providers();
  const storage = sqliteStorage();
  const first = await started([storage, agents(), models.component, settings.component()]);
  const conversation = await first.conversation("test:live");

  await first.ask(conversation, "r1", "hello");
  expect(models.asked.at(-1)).toMatchObject({ provider: "faux", tools: ["lookup", "notes"] });
  expect(models.asked.at(-1)?.system).toContain("Be brief.");

  await settings.provider.set("runtime-pi", { assistant: { systemPrompt: "Answer in French.", model: "alt/scripted", tools: ["lookup"] } }, { id: "ops" }, first.ctx);
  expect(await first.ask(conversation, "r2", "hello again")).toMatchObject({ kind: "completed", text: "answer: hello again" });
  expect(models.asked.at(-1)).toMatchObject({ provider: "alt", tools: ["lookup"] });
  expect(models.asked.at(-1)?.system).toContain("Answer in French.");
  expect(models.asked.at(-1)?.system).not.toContain("Be brief.");
  await first.app.stop();

  // The next process, over the same storage and settings: the same agent.
  const second = await started([storage, agents(), models.component, settings.component()]);
  await second.ask(conversation, "r3", "still there?");
  expect(models.asked.at(-1)).toMatchObject({ provider: "alt", tools: ["lookup"] });
  expect(models.asked.at(-1)?.system).toContain("Answer in French.");

  // Taken back: the definition again.
  await settings.provider.set("runtime-pi", {}, { id: "ops" }, second.ctx);
  await second.ask(conversation, "r4", "and now?");
  expect(models.asked.at(-1)).toMatchObject({ provider: "faux", tools: ["lookup", "notes"] });
  expect(models.asked.at(-1)?.system).toContain("Be brief.");
  await second.app.stop();
}, 30_000);

test("runtime-pi declares an override per agent, among the installed providers' models and the tools its definition names", async () => {
  const settings = memorySettings();
  const models = providers();
  const { app } = await started([sqliteStorage(), agents(), models.component, settings.component()]);
  const schema = settings.schema() as never;
  try {
    expect(Value.Check(schema, {})).toBe(true);
    expect(Value.Check(schema, { assistant: { model: "alt/scripted", tools: ["notes"], systemPrompt: "Hi." } })).toBe(true);
    expect(Value.Check(schema, { assistant: { model: "nobody/nothing" } })).toBe(false);
    expect(Value.Check(schema, { assistant: { tools: ["bash"] } })).toBe(false);
    expect(Value.Check(schema, { stranger: {} })).toBe(false);
    // What the dashboard shows when nothing is overridden: the definition's.
    const fields = (settings.schema() as { properties: { assistant: { properties: Record<string, { default?: unknown }> } } }).properties.assistant.properties;
    expect([fields.systemPrompt?.default, fields.model?.default, fields.tools?.default]).toEqual(["Be brief.", "faux/scripted", ["lookup", "notes"]]);
  } finally {
    await app.stop();
  }
}, 30_000);

test("an override goes over what prepare gives; a tool prepare adds beyond the definition's stays", () => {
  const extra = tool("extra");
  const agent = defineAgent({ name: "assistant", model: "faux/scripted", systemPrompt: "Static.", tools: [lookup, notes], prepare: () => ({ systemPrompt: "From state.", tools: [lookup, notes, extra] }) });
  const ref = { conversation: { key: "k", agent: "assistant", conversationId: "c" } };

  expect(withOverride(agent, undefined)).toBe(agent);
  expect(withOverride(agent, {})).toBe(agent);
  const changed = withOverride(agent, { systemPrompt: "From the operator.", tools: ["notes"] });
  const turn = changed?.prepare?.({}, ref);
  expect(turn?.systemPrompt).toBe("From the operator.");
  expect(turn?.tools?.map((each) => (typeof each === "string" ? each : each.name))).toEqual(["notes", "extra"]);
  expect(changed?.model).toBe("faux/scripted");
});
