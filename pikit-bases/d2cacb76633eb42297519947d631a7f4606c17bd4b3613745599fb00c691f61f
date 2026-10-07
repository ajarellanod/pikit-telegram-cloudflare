/**
 * tool-read's tests. They are copied with the component and keep running in your project. They
 * check what this component decides (its key, its replay, what it needs installed), not what the tool
 * does: that is pi-durable's, tested there.
 */

import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { defineApp, defineComponent, silentLogger } from "@pikit/core";
import type { AgentTool } from "@pikit/contracts";
import { createLocalExecution } from "@pikit/pi-adapter/node";
import { createReadTool } from "@pikit/pi-adapter/tools";
import toolUnderTest from "./index.ts";

/** `execution` and `execution.shell`, as execution-local provides them; no test touches its files. */
const execution = defineComponent({
  name: "execution-test",
  setup(pikit) {
    const env = createLocalExecution({ cwd: tmpdir(), env: {} });
    pikit.provide("execution", env);
    pikit.provide("execution.shell", env);
  },
});

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [execution, toolUnderTest], logger: silentLogger }).create();

  expect(app.describe().components.find((component) => component.name === "tool-read")).toMatchObject({
    provides: ["agent.tool"],
    requires: ["execution"],
    optional: ["workspace"],
  });
  expect(app.describe().capabilities["agent.tool"]?.keys).toEqual({ read: "tool-read" });
});

test("it provides pi-durable's read tool under its own name, unchanged but for its replay, safe", async () => {
  let tool: AgentTool | undefined;
  const reader = defineComponent({
    name: "tool-reader",
    setup(pikit) {
      const tools = pikit.useKeyed("agent.tool");
      return { start: () => void (tool = tools.get("read")) };
    },
  });
  const app = await defineApp({ components: [execution, toolUnderTest, reader], logger: silentLogger }).create();
  await app.start();

  const pis = createReadTool();
  expect([tool?.name, tool?.replay]).toEqual(["read", "safe"]);
  expect([tool?.description, tool?.parameters]).toEqual([pis.description, pis.parameters]);
  await app.stop();
});

test("it cannot be installed without an execution", async () => {
  await expect(defineApp({ components: [toolUnderTest], logger: silentLogger }).create()).rejects.toThrow("execution");
});
