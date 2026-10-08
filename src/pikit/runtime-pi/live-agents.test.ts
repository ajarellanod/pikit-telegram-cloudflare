/**
 * The live agents (`agent.directory`, agents-live): a name no `agent.definition` has is looked up in
 * the directory when used, checked then (not at start), and runs as a definition does, with the
 * operator's overrides. The directory is a double here (a list): agents-live passes the contract's
 * suite on its own.
 */

import { expect, test } from "bun:test";
import { type AppContext, type AppEvents, defineApp, defineComponent, silentLogger } from "@pikit/core";
import {
  type AgentRuntime,
  type AgentTool,
  type AgentUnavailableError,
  type ConversationRef,
  defineAgent,
  type DirectoryAgent,
  isAgentUnavailable,
  type Settings,
  SettingsError,
  type SettingsValue,
} from "@pikit/contracts";
import { type ModelRequest, scriptedProvider, sqliteStorage } from "@pikit/pi-adapter/testing";
import { defineTool } from "@pikit/pi-adapter/tools";
import Type from "typebox";
import Value from "typebox/value";
import runtimePi from "./index.ts";

const lookup = defineTool({ name: "lookup", description: "Looks up", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "found" }] }) }) as unknown as AgentTool;

/** What each model request was told: its system prompt's instructions. */
type SystemEntry = { role: string; sections?: { instructions?: string } };

/** The App's other parts: the code's agent, a provider recording what it was told, a tool, and the directory (a list). */
function project() {
  const told: string[] = [];
  const onRequest = (request: ModelRequest) => {
    let system = "";
    for (const message of request.messages as unknown as SystemEntry[]) if (message.role === "system" && message.sections?.instructions !== undefined) system = message.sections.instructions;
    told.push(system);
  };
  const agents: DirectoryAgent[] = [];
  let reads = 0;
  let failing = false;
  return {
    told,
    agents,
    reads: () => reads,
    fail: (on: boolean) => void (failing = on),
    component: defineComponent({
      name: "project-test",
      setup(pikit) {
        pikit.provideKeyed("agent.definition", "assistant", defineAgent({ name: "assistant", model: "faux/scripted", systemPrompt: "The code's." }));
        pikit.provideKeyed("model.provider", "faux", scriptedProvider({ onRequest }));
        pikit.provideKeyed("agent.tool", "lookup", lookup);
        pikit.provide("agent.directory", {
          async list() {
            reads++;
            if (failing) throw new Error("unreachable");
            return structuredClone(agents);
          },
          async get(name) {
            return structuredClone(agents.find((agent) => agent.name === name));
          },
        });
      },
    }),
  };
}

/** `settings` in memory, validating against what was declared. */
function memorySettings() {
  const stored = new Map<string, SettingsValue>();
  const declared = new Map<string, { schema: object; defaults: SettingsValue }>();
  const provider: Settings = {
    declare: (component, schema, defaults) => void declared.set(component, { schema, defaults }),
    async get<T extends SettingsValue>(component: string) {
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
    sections: async () => [],
  };
  return { provider, component: defineComponent({ name: "settings-test", setup: (pikit) => pikit.provide("settings", provider) }) };
}

/** An App of runtime-pi with `extra`, and a channel's way to ask an agent and wait for the answer. */
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
  const app = await defineApp({ components: [sqliteStorage(), ...extra, runtimePi, channel], logger: silentLogger }).create();
  await app.start();
  const ctx = app.context();
  const conversation = async (agent: string): Promise<ConversationRef> => ({ key: `test:${agent}`, agent, conversationId: await (create as (ctx: AppContext) => Promise<string>)(ctx) });
  const dispatch = (conversation: ConversationRef, requestId: string, prompt: string) => (runtime as AgentRuntime).dispatch({ requestId, conversation, prompt }, ctx);
  const ask = async (conversation: ConversationRef, requestId: string, prompt: string) => {
    const before = results.length;
    await dispatch(conversation, requestId, prompt);
    const deadline = Date.now() + 10_000;
    while (results.length === before) {
      if (Date.now() > deadline) throw new Error(`no answer to ${requestId}`);
      await Bun.sleep(10);
    }
    return results.at(-1);
  };
  return { app, ctx, conversation, dispatch, ask };
}

test("a live agent answers with no restart, as the directory says it is now; the code's agent is as before", async () => {
  const parts = project();
  const { app, conversation, ask } = await started([parts.component]);
  // Made after start: the App knows nothing of it until it is used.
  parts.agents.push({ name: "support", model: "faux/scripted", systemPrompt: "Help customers.", tools: ["lookup"] });
  const support = await conversation("support");
  expect(await ask(support, "r1", "hello")).toMatchObject({ kind: "completed", text: "answer: hello" });
  expect(parts.told.at(-1)).toContain("Help customers.");

  // Changed in the dashboard: the next run has it.
  (parts.agents[0] as DirectoryAgent).systemPrompt = "Help customers, in French.";
  await ask(support, "r2", "again");
  expect(parts.told.at(-1)).toContain("in French.");

  await ask(await conversation("assistant"), "r3", "and you?");
  expect(parts.told.at(-1)).toContain("The code's.");
  await app.stop();
}, 30_000);

test("a name that is no agent, or a live agent that cannot run here, fails its admission saying why; start checked neither", async () => {
  const parts = project();
  parts.agents.push(
    { name: "shell", model: "faux/scripted", tools: ["bash"] },
    { name: "elsewhere", model: "gone/model" },
    { name: "knows", model: "faux/scripted", extensions: ["pikit-self"] },
    { name: "boss", model: "faux/scripted", steward: true } as DirectoryAgent,
  );
  const { app, conversation, dispatch } = await started([parts.component]);

  await expect(dispatch(await conversation("nobody"), "r1", "hi")).rejects.toThrow(
    'runtime-pi: no agent "nobody": it is no agent.definition, nor a live agent of agent.directory (agents: "assistant")',
  );
  await expect(dispatch(await conversation("shell"), "r2", "hi")).rejects.toThrow('runtime-pi: live agent "shell" names the tool "bash", which no agent.tool provides');
  await expect(dispatch(await conversation("elsewhere"), "r3", "hi")).rejects.toThrow('runtime-pi: live agent "elsewhere" names model "gone/model", which no model.provider provides');
  // Never the steward (SPEC §6): not marked so, and not naming what only the steward may.
  await expect(dispatch(await conversation("knows"), "r4", "hi")).rejects.toThrow('runtime-pi: live agent "knows" names "pikit-self", which only the steward may name');
  await expect(dispatch(await conversation("boss"), "r5", "hi")).rejects.toThrow('runtime-pi: live agent "boss" is marked steward; a live agent never is');
  await app.stop();
}, 30_000);

test("a live agent gets the operator's overrides, as a code agent does", async () => {
  const parts = project();
  parts.agents.push({ name: "support", model: "faux/scripted", systemPrompt: "Help customers." });
  const settings = memorySettings();
  const { app, ctx, conversation, ask } = await started([parts.component, settings.component]);
  await settings.provider.set("runtime-pi", { support: { systemPrompt: "Overridden." } }, { id: "ops" }, ctx);
  await ask(await conversation("support"), "r1", "hello");
  expect(parts.told.at(-1)).toContain("Overridden.");
  // An override's fields are checked against the App, a live agent's too.
  await expect(settings.provider.set("runtime-pi", { support: { model: "gone/model" } }, { id: "ops" }, ctx)).rejects.toThrow(SettingsError);
  await app.stop();
}, 30_000);

test("a live agent deleted is gone for good (AgentUnavailableError); a directory never read is not (a plain error: try again)", async () => {
  const parts = project();
  parts.agents.push({ name: "support", model: "faux/scripted" });
  const { app, conversation, dispatch, ask } = await started([parts.component]);
  const support = await conversation("support");
  await ask(support, "r1", "hello");
  parts.agents.length = 0;
  const gone = await dispatch(support, "r2", "still there?").then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(isAgentUnavailable(gone)).toBe(true);
  expect((gone as AgentUnavailableError).agent).toBe("support");
  await app.stop();

  // A new App whose directory cannot be read: the agent may be live, so it is not gone.
  parts.agents.push({ name: "support", model: "faux/scripted" });
  parts.fail(true);
  const second = await started([parts.component]);
  const unread = await second.dispatch(await second.conversation("support"), "r3", "hi").then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(unread).toBeInstanceOf(Error);
  expect(isAgentUnavailable(unread)).toBe(false);
  expect((unread as Error).message).toContain("could not be read yet");
  await second.app.stop();
}, 30_000);

test("a directory that cannot be read keeps the agents read last", async () => {
  const parts = project();
  parts.agents.push({ name: "support", model: "faux/scripted", systemPrompt: "Help customers." });
  const { app, conversation, ask } = await started([parts.component]);
  const support = await conversation("support");
  await ask(support, "r1", "hello");
  parts.fail(true);
  expect(await ask(support, "r2", "still there?")).toMatchObject({ kind: "completed" });
  expect(parts.told.at(-1)).toContain("Help customers.");
  await app.stop();
}, 30_000);
