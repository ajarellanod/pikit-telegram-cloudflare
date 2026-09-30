/**
 * The commands with a fake wrangler runner and a fake `fetch`: the exact argv, the secrets file, the
 * wait for the deployed version (C8), the components' after-deploy hooks, the rollback, `status`'s
 * parsing, the Cloudflare login each command that reaches the account checks first, and what a
 * failed first deploy says. No wrangler, no account.
 */

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Runner, deployHooks, deploySecrets, down, dev, login, logs, parseDeployments, status, up, workerName } from "./commands.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function project(env?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pikit-cloudflare-commands-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my_bot.v2" }));
  if (env !== undefined) writeFileSync(join(dir, ".env"), env);
  return dir;
}

interface Call {
  command: readonly string[];
  capture: boolean;
  env?: Record<string, string>;
  /** The secrets file's content, read while wrangler "runs" (it is deleted after). */
  secrets?: Record<string, string>;
}

/**
 * A wrangler that succeeds, reports `version` for a deploy, and prints `stdout` when captured. It is
 * logged in unless `loggedIn` says otherwise; `wrangler login` logs it in when `loginWorks`. `calls` are
 * the commands under test; `all` has the login's (`whoami`, `login`) too, in order.
 */
function fakeWrangler(
  options: {
    version?: string;
    code?: (command: readonly string[]) => number;
    stdout?: string;
    loggedIn?: boolean;
    loginWorks?: boolean;
    whoami?: { code: number; stdout: string };
    deployFailure?: string;
  } = {},
) {
  const calls: Call[] = [];
  const all: string[] = [];
  let loggedIn = options.loggedIn ?? true;
  const run: Runner = async (command, { capture, env }) => {
    all.push(command.slice(1).join(" "));
    if (command[1] === "whoami") {
      expect(capture).toBe(true);
      return options.whoami ?? { code: loggedIn ? 0 : 1, stdout: loggedIn ? JSON.stringify({ loggedIn: true, email: "ada@example.com" }, null, 2) : '\n{"loggedIn":false}\n' };
    }
    if (command[1] === "login") {
      expect(capture).toBe(false);
      if (options.loginWorks !== false) loggedIn = true;
      return { code: options.loginWorks === false ? 1 : 0, stdout: "" };
    }
    const call: Call = { command, capture, ...(env !== undefined && { env }) };
    const secretsAt = command.indexOf("--secrets-file");
    if (secretsAt !== -1) call.secrets = JSON.parse(readFileSync(command[secretsAt + 1] as string, "utf8")) as Record<string, string>;
    calls.push(call);
    const output = env?.WRANGLER_OUTPUT_FILE_PATH;
    if (command[1] === "deploy" && output !== undefined && options.deployFailure !== undefined) {
      writeFileSync(output, `${JSON.stringify({ type: "wrangler-session" })}\n${JSON.stringify({ type: "command-failed", version: 1, message: options.deployFailure })}\n`);
      return { code: 1, stdout: "" };
    }
    if (command[1] === "deploy" && output !== undefined) {
      writeFileSync(output, `${JSON.stringify({ type: "wrangler-session" })}\n${JSON.stringify({ type: "deploy", version_id: options.version ?? "v2", targets: ["https://my-bot-v2.acme.workers.dev", "example.com/*"] })}\n`);
    }
    return { code: options.code?.(command) ?? 0, stdout: capture ? (options.stdout ?? "") : "" };
  };
  return { calls, all, run };
}

/** A `/health` that answers each body in turn, then the last one forever. */
function fakeHealth(...bodies: ({ ok: boolean; version: string | null; error?: string } | "down")[]) {
  const urls: string[] = [];
  const fetcher = (async (url: URL | string) => {
    urls.push(String(url));
    const body = bodies.length > 1 ? bodies.shift() : bodies[0];
    if (body === "down" || body === undefined) throw new TypeError("fetch failed");
    return Response.json(body, { status: body.ok ? 200 : 503 });
  }) as unknown as typeof fetch;
  return { urls, fetcher };
}

test("up deploys with .env's secrets but not wrangler's own, then waits until /health answers the new version", async () => {
  const cwd = project("ANTHROPIC_API_KEY=sk-1\nCLOUDFLARE_API_TOKEN=cf-token\nCLOUDFLARE_ACCOUNT_ID=acct\nEMPTY=\n# a comment\nPIKIT_HTTP_TOKEN=\"t o k\"\n");
  const wrangler = fakeWrangler({ version: "v2" });
  const health = fakeHealth({ ok: true, version: "v1" }, "down", { ok: true, version: "v2" });

  const deployed = await up({ cwd, run: wrangler.run, fetch: health.fetcher, intervalMs: 1 });

  expect(deployed).toEqual({ version: "v2", url: "https://my-bot-v2.acme.workers.dev" });
  const [deploy] = wrangler.calls;
  expect(deploy?.command.slice(0, 4)).toEqual(["wrangler", "deploy", "--name", "my-bot-v2"]);
  expect(deploy?.command[4]).toBe("--secrets-file");
  expect(deploy?.secrets).toEqual({ ANTHROPIC_API_KEY: "sk-1", PIKIT_HTTP_TOKEN: "t o k" });
  expect(deploy?.env?.WRANGLER_OUTPUT_FILE_PATH).toBeString();
  // The secrets file lives only while wrangler runs.
  expect(existsSync(deploy?.command[5] as string)).toBe(false);
  expect(wrangler.calls).toHaveLength(1);
  expect(health.urls).toEqual(Array(3).fill("https://my-bot-v2.acme.workers.dev/health"));
  // status finds the Worker from this record.
  expect(JSON.parse(readFileSync(join(cwd, ".pikit", "deployment-cloudflare.json"), "utf8"))).toEqual(deployed);
});

test("up passes no secrets file without a .env, and asks /health at the URL it is given", async () => {
  const cwd = project();
  const wrangler = fakeWrangler();
  const health = fakeHealth({ ok: true, version: "v2" });
  await up({ cwd, run: wrangler.run, fetch: health.fetcher, url: "https://bot.example.com/" });
  expect(wrangler.calls[0]?.command).toEqual(["wrangler", "deploy", "--name", "my-bot-v2"]);
  expect(health.urls).toEqual(["https://bot.example.com/health"]);
});

test("up rolls back a new version whose App does not start, and says so", async () => {
  const wrangler = fakeWrangler({ version: "v2" });
  const health = fakeHealth({ ok: false, version: "v2", error: "the object's App did not start" });
  const failure = up({ cwd: project(), run: wrangler.run, fetch: health.fetcher, intervalMs: 1 });
  await expect(failure).rejects.toThrow(/the new version v2 answers .* its App does not start \(the object's App did not start\); it was rolled back/);
  expect(wrangler.calls[1]?.command).toEqual(["wrangler", "rollback", "--name", "my-bot-v2", "--message", "pikit up: v2 failed /health", "--yes"]);
});

test("up without rollback leaves a failing version; one that never answers is left too, and named", async () => {
  const kept = fakeWrangler();
  await expect(
    up({ cwd: project(), run: kept.run, fetch: fakeHealth({ ok: false, version: "v2" }).fetcher, rollback: false }),
  ).rejects.toThrow(/it is still deployed/);
  expect(kept.calls).toHaveLength(1);

  const silent = fakeWrangler();
  await expect(
    up({ cwd: project(), run: silent.run, fetch: fakeHealth({ ok: true, version: "v1" }).fetcher, waitMs: 20, intervalMs: 5 }),
  ).rejects.toThrow(/did not answer .* within 0 s \(last: HTTP 200 from version v1\); it is deployed/);
  expect(silent.calls).toHaveLength(1);
});

test("up fails when wrangler deploy fails, before any probe", async () => {
  const wrangler = fakeWrangler({ code: () => 1 });
  const health = fakeHealth({ ok: true, version: "v2" });
  await expect(up({ cwd: project(), run: wrangler.run, fetch: health.fetcher })).rejects.toThrow(/`wrangler deploy --name my-bot-v2` exited with code 1/);
  expect(health.urls).toEqual([]);
});

/** What the fake hooks and `/health` did, in order: `globalThis`, since the hooks are files of their own. */
const events = ((globalThis as { deployEvents?: string[] }).deployEvents ??= []);

/**
 * A project with two components that have an after-deploy hook, as `pikit add` records them in
 * pikit.json, one without, and a pikit.config.ts whose default export has their config.
 */
function projectWithHooks(env: string): string {
  const cwd = project(env);
  const hook = (name: string) => `src/pikit/${name}/deploy.ts`;
  const components = { "channel-a": { hooks: { afterDeploy: hook("channel-a") } }, "storage-b": {}, "channel-c": { hooks: { afterDeploy: hook("channel-c") } } };
  writeFileSync(join(cwd, "pikit.json"), JSON.stringify({ version: 2, targets: ["cloudflare"], registries: {}, components }));
  writeFileSync(join(cwd, "pikit.config.ts"), `export default { config: { "channel-a": { greeting: "hello" } } };\n`);
  for (const name of ["channel-a", "channel-c"]) {
    mkdirSync(join(cwd, "src", "pikit", name), { recursive: true });
    writeFileSync(
      join(cwd, hook(name)),
      `export async function afterDeploy(io) {
  globalThis.deployEvents.push(\`${name} \${io.url} \${JSON.stringify(io.config)} \${io.get("HOOK_TEST_TOKEN")}\`);
  io.say("${name} registered");
  const problem = io.get("${name.toUpperCase().replace("-", "_")}_PROBLEM");
  if (problem === "throw") throw new Error("unreachable");
  return problem === undefined ? [] : [problem];
}
`,
    );
  }
  return cwd;
}

/** A `/health` as `fakeHealth`, noting each answer's version in `events`. */
function notedHealth(...bodies: { ok: boolean; version: string }[]) {
  const health = fakeHealth(...bodies);
  const fetcher = (async (url: URL | string) => {
    const response = await health.fetcher(url);
    events.push(`health ${((await response.clone().json()) as { version: string }).version}`);
    return response;
  }) as unknown as typeof fetch;
  return { ...health, fetcher };
}

test("up runs each component's afterDeploy once /health answers the new version: its URL, config and secrets, and what it says", async () => {
  events.length = 0;
  const cwd = projectWithHooks("HOOK_TEST_TOKEN=from-env-file\n");
  expect(deployHooks(cwd)).toEqual([
    { component: "channel-a", file: "src/pikit/channel-a/deploy.ts" },
    { component: "channel-c", file: "src/pikit/channel-c/deploy.ts" },
  ]);
  const said: string[] = [];
  const deployed = await up({ cwd, run: fakeWrangler().run, fetch: notedHealth({ ok: true, version: "v1" }, { ok: true, version: "v2" }).fetcher, intervalMs: 1, say: (line) => said.push(line) });

  expect(deployed).toEqual({ version: "v2", url: "https://my-bot-v2.acme.workers.dev" });
  // Never against the previous version (C8); each with its own config ({} without one).
  expect(events).toEqual([
    "health v1",
    "health v2",
    'channel-a https://my-bot-v2.acme.workers.dev {"greeting":"hello"} from-env-file',
    "channel-c https://my-bot-v2.acme.workers.dev {} from-env-file",
  ]);
  expect(said).toEqual(["channel-a registered", "channel-c registered"]);
});

test("up fails with every hook's problems, a hook that throws among them, and leaves the version deployed", async () => {
  events.length = 0;
  const cwd = projectWithHooks("HOOK_TEST_TOKEN=t\nCHANNEL_A_PROBLEM=throw\nCHANNEL_C_PROBLEM=its webhook was refused\n");
  const wrangler = fakeWrangler();
  const failure = up({ cwd, run: wrangler.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, say: () => {} });
  await expect(failure).rejects.toThrow(
    "the new version v2 answers at https://my-bot-v2.acme.workers.dev, but what runs after a deploy failed:\n  channel-a: unreachable\n  channel-c: its webhook was refused\n",
  );
  // Both ran; nothing was rolled back: the version answers, what failed is outside it.
  expect(events).toHaveLength(2);
  expect(wrangler.calls).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(cwd, ".pikit", "deployment-cloudflare.json"), "utf8"))).toMatchObject({ version: "v2" });
});

test("a new version that does not answer runs no hook", async () => {
  events.length = 0;
  const cwd = projectWithHooks("HOOK_TEST_TOKEN=t\n");
  await expect(up({ cwd, run: fakeWrangler().run, fetch: fakeHealth({ ok: false, version: "v2" }).fetcher, rollback: false })).rejects.toThrow(/still deployed/);
  await expect(up({ cwd, run: fakeWrangler().run, fetch: fakeHealth({ ok: true, version: "v1" }).fetcher, waitMs: 10, intervalMs: 5 })).rejects.toThrow(/did not answer/);
  expect(events).toEqual([]);
});

/**
 * A project whose `tool-a` has a before-deploy hook, as `pikit add` records it: it writes `seed.ts` in
 * its own directory with its config and a secret, says so, and reports `TOOL_A_PROBLEM` when set.
 */
function projectWithBeforeHook(env: string, body?: string): string {
  const cwd = project(env);
  const components = { "tool-a": { hooks: { beforeDeploy: "src/pikit/tool-a/deploy.ts" } }, "storage-b": {} };
  writeFileSync(join(cwd, "pikit.json"), JSON.stringify({ version: 2, targets: ["cloudflare"], registries: {}, components }));
  writeFileSync(join(cwd, "pikit.config.ts"), `export default { config: { "tool-a": { server: "wiki" } } };\n`);
  mkdirSync(join(cwd, "src", "pikit", "tool-a"), { recursive: true });
  writeFileSync(
    join(cwd, "src", "pikit", "tool-a", "deploy.ts"),
    body ??
      `export async function beforeDeploy(io) {
  const problem = io.get("TOOL_A_PROBLEM");
  if (problem !== undefined) return [problem];
  const changed = io.write("seed.ts", \`export const seed = \${JSON.stringify({ ...io.config, token: io.get("HOOK_TEST_TOKEN") })};\\n\`);
  io.say(changed ? "tool-a: seed written" : "tool-a: seed unchanged");
  return [];
}
`,
  );
  return cwd;
}

test("up runs each component's beforeDeploy before it deploys: it writes its own files, once, and says so", async () => {
  const cwd = projectWithBeforeHook("HOOK_TEST_TOKEN=t\n");
  expect(deployHooks(cwd, "beforeDeploy")).toEqual([{ component: "tool-a", file: "src/pikit/tool-a/deploy.ts" }]);
  expect(deployHooks(cwd)).toEqual([]);
  const said: string[] = [];
  let seedWhenDeployed = "";
  const wrangler = fakeWrangler();
  const run: Runner = async (command, options) => {
    if (command[1] === "deploy") seedWhenDeployed = readFileSync(join(cwd, "src", "pikit", "tool-a", "seed.ts"), "utf8");
    return wrangler.run(command, options);
  };
  await up({ cwd, run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, say: (line) => said.push(line) });
  expect(seedWhenDeployed).toBe('export const seed = {"server":"wiki","token":"t"};\n');
  await up({ cwd, run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, say: (line) => said.push(line) });
  expect(said).toEqual(["tool-a: seed written", "tool-a: seed unchanged"]);
});

test("a beforeDeploy problem, or a write outside the component's directory, stops up before anything is deployed", async () => {
  const wrangler = fakeWrangler();
  const failure = up({ cwd: projectWithBeforeHook("TOOL_A_PROBLEM=the MCP server is down\n"), run: wrangler.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, say: () => {} });
  await expect(failure).rejects.toThrow("what runs before a deploy failed, so nothing was deployed:\n  tool-a: the MCP server is down\n");
  expect(wrangler.calls).toEqual([]);

  const escape = projectWithBeforeHook("", 'export async function beforeDeploy(io) {\n  io.write("../../../wrangler.jsonc", "{}");\n  return [];\n}\n');
  await expect(up({ cwd: escape, run: wrangler.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, say: () => {} })).rejects.toThrow(
    'tool-a: beforeDeploy may write only a file of src/pikit/tool-a/, not "../../../wrangler.jsonc"',
  );
  expect(existsSync(join(escape, "wrangler.jsonc"))).toBe(false);
  expect(wrangler.calls).toEqual([]);
});

test("down deletes the Worker only when a person is there to answer wrangler", async () => {
  const wrangler = fakeWrangler();
  await expect(down({ cwd: project(), run: wrangler.run, interactive: false })).rejects.toThrow(/deletes the Worker and every conversation's Durable Object/);
  expect(wrangler.calls).toEqual([]);

  await down({ cwd: project(), run: wrangler.run, interactive: true });
  expect(wrangler.calls).toEqual([{ command: ["wrangler", "delete", "--name", "my-bot-v2"], capture: false }]);
});

test("logs streams wrangler tail, and refuses --tail", async () => {
  const wrangler = fakeWrangler();
  await logs({ cwd: project(), run: wrangler.run, follow: true });
  expect(wrangler.calls).toEqual([{ command: ["wrangler", "tail", "my-bot-v2"], capture: false }]);
  await expect(logs({ cwd: project(), run: wrangler.run, tail: 10 })).rejects.toThrow(/replays nothing/);
});

test("dev runs wrangler dev and resolves with its exit code", async () => {
  const wrangler = fakeWrangler({ code: () => 130 });
  expect(await dev({ cwd: project(), run: wrangler.run })).toBe(130);
  expect(wrangler.calls).toEqual([{ command: ["wrangler", "dev", "--name", "my-bot-v2"], capture: false }]);
});

const DEPLOYMENTS = JSON.stringify([
  { id: "d1", created_on: "2026-09-01T10:00:00Z", annotations: {}, versions: [{ version_id: "v1", percentage: 100 }] },
  { id: "d2", created_on: "2026-09-02T10:00:00Z", annotations: { "workers/message": "fix" }, versions: [{ version_id: "v2", percentage: 100 }] },
]);

test("status lists the deployments and probes /health where the last up deployed", async () => {
  const cwd = project();
  const wrangler = fakeWrangler({ stdout: DEPLOYMENTS });
  expect(await status({ cwd, run: wrangler.run })).toEqual({ deployments: parseDeployments(DEPLOYMENTS), health: "unknown" });
  expect(wrangler.calls[0]).toEqual({ command: ["wrangler", "deployments", "list", "--name", "my-bot-v2", "--json"], capture: true });

  await up({ cwd, run: wrangler.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher });
  const probed = await status({ cwd, run: wrangler.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher });
  expect(probed).toMatchObject({ url: "https://my-bot-v2.acme.workers.dev", health: 200, version: "v2" });
  expect(await status({ cwd, run: wrangler.run, fetch: fakeHealth("down").fetcher })).toMatchObject({ health: "unreachable" });
});

test("parseDeployments reads wrangler's JSON, oldest first", () => {
  expect(parseDeployments(DEPLOYMENTS)).toEqual([
    { id: "d1", created: "2026-09-01T10:00:00Z", versions: [{ id: "v1", percentage: 100 }] },
    { id: "d2", created: "2026-09-02T10:00:00Z", message: "fix", versions: [{ id: "v2", percentage: 100 }] },
  ]);
  expect(parseDeployments("")).toEqual([]);
});

test("the Worker is named after package.json's name, in the letters Cloudflare accepts", () => {
  expect(workerName(project())).toBe("my-bot-v2");
  const unnamed = project();
  writeFileSync(join(unnamed, "package.json"), "{}");
  expect(() => workerName(unnamed)).toThrow(/package.json has no "name"/);
});

test("wrangler.jsonc's own name, when it has one (a Deploy to Cloudflare template's), names the Worker instead", async () => {
  const cwd = project();
  const jsonc = (name: string) =>
    `{\n  "$schema": "node_modules/wrangler/config-schema.json", // a comment with "quotes" and a // in it\n  /* the setup page's name */\n  ${name}\n  "durable_objects": { "bindings": [{ "name": "CONVERSATION", "class_name": "Conversation" },] },\n  "vars": { "URL": "https://example.com/*/" },\n}\n`;
  writeFileSync(join(cwd, "wrangler.jsonc"), jsonc(`"name": "my-telegram-bot",`));
  expect(workerName(cwd)).toBe("my-telegram-bot");
  const wrangler = fakeWrangler();
  await dev({ cwd, run: wrangler.run });
  expect(wrangler.calls).toEqual([{ command: ["wrangler", "dev", "--name", "my-telegram-bot"], capture: false }]);
  // Without one (pikit's own file), or unreadable, it is package.json's, as before.
  writeFileSync(join(cwd, "wrangler.jsonc"), jsonc(""));
  expect(workerName(cwd)).toBe("my-bot-v2");
  writeFileSync(join(cwd, "wrangler.jsonc"), "{ /* never closed");
  expect(workerName(cwd)).toBe("my-bot-v2");
});

test("deploySecrets reads nothing without a .env", () => {
  expect(deploySecrets(project())).toEqual({});
});

/** `interactive: false` and a `confirm` that fails the test: nobody is asked. */
const NOBODY = { interactive: false, confirm: () => Promise.reject(new Error("asked")) };

test("up checks the login first: a CLOUDFLARE_API_TOKEN, exported or in .env, is used as it is; otherwise wrangler whoami", async () => {
  const exported = fakeWrangler({ loggedIn: false });
  await up({ cwd: project(), run: exported.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, env: { CLOUDFLARE_API_TOKEN: "cf-token" }, ...NOBODY });
  expect(exported.all).toEqual(["deploy --name my-bot-v2"]);

  const inDotEnv = fakeWrangler({ loggedIn: false });
  await up({ cwd: project("CLOUDFLARE_API_TOKEN=cf-token\n"), run: inDotEnv.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, env: {}, ...NOBODY });
  expect(inDotEnv.all).toEqual(["deploy --name my-bot-v2"]);

  const oauth = fakeWrangler();
  await up({ cwd: project(), run: oauth.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, env: {}, ...NOBODY });
  expect(oauth.all).toEqual(["whoami --json", "deploy --name my-bot-v2"]);
});

test("not logged in and no terminal: up, down, logs and status say how to log in, and reach nothing", async () => {
  const wrangler = fakeWrangler({ loggedIn: false });
  const options = { cwd: project(), run: wrangler.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, env: {}, ...NOBODY };
  for (const command of [() => up(options), () => logs(options), () => status(options)]) {
    const failure = command();
    await expect(failure).rejects.toThrow("wrangler is not logged in to Cloudflare. At a terminal, log in once: `bunx wrangler login` (it opens your browser).");
    await expect(failure).rejects.toThrow(/"Edit Cloudflare Workers" template at https:\/\/dash\.cloudflare\.com\/profile\/api-tokens and export it as CLOUDFLARE_API_TOKEN/);
  }
  // down asks a person first: it never gets to the login without one; with one, the login comes first.
  await expect(down(options)).rejects.toThrow(/It asks a person/);
  await expect(down({ ...options, interactive: true, confirm: async () => false })).rejects.toThrow(/not logged in to Cloudflare/);
  expect(wrangler.calls).toEqual([]);
  expect(wrangler.all.every((command) => command === "whoami --json")).toBe(true);
});

test("not logged in at a terminal: it offers wrangler login, runs it, checks again, then deploys", async () => {
  const wrangler = fakeWrangler({ loggedIn: false });
  const asked: string[] = [];
  const confirm = async (question: string) => (asked.push(question), true);
  await up({ cwd: project(), run: wrangler.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, env: {}, interactive: true, confirm });
  expect(asked).toEqual(["wrangler is not logged in to Cloudflare. Log in now? It opens your browser"]);
  expect(wrangler.all).toEqual(["whoami --json", "login", "whoami --json", "deploy --name my-bot-v2"]);
});

test("a declined login, or one that does not complete, fails before anything reaches the account", async () => {
  const declined = fakeWrangler({ loggedIn: false });
  await expect(login({ cwd: project(), run: declined.run, env: {}, interactive: true, confirm: async () => false })).rejects.toThrow(
    /^not logged in to Cloudflare\. At a terminal, log in once: `bunx wrangler login`/,
  );
  expect(declined.all).toEqual(["whoami --json"]);

  const failed = fakeWrangler({ loggedIn: false, loginWorks: false });
  const failure = up({ cwd: project(), run: failed.run, fetch: fakeHealth({ ok: true, version: "v2" }).fetcher, env: {}, interactive: true, confirm: async () => true });
  await expect(failure).rejects.toThrow(/^`wrangler login` did not log in \(exit code 1\)\. At a terminal/);
  expect(failed.calls).toEqual([]);
});

test("a wrangler that cannot say who is logged in: without Node.js, or offline, it is named", async () => {
  const options = { cwd: project(), env: {}, ...NOBODY };
  await expect(login({ ...options, run: fakeWrangler({ whoami: { code: 127, stdout: "" } }).run })).rejects.toThrow(
    "wrangler did not start: it runs on Node.js >= 22, which is not on the PATH",
  );
  await expect(login({ ...options, run: fakeWrangler({ whoami: { code: 1, stdout: "" } }).run })).rejects.toThrow(
    "could not check the Cloudflare login: `wrangler whoami --json` exited with code 1",
  );
});

test("a first deploy on an account without a workers.dev subdomain says how to choose one", async () => {
  // wrangler's own error, without a terminal to answer its question ("Would you like to register a workers.dev subdomain now?").
  const message =
    "You can either deploy your worker to one or more routes by specifying them in your wrangler.jsonc file, or register a workers.dev subdomain here:\nhttps://dash.cloudflare.com/0123abcd/workers/onboarding";
  const wrangler = fakeWrangler({ deployFailure: message });
  const health = fakeHealth({ ok: true, version: "v2" });
  const failure = up({ cwd: project(), run: wrangler.run, fetch: health.fetcher, env: {}, ...NOBODY });
  await expect(failure).rejects.toThrow(
    "`wrangler deploy --name my-bot-v2` exited with code 1: your Cloudflare account has no workers.dev subdomain yet, where the Worker is published. " +
      "Choose one, once per account (it is free): run `pikit up` at a terminal and answer wrangler's question, or register it at https://dash.cloudflare.com/0123abcd/workers/onboarding. Then `pikit up` again",
  );
  expect(health.urls).toEqual([]);

  // Any other failure keeps wrangler's own words.
  const other = fakeWrangler({ deployFailure: "Your Worker failed validation" });
  await expect(up({ cwd: project(), run: other.run, fetch: health.fetcher, env: {}, ...NOBODY })).rejects.toThrow(
    "`wrangler deploy --name my-bot-v2` exited with code 1: Your Worker failed validation",
  );
});
