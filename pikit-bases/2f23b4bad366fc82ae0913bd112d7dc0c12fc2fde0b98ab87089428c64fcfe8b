/**
 * execution-do's tests. They are copied with the component and keep running in your project, under
 * `bun test`, over a double of a Durable Object's storage (`durable-object.test-support.ts`) and a fake
 * GitHub (`git-server.test-support.ts`): no network. pikit runs the same component in workerd on a real
 * Durable Object, with Pi's own tools on it (`tests/workerd`).
 */

import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, silentLogger, withContextValue } from "@pikit/core";
import { WORKERS_HOST, type WorkersHost } from "@pikit/contracts";
import { createLifecycleConformance } from "@pikit/core/testing";
import { withWorkersHost } from "@pikit/contracts/testing";
import type { ExecutionEnv } from "@pikit/pi-adapter";
import { createExecutionConformance } from "@pikit/pi-adapter/testing";
import { fakeDurableObjectStorage, fakeObjectHost } from "./durable-object.test-support.ts";
import { createFiles, type DurableObjectFilesStorage } from "./files.ts";
import { branchAllowed, githubRepository } from "./git.ts";
import { createFakeGitHub, type FakeGitHub } from "./git-server.test-support.ts";
import executionDo from "./index.ts";

const ctx = BACKGROUND_CONTEXT;
const TOKEN = "ghp_test-token-never-shown";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A started app with this component over `storage`, a `secrets` holding `secrets`, and its environments. */
async function started(options: { storage?: DurableObjectFilesStorage; config?: Record<string, unknown>; secrets?: Record<string, string> } = {}) {
  const storage = options.storage ?? fakeDurableObjectStorage();
  let found: { files: ExecutionEnv; shell: ExecutionEnv } | undefined;
  const reader = defineComponent({
    name: "execution-reader",
    setup(pikit) {
      const files = pikit.use("execution");
      const shell = pikit.use("execution.shell");
      return { start: () => void (found = { files: files.get(), shell: shell.get() }) };
    },
  });
  const secrets = defineComponent({
    name: "secrets-test",
    setup: (pikit) => pikit.provide("secrets", { get: async (name: string) => options.secrets?.[name] }),
  });
  const app = await defineApp({
    components: [...(options.secrets === undefined ? [] : [secrets]), executionDo, reader],
    config: { "execution-do": options.config ?? {} },
    logger: silentLogger,
  }).create();
  await app.start(withContextValue(WORKERS_HOST, fakeObjectHost(storage), ctx));
  if (found === undefined) throw new Error("execution was not resolved");
  return { app, storage, env: found.shell, files: found.files };
}

/** Runs `command` as Pi's `bash` tool does, and returns its exit code and combined output. */
async function run(env: ExecutionEnv, command: string, cwd?: string) {
  let output = "";
  const result = await env.exec(
    command,
    { ...(cwd !== undefined && { cwd }), capture: { limits: { maxBytes: 1 << 20, maxLines: 10_000 } }, onUpdate: (update) => void (update.kind === "replace" && (output = update.output.text)) },
    ctx,
  );
  if (!result.ok) throw new Error(`exec failed: ${result.error.code} ${result.error.message}`);
  return { exitCode: result.value.exitCode, output };
}

// Pi's ExecutionEnv contract, with a shell.
for (const c of createExecutionConformance(async () => {
  const { app, env } = await started();
  return { env, shell: true, dispose: () => app.stop() };
})) {
  test(`execution-do ${c.group}: ${c.name}`, () => c.run());
}

// Start and stop honour their deadline, and a fresh app over the same object starts again.
const [hosted = executionDo] = withWorkersHost(fakeObjectHost(), [executionDo]);
for (const c of createLifecycleConformance(() => ({ component: hosted }))) {
  test(`execution-do ${c.group}: ${c.name}`, () => c.run());
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [executionDo], logger: silentLogger }).create();
  expect(app.describe().components).toEqual([{ name: "execution-do", provides: ["execution", "execution.shell"], requires: [], optional: ["secrets"] }]);
});

/** The reason `app.start` fails with, when the host in its context is `host`. */
async function startFailure(host: WorkersHost | undefined): Promise<string> {
  const app = await defineApp({ components: [executionDo], logger: silentLogger }).create();
  const error = await app.start(host === undefined ? ctx : withContextValue(WORKERS_HOST, host, ctx)).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof Error) || !(error.cause instanceof Error)) throw new Error("expected start() to fail with a cause");
  return error.cause.message;
}

test("it refuses to start off Cloudflare, in the Worker's App, or on an object without SQLite", async () => {
  expect(await startFailure(undefined)).toContain("execution-do: no WORKERS_HOST in the start context");
  expect(await startFailure({ env: {} })).toContain("WORKERS_HOST has no object");
  const withoutSql = {
    get sql(): never {
      throw new Error("SQL is not enabled for this Durable Object class.");
    },
    transactionSync: () => {},
  };
  expect(await startFailure(fakeObjectHost(withoutSql))).toContain("new_sqlite_classes");
});

test("one environment serves both capabilities, in root, and refuses calls once the app stopped", async () => {
  const { app, env, files } = await started({ config: { root: "/home/agent" } });
  expect(env.cwd).toBe("/home/agent");
  expect(await run(files, "pwd")).toEqual({ exitCode: 0, output: "/home/agent\n" });
  await app.stop();
  const refused = await env.readTextFile("a.txt", ctx);
  expect(refused.ok ? "read" : refused.error.message).toContain("while the app is not running");
});

test("files are rows of the object's SQL, in chunks, and outlive the app", async () => {
  const first = await started();
  // 2.5 MB of bytes, handed over as a view on a larger buffer, as isomorphic-git's Buffers are.
  const memory = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < memory.length; i++) memory[i] = i % 251;
  const bytes = memory.subarray(1_000, 1_000 + 2.5 * 1024 * 1024);
  expect((await first.env.writeFile("big.bin", bytes, ctx)).ok).toBe(true);
  await first.env.writeFile("notes/a.txt", "remembered\n", ctx);
  await first.app.stop();

  const second = await started({ storage: first.storage });
  const read = await second.env.readBinaryFile("big.bin", ctx);
  expect(read.ok && read.value.length === bytes.length && read.value.every((byte, i) => byte === bytes[i])).toBe(true);
  expect(await run(second.env, "cat notes/a.txt")).toEqual({ exitCode: 0, output: "remembered\n" });
  const tables = first.storage.sql.exec("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").toArray();
  expect(tables.map((table) => table.name)).toEqual(["execution_do_chunks", "execution_do_nodes"]);
  expect(first.storage.sql.exec("SELECT seq FROM execution_do_chunks WHERE path = '/work/big.bin' ORDER BY seq").toArray()).toEqual([{ seq: 0 }, { seq: 1 }, { seq: 2 }]);
  await second.app.stop();
});

test("the shell: pipes, loops, redirections, functions, grep, find, awk, sed and jq", async () => {
  const { app, env } = await started();
  const script = [
    "mkdir -p src/lib && for n in 1 2 3; do echo \"export const v$n = $n;\" > src/lib/v$n.ts; done",
    "count() { find src -name '*.ts' | wc -l; }",
    "echo files: $(count)",
    "grep -rl 'v2' src | sed 's#src/##'",
    "cat src/lib/*.ts | awk '{ sum += $5 } END { print \"sum:\", sum }'",
    "echo '{\"tools\":[{\"name\":\"bash\"},{\"name\":\"read\"}]}' > tools.json && jq -r '.tools[].name' tools.json | sort -r | tr '\\n' ' '",
    "echo; ls nothere 2>/dev/null || echo 'missing, as expected'",
  ].join("\n");

  expect(await run(env, script)).toEqual({ exitCode: 0, output: "files: 3\nlib/v2.ts\nsum: 6\nread bash \nmissing, as expected\n" });
  await app.stop();
});

test("node runs JavaScript in QuickJS with fs over the workspace; the budget stops a loop, the heap limit an allocation", async () => {
  const { app, env } = await started({ config: { node: { interruptBudget: 200, heapMegabytes: 4 } } });
  await env.writeFile("data.json", '{"items":[1,2,3]}', ctx);
  const script = `node -e 'const fs = require("node:fs"); const { items } = JSON.parse(fs.readFileSync("data.json")); fs.writeFileSync("out/sum.txt", String(items.reduce((a, b) => a + b))); console.log(process.cwd(), fs.readdirSync("."))'`;

  expect(await run(env, `${script} && cat out/sum.txt`)).toEqual({ exitCode: 0, output: '/work [\n  "data.json",\n  "out"\n]\n6' });
  expect(await run(env, "echo 'console.log(6 * 7)' | node && node -p '[1, 2].length'")).toEqual({ exitCode: 0, output: "42\n2\n" });
  const loop = await run(env, "node -e 'while (true) {}'");
  expect(loop.exitCode).toBe(1);
  expect(loop.output).toContain("its whole CPU budget");
  expect(await run(env, "node -e 'new Array(5e6).fill(0)'")).toEqual({ exitCode: 1, output: expect.stringContaining("out of memory") });
  expect((await run(env, `node -e 'require("node:fs").writeFileSync(".git/config", "x")'`)).output).toContain("EPERM");
  await app.stop();
});

test("curl uses the Worker's fetch", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => Response.json({ asked: String(input) })) as typeof fetch;
  const { app, env } = await started();
  expect(await run(env, "curl -s https://example.test/api | jq -r .asked")).toEqual({ exitCode: 0, output: "https://example.test/api\n" });
  await app.stop();
});

test("files inside .git change only through git: the file tools and the shell are refused", async () => {
  const { app, env, storage } = await started();
  const files = createFiles(() => storage);
  files.mkdirp("/work/repo/.git");
  files.write("/work/repo/.git/config", new TextEncoder().encode("[core]\n"));

  for (const result of [
    await env.writeFile("repo/.git/config", "changed", ctx),
    await env.appendFile("repo/.git/hooks/pre-commit", "x", ctx),
    await env.remove("repo/.git/config", undefined, ctx),
    await env.renameFile("repo/.git/config", "stolen", ctx),
    await env.createDir("repo/.git/refs", undefined, ctx),
  ]) {
    expect(result.ok ? "ok" : result.error.code).toBe("permission_denied");
  }
  expect((await env.readTextFile("repo/.git/config", ctx)).ok).toBe(true);
  expect((await run(env, "echo x > repo/.git/config")).exitCode).toBe(1);
  expect((await run(env, "touch repo/.git/new")).exitCode).toBe(1);
  expect((await run(env, "mv repo/.git/config elsewhere")).exitCode).toBe(1);
  // Nor through a symlink pointing into it.
  expect((await run(env, "ln -s repo/.git/config link && echo x > link")).exitCode).toBe(1);
  expect(await run(env, "cat repo/.git/config")).toEqual({ exitCode: 0, output: "[core]\n" });
  // A whole repository may go.
  expect((await run(env, "rm -r repo && ls")).output).toBe("link\n");
  await app.stop();
});

test("GitHub URLs and pushed branches are checked", () => {
  expect(githubRepository("https://github.com/acme/app.git")).toEqual({ owner: "acme", name: "app" });
  expect(githubRepository("git@github.com:acme/app.git")).toBeUndefined();
  expect(githubRepository("https://gitlab.com/acme/app")).toBeUndefined();
  expect(branchAllowed("pikit/self/better-readme", "pikit/self/")).toBe(true);
  for (const branch of ["main", "pikit/self/", "pikit/self/../main", "pikit/self/x.lock", "pikit/selfish", "pikit/self/-x"]) {
    expect(branchAllowed(branch, "pikit/self/")).toBe(false);
  }
});

/** A fake GitHub with `acme/app` (public) and `acme/secret` (private), in place of the global fetch. */
async function fakeGitHub(): Promise<FakeGitHub> {
  const github = await createFakeGitHub(
    fakeDurableObjectStorage(),
    { "acme/app": { files: { "README.md": "hello\n", "src/a.ts": "export const a = 1;\n" } }, "acme/secret": { files: { "README.md": "secret\n" }, private: true } },
    TOKEN,
  );
  globalThis.fetch = github.fetch as typeof fetch;
  return github;
}

test("git: clone, status, diff, commit, log, push and a pull request, with the token only on GitHub's requests", async () => {
  const github = await fakeGitHub();
  const { app, env } = await started({ secrets: { GITHUB_TOKEN: TOKEN }, config: { git: { pushRepositories: ["acme/app"] } } });

  const clone = await run(env, "git clone https://github.com/acme/app");
  expect(clone.output).toContain("you may push branches pikit/self/");
  // Shallow: only the latest commit came.
  expect((await run(env, "git log", "app")).output).toBe(`${(await github.head("acme/app")).slice(0, 7)} second commit (fake github)\n`);
  await env.appendFile("app/README.md", "more\n", ctx);
  await env.writeFile("app/src/b.ts", "export const b = 2;\n", ctx);
  expect((await run(env, "git status", "app/src")).output).toBe("On branch main\n M README.md\n?? src/b.ts\n");
  expect((await run(env, "git diff README.md", "app")).output).toContain("+more\n");
  expect((await run(env, "git add . && git commit -m 'Explain more'", "app")).output).toMatch(/^\[main [0-9a-f]{7}\] Explain more\n 2 file\(s\) changed: README.md, src\/b.ts\n$/);
  expect((await run(env, "git status", "app")).output).toBe("On branch main\nnothing to commit, working tree clean\n");

  const push = await run(env, "git push origin pikit/self/explain-more && git pr pikit/self/explain-more 'Explain more' -b 'Why: clarity'", "app");
  expect(push.exitCode).toBe(0);
  expect(push.output).toContain("Pull request opened: https://github.com/acme/app/pull/1");
  const [committed] = (await run(env, "git log -n 1", "app")).output.split(" ");
  expect(github.pushes.map((pushed) => [pushed.repository, pushed.ref, pushed.oid.slice(0, 7)])).toEqual([["acme/app", "refs/heads/pikit/self/explain-more", committed ?? ""]]);
  expect(github.pushes[0]?.packBytes).toBeGreaterThan(100);
  expect(github.pulls).toEqual([{ repository: "acme/app", head: "pikit/self/explain-more", base: "main", title: "Explain more", body: "Why: clarity" }]);
  // The token went to GitHub, and never to the shell.
  expect(github.requests.every((request) => request.authorization !== null)).toBe(true);
  expect((await run(env, "env; set")).output).not.toContain(TOKEN);
  await app.stop();
});

test("git push and pr are fenced: the branch prefix, the allowed repositories, a token", async () => {
  const github = await fakeGitHub();
  const allowed = await started({ secrets: { GITHUB_TOKEN: TOKEN }, config: { git: { pushRepositories: ["acme/app"] } } });
  await run(allowed.env, "git clone https://github.com/acme/app && cd app && echo x >> README.md && git commit -m change");
  expect(await run(allowed.env, "git push origin main", "app")).toEqual({ exitCode: 1, output: expect.stringContaining("only to new branches pikit/self/<topic>") });
  expect((await run(allowed.env, "git push origin feature/x", "app")).exitCode).toBe(1);
  expect((await run(allowed.env, "git pr main 'title'", "app")).exitCode).toBe(1);

  const otherRepository = await started({ secrets: { GITHUB_TOKEN: TOKEN }, config: { git: { pushRepositories: ["acme/other"] } } });
  await run(otherRepository.env, "git clone https://github.com/acme/app && cd app && echo x >> README.md && git commit -m change");
  expect((await run(otherRepository.env, "git push origin pikit/self/x", "app")).output).toContain("pushing to acme/app is not allowed here");

  const noToken = await started({ config: { git: { pushRepositories: ["acme/app"] } } });
  expect((await run(noToken.env, "git clone https://github.com/acme/app")).output).toContain("read-only");
  expect((await run(noToken.env, "git push origin pikit/self/x", "app")).output).toContain("there is no GitHub token here");
  expect(github.pushes).toEqual([]);
  expect(github.pulls).toEqual([]);
  for (const started of [allowed, otherRepository, noToken]) await started.app.stop();
});

test("git clone: GitHub over HTTPS only, a private repository needs the token, and a failed clone leaves nothing", async () => {
  const github = await fakeGitHub();
  const { app, env } = await started();
  expect((await run(env, "git clone https://gitlab.com/acme/app")).exitCode).toBe(128);
  expect((await run(env, "git clone https://github.com/acme/secret")).exitCode).toBe(128);
  expect(await run(env, "ls")).toEqual({ exitCode: 0, output: "" });

  // The server answers the discovery, then fails the download: the half-made clone is removed.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).endsWith("/git-upload-pack") ? new Response("Not Found", { status: 404 }) : github.fetch(input, init)) as typeof fetch;
  expect((await run(env, "git clone https://github.com/acme/app")).exitCode).toBe(128);
  expect(await run(env, "ls")).toEqual({ exitCode: 0, output: "" });

  const withToken = await started({ secrets: { GITHUB_TOKEN: TOKEN } });
  globalThis.fetch = github.fetch as typeof fetch;
  expect((await run(withToken.env, "git clone https://github.com/acme/secret && cat secret/README.md")).output).toContain("secret\n(second commit)\n");
  expect((await run(withToken.env, "git clone https://github.com/acme/secret")).output).toContain("already exists");
  await app.stop();
  await withToken.app.stop();
});
