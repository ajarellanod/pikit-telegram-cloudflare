/**
 * tool-read's tests. They are copied with the component and keep running in your project. The tool
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
  const dir = mkdtempSync(join(tmpdir(), "pikit-tool-read-"));
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
      return { start: () => void (tool = tools.get("read")) };
    },
  });
  const app = await defineApp({ components: [execution, ...(options.workspace === true ? [workspace] : []), toolUnderTest, reader], logger: silentLogger }).create();
  await app.start();
  if (tool === undefined) throw new Error("agent.tool read was not provided");
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

  expect(app.describe().components.find((component) => component.name === "tool-read")).toMatchObject({
    provides: ["agent.tool"],
    requires: ["execution"],
    optional: ["workspace"],
  });
  expect(app.describe().capabilities["agent.tool"]?.keys).toEqual({ read: "tool-read" });
});

test("it provides Pi's read tool under its own name, with replay safe", async () => {
  const s = await installed();

  expect([s.tool.name, s.tool.replay]).toEqual(["read", "safe"]);
  await s.stop();
});

test("the agent reads a file in the working directory", async () => {
  const s = await installed();
  writeFileSync(join(s.dir, "notes.md"), "first\nsecond\nthird\n");

  const result = await s.tool.execute("call-1", { path: "notes.md", offset: 2, limit: 1 }, () => {}, undefined, invocation, BACKGROUND_CONTEXT);

  expect(textOf(result)).toContain("second");
  expect(textOf(result)).not.toContain("third");
  await s.stop();
});

test("with a workspace, a call in a run reads its agent's workspace, and a call outside one execution", async () => {
  const s = await installed({ workspace: true });
  mkdirSync(join(s.dir, "agents/support"), { recursive: true });
  writeFileSync(join(s.dir, "agents/support/notes.md"), "support's notes\n");
  writeFileSync(join(s.dir, "notes.md"), "shared notes\n");

  const inRun = await s.tool.execute("call-1", { path: "notes.md" }, () => {}, undefined, invocation, supportRun);
  const outside = await s.tool.execute("call-2", { path: "notes.md" }, () => {}, undefined, invocation, BACKGROUND_CONTEXT);

  expect(textOf(inRun)).toContain("support's notes");
  expect(textOf(outside)).toContain("shared notes");
  await s.stop();
});
