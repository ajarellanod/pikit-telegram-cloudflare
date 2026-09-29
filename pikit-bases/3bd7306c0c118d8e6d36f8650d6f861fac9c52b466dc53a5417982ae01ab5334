/**
 * tool-edit's tests. They are copied with the component and keep running in your project. The tool
 * works on a test environment over a temporary directory (`createLocalExecution`, the one behind
 * `execution-local`).
 */

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, silentLogger, withContextValue } from "@pikit/core";
import { type AgentTool, CONVERSATION } from "@pikit/contracts";
import { createLocalExecution } from "@pikit/pi-adapter/node";
import toolUnderTest from "./index.ts";

const directories: string[] = [];
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

/** What Pi passes to a tool call; a direct call has no run to identify. */
const invocation = {
  invocationId: "invocation-1",
  operationId: "operation-1",
  turnId: "turn-1",
  getMemo: async () => undefined,
  setMemo: async () => {},
};

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : [])).join("");
}

/** The context Pi gives a tool call in a run of the `support` agent: it names the run's conversation. */
const supportRun = withContextValue(CONVERSATION, { key: "test:1", agent: "support", sessionId: "session-1" }, BACKGROUND_CONTEXT);

/**
 * The tool as installed in a started app, over a temporary working directory. With `workspace`, a
 * test `workspace` is installed too: each agent works in `<dir>/agents/<agent>`.
 */
async function installed(options: { workspace?: boolean } = {}): Promise<{ tool: AgentTool; dir: string; stop(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "pikit-tool-edit-"));
  directories.push(dir);
  const env = createLocalExecution({ cwd: dir, env: { PATH: process.env.PATH ?? "" } });
  const execution = defineComponent({
    name: "execution-test",
    setup(pikit) {
      pikit.provide("execution", env);
      pikit.provide("execution.shell", env);
    },
  });
  const workspace = defineComponent({
    name: "workspace-test",
    setup: (pikit) =>
      pikit.provide("workspace", {
        resolve: async (conversation) => ({
          env: createLocalExecution({ cwd: join(dir, "agents", conversation.agent), env: { PATH: process.env.PATH ?? "" } }),
        }),
      }),
  });
  let tool: AgentTool | undefined;
  const reader = defineComponent({
    name: "tool-reader",
    setup(pikit) {
      const tools = pikit.useKeyed("agent.tool");
      return { start: () => void (tool = tools.get("edit")) };
    },
  });
  const app = await defineApp({ components: [execution, ...(options.workspace === true ? [workspace] : []), toolUnderTest, reader], logger: silentLogger }).create();
  await app.start();
  if (tool === undefined) throw new Error("agent.tool edit was not provided");
  return { tool, dir, stop: () => app.stop() };
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const env = createLocalExecution({ cwd: tmpdir(), env: {} });
  const execution = defineComponent({
    name: "execution-test",
    setup(pikit) {
      pikit.provide("execution", env);
      pikit.provide("execution.shell", env);
    },
  });
  const app = await defineApp({ components: [execution, toolUnderTest], logger: silentLogger }).create();

  expect(app.describe().components.find((component) => component.name === "tool-edit")).toMatchObject({
    provides: ["agent.tool"],
    requires: ["execution"],
    optional: ["workspace"],
  });
  expect(app.describe().capabilities["agent.tool"]?.keys).toEqual({ edit: "tool-edit" });
});

test("it provides Pi's edit tool under its own name, with replay never", async () => {
  const s = await installed();

  expect([s.tool.name, s.tool.replay]).toEqual(["edit", "never"]);
  await s.stop();
});

test("the agent replaces exact text in a file", async () => {
  const s = await installed();
  writeFileSync(join(s.dir, "config.txt"), "port = 3000\nhost = localhost\n");

  await s.tool.execute("call-1", { path: "config.txt", edits: [{ oldText: "port = 3000", newText: "port = 8080" }] }, () => {}, undefined, invocation, BACKGROUND_CONTEXT);

  expect(readFileSync(join(s.dir, "config.txt"), "utf8")).toBe("port = 8080\nhost = localhost\n");
  await s.stop();
});

test("with a workspace, a call in a run edits its agent's workspace only", async () => {
  const s = await installed({ workspace: true });
  mkdirSync(join(s.dir, "agents/support"), { recursive: true });
  writeFileSync(join(s.dir, "agents/support/config.txt"), "port = 3000\n");
  writeFileSync(join(s.dir, "config.txt"), "port = 3000\n");

  await s.tool.execute("call-1", { path: "config.txt", edits: [{ oldText: "port = 3000", newText: "port = 8080" }] }, () => {}, undefined, invocation, supportRun);

  expect(readFileSync(join(s.dir, "agents/support/config.txt"), "utf8")).toBe("port = 8080\n");
  expect(readFileSync(join(s.dir, "config.txt"), "utf8")).toBe("port = 3000\n");
  await s.stop();
});
