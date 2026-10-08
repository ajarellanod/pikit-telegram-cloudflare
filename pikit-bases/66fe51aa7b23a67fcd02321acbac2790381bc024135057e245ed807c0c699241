/**
 * router-basic's tests. They are copied with the component and keep running in your project.
 */

import { expect, test } from "bun:test";
import { defineApp, defineComponent, silentLogger } from "@pikit/core";
import { defineAgent, type InboundMessage, type Settings, SettingsError, type SettingsValue } from "@pikit/contracts";
import { createLifecycleConformance } from "@pikit/core/testing";
import Value from "typebox/value";
import routerBasic from "./index.ts";

const agents = defineComponent({
  name: "agents-test",
  setup(pikit) {
    for (const name of ["assistant", "billing"]) pikit.provideKeyed("agent.definition", name, defineAgent({ name, model: "faux/scripted" }));
  },
});

const message: InboundMessage = {
  id: "m1",
  channel: "http",
  conversationId: "c1",
  actor: { id: "someone" },
  text: "hello",
  raw: {},
  receivedAt: 0,
};

const config = { "router-basic": { defaultAgent: "assistant" } };

for (const c of createLifecycleConformance(() => ({ component: routerBasic, providers: [agents], config }))) {
  test(`router-basic ${c.group}: ${c.name}`, () => c.run());
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [agents, routerBasic], config, logger: silentLogger }).create();

  expect(app.describe().components.find((component) => component.name === "router-basic")).toMatchObject({
    provides: [],
    requires: [],
    optional: ["agent.definition", "settings"],
  });
  expect(app.describe().pipelines["route.resolve"]).toEqual([{ id: "router-basic", priority: 0 }]);
});

test("a message no stage routed goes to defaultAgent", async () => {
  const app = await defineApp({ components: [agents, routerBasic], config, logger: silentLogger }).create();
  await app.start();

  expect(await app.context().run("route.resolve", { message })).toEqual({ message, decision: { agent: "assistant", access: "allow" } });
  await app.stop();
});

test("a decision an earlier stage made is left as it is", async () => {
  const billing = defineComponent({
    name: "billing-route",
    setup(pikit) {
      pikit.pipeline(
        "route.resolve",
        (value) => (value.message.text.includes("invoice") ? { ...value, decision: { agent: "billing", access: "allow" } } : value),
        { id: "billing", priority: 10 },
      );
    },
  });
  const app = await defineApp({ components: [agents, routerBasic, billing], config, logger: silentLogger }).create();
  await app.start();

  const routed = await app.context().run("route.resolve", { message: { ...message, text: "my invoice" } });
  const rest = await app.context().run("route.resolve", { message });

  expect(routed).toMatchObject({ decision: { agent: "billing" } });
  expect(rest).toMatchObject({ decision: { agent: "assistant" } });
  await app.stop();
});

test("it refuses to start when defaultAgent is not an agent", async () => {
  const app = await defineApp({
    components: [agents, routerBasic],
    config: { "router-basic": { defaultAgent: "support" } },
    logger: silentLogger,
  }).create();

  const error = await app.start().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(String((error as Error).cause)).toContain('defaultAgent "support" is not an agent.definition (agents: "assistant", "billing")');
});

test("defaultAgent is required", () => {
  expect(() => defineApp({ components: [agents, routerBasic], logger: silentLogger })).toThrow("invalid config");
});

/** `settings` in memory, validating against what was declared (settings-store passes the contract's suite on its own). */
function memorySettings() {
  const stored = new Map<string, SettingsValue>();
  const declared = new Map<string, { schema: object; defaults: SettingsValue }>();
  const provider: Settings = {
    declare: (component, schema, defaults) => void declared.set(component, { schema, defaults }),
    async get<T extends SettingsValue>(component: string) {
      const found = declared.get(component);
      if (found === undefined) throw new SettingsError("unknown_component", component);
      return { ...found.defaults, ...stored.get(component) } as T;
    },
    async set(component, value) {
      const found = declared.get(component);
      if (found === undefined) throw new SettingsError("unknown_component", component);
      if (!Value.Check(found.schema as never, { ...found.defaults, ...value })) throw new SettingsError("invalid_value", component);
      stored.set(component, value);
      return value;
    },
    sections: async () => [],
  };
  return { provider, stored, component: defineComponent({ name: "settings-test", setup: (pikit) => pikit.provide("settings", provider) }) };
}

test("with settings, the default agent an operator sets answers the next message; its default is defaultAgent", async () => {
  const settings = memorySettings();
  const app = await defineApp({ components: [agents, settings.component, routerBasic], config, logger: silentLogger }).create();
  await app.start();
  const ctx = app.context();

  expect(await settings.provider.get("router-basic", ctx)).toEqual({ defaultAgent: "assistant" });
  await settings.provider.set("router-basic", { defaultAgent: "billing" }, { id: "ops" }, ctx);
  expect(await ctx.run("route.resolve", { message })).toEqual({ message, decision: { agent: "billing", access: "allow" } });
  // Only the App's agents may be set.
  await expect(settings.provider.set("router-basic", { defaultAgent: "nobody" }, { id: "ops" }, ctx)).rejects.toThrow(SettingsError);
  await app.stop();
});

test("a default agent that is no agent now (a deploy removed it), or settings that cannot be read: defaultAgent answers", async () => {
  const settings = memorySettings();
  const warnings: string[] = [];
  const logger = { ...silentLogger, warn: (line: string) => void warnings.push(line) };
  const app = await defineApp({ components: [agents, settings.component, routerBasic], config, logger }).create();
  await app.start();
  const ctx = app.context();

  settings.stored.set("router-basic", { defaultAgent: "retired" });
  expect(await ctx.run("route.resolve", { message })).toEqual({ message, decision: { agent: "assistant", access: "allow" } });
  settings.provider.get = async () => {
    throw new Error("unreachable");
  };
  expect(await ctx.run("route.resolve", { message })).toEqual({ message, decision: { agent: "assistant", access: "allow" } });
  expect(warnings).toEqual([
    "router-basic: the default agent set from the dashboard is not an agent; defaultAgent applies",
    "router-basic: its settings could not be read; defaultAgent applies",
  ]);
  await app.stop();
});
