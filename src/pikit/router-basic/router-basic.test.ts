/**
 * router-basic's tests. They are copied with the component and keep running in your project.
 */

import { expect, test } from "bun:test";
import { defineApp, defineComponent, silentLogger } from "@pikit/core";
import { defineAgent, type InboundMessage } from "@pikit/contracts";
import { createLifecycleConformance } from "@pikit/core/testing";
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
    optional: ["agent.definition"],
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
