/**
 * execution-do's pi-durable environment (`env.ts`), under `bun test` over the double of a
 * Durable Object's storage: pi-durable's `ExecutionEnv` contract (`@pikit/pi-adapter/execution/testing`),
 * pi-durable's own `read`, `write`, `edit` and `bash` working on it in a Harness turn, the `.git` fence,
 * and the object as the files' namespace. pikit runs the same on a real object in workerd (`tests/workerd`).
 */

import { expect, test } from "bun:test";
import { atCwd, BACKGROUND_CONTEXT, getOrThrow, harnessEnv } from "@pikit/pi-adapter/execution";
import { createDurableExecutionConformance, runToolCalls } from "@pikit/pi-adapter/execution/testing";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@pikit/pi-adapter/tools";
import { objectExecution } from "./env.test-support.ts";
import { fakeDurableObjectStorage } from "./durable-object.test-support.ts";

const ctx = BACKGROUND_CONTEXT;

// Its files cannot be watched: pi-durable's watch cases are left out.
for (const c of createDurableExecutionConformance(() => ({ env: objectExecution(fakeDurableObjectStorage(), { id: "execution-do:test" }).env }), { expect, watch: false })) {
  test(`execution-do on pi-durable ${c.group}: ${c.name}`, () => c.run());
}

test("pi-durable's own write, edit, read and bash work on the object's files, in a Harness turn", async () => {
  const storage = fakeDurableObjectStorage();
  const { env } = objectExecution(storage, { id: "execution-do:test" });
  const results = await runToolCalls({
    tools: [createReadTool(), createWriteTool(), createEditTool(), createBashTool()],
    env: harnessEnv({ execution: () => env }),
    calls: [
      { name: "write", args: { path: "notes/plan.md", content: "# Plan\n\n- clone\n- change\n" } },
      { name: "edit", args: { path: "notes/plan.md", edits: [{ oldText: "- change", newText: "- change\n- push" }] } },
      { name: "read", args: { path: "notes/plan.md" } },
      { name: "bash", args: { command: "wc -l < notes/plan.md && grep -c '^-' notes/plan.md && pwd" } },
      { name: "bash", args: { command: "echo bad >&2; exit 4" } },
    ],
  });

  expect(results.map((r) => [r.name, r.isError])).toEqual([
    ["write", false],
    ["edit", false],
    ["read", false],
    ["bash", false],
    ["bash", true],
  ]);
  expect(results[0]?.text).toContain("Successfully wrote");
  expect(results[1]?.text).toContain("Successfully replaced");
  expect(results[2]?.text).toBe("# Plan\n\n- clone\n- change\n- push\n");
  expect(results[3]?.text).toBe("5\n3\n/work\n");
  expect(results[4]?.text).toContain("bad\n");
  expect(results[4]?.text).toContain("Command exited with code 4");
  // The files are the object's rows.
  expect(storage.sql.exec("SELECT kind FROM execution_do_nodes WHERE path = '/work/notes/plan.md'").toArray()).toEqual([{ kind: "file" }]);
});

test("a long output is spilled whole to /tmp in the object, and bash names the file", async () => {
  const { env } = objectExecution(fakeDurableObjectStorage(), { id: "execution-do:test" });
  const [result] = await runToolCalls({ tools: [createBashTool()], env: harnessEnv({ execution: () => env }), calls: [{ name: "bash", args: { command: "seq 1 3000" } }] });

  const spill = /Full output: (\/tmp\/pi-output-\S+\.log)/.exec(result?.text ?? "")?.[1];
  expect(result?.isError).toBe(false);
  expect(result?.text).toContain("\n3000\n");
  expect(spill).toBeDefined();
  const whole = getOrThrow(await env.readTextFile(spill as string, ctx));
  expect(whole.startsWith("1\n2\n3\n")).toBe(true);
  expect(whole.split("\n")).toHaveLength(3001);
});

test("only git changes files inside .git: the environment's writes there are permission_denied", async () => {
  const { env, files } = objectExecution(fakeDurableObjectStorage(), { id: "execution-do:test" });
  // As git leaves it: git writes through the files directly.
  files.mkdirp("/work/repo/.git");
  files.write("/work/repo/.git/HEAD", new TextEncoder().encode("ref: refs/heads/main\n"));

  for (const result of [
    await env.writeFile("repo/.git/HEAD", "ref: refs/heads/evil\n", ctx),
    await env.appendFile("repo/.git/config", "x", ctx),
    await env.truncateFile("repo/.git/HEAD", 0, ctx),
    await env.renameFile("repo/.git/HEAD", "stolen", ctx),
    await env.remove("repo/.git", { recursive: true }, ctx),
  ]) {
    expect(result.ok ? "ok" : result.error.code).toBe("permission_denied");
  }
  expect(getOrThrow(await env.readTextFile("repo/.git/HEAD", ctx))).toBe("ref: refs/heads/main\n");
});

test("each object is its own namespace; atCwd gives a conversation another directory over the same files", async () => {
  const one = objectExecution(fakeDurableObjectStorage(), { id: "execution-do:one" }).env;
  const other = objectExecution(fakeDurableObjectStorage(), { id: "execution-do:other" }).env;
  expect([one.id, other.id]).toEqual(["execution-do:one", "execution-do:other"]);

  getOrThrow(await one.createDir("project", undefined, ctx));
  const inProject = await atCwd(one, "project", ctx);
  getOrThrow(await inProject.writeFile("a.txt", "in project", ctx));
  let output = "";
  getOrThrow(await inProject.exec("pwd && cat a.txt", { onOutput: (text) => void (output += text) }, ctx));

  expect([inProject.cwd, inProject.id, one.cwd]).toEqual(["/work/project", "execution-do:one", "/work"]);
  expect(getOrThrow(await one.readTextFile("project/a.txt", ctx))).toBe("in project");
  expect(output).toBe("/work/project\nin project");
  expect(getOrThrow(await other.exists("project", ctx))).toBe(false);
});
