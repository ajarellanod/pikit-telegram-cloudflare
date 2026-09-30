/**
 * `pikit up | down | logs | status | dev` for Cloudflare (SPEC C8): plain functions the CLI
 * delegates to, each one `wrangler …` in the project's directory. They run on the machine that
 * deploys, never inside the app (the one file of this component that imports `node:*`).
 *
 * Every command goes through a `Runner`, so tests check the exact `wrangler` argv without wrangler or
 * a Cloudflare account. The real runner runs the project's own wrangler (`node_modules/.bin/wrangler`),
 * without a shell.
 *
 * The Worker is named after `package.json`'s `name`, passed as `--name` to every command, so two
 * projects on one account never deploy over each other; or `wrangler.jsonc`'s `name` when it has one
 * (a Deploy to Cloudflare template's, which Workers Builds deploys under), so both deploy one Worker.
 *
 * Before it bundles, `up` runs the installed components' `beforeDeploy` hooks (tool-mcp writes the seed
 * the bundle carries); after the deploy answers, their `afterDeploy` hooks (C8). Each one is named in
 * its `component.json`'s `hooks`, and `pikit add` records its file in `pikit.json`.
 *
 * `up`, `down`, `logs` and `status` reach the Cloudflare account, so each first checks that wrangler
 * can (`login`): a `CLOUDFLARE_API_TOKEN`, or wrangler's own login. At a terminal it offers
 * `wrangler login`; without one it says what to set.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export interface RunResult {
  code: number;
  /** Captured output; empty when the output went to the terminal. */
  stdout: string;
}

/**
 * Runs `command` in `cwd`, with `env` over the process's own. With `capture`, stdout is returned
 * (stderr still reaches the terminal); without it, the output streams to the terminal.
 */
export type Runner = (command: readonly string[], options: { cwd: string; capture: boolean; env?: Record<string, string> }) => Promise<RunResult>;

export interface CommandOptions {
  /** The project's directory, where `wrangler.jsonc` and `package.json` are. Default: the current directory. */
  cwd?: string;
  /** Default: spawns the project's wrangler. */
  run?: Runner;
}

/** What the commands that reach the account need to log in (`login`). */
export interface AccountOptions extends CommandOptions {
  /** A person is at a terminal: they can log in in a browser. Default: stdin and stdout are TTYs and `CI` is unset. */
  interactive?: boolean;
  /** Asks a yes-or-no question at the terminal. Default: a `[Y/n]` line on stdin. */
  confirm?: (question: string) => Promise<boolean>;
  /** Where `CLOUDFLARE_API_TOKEN` is looked for, before `.env`. Default: `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** What to do when wrangler cannot reach the account: both ways, with and without a terminal. */
export const LOGIN_HELP =
  "At a terminal, log in once: `bunx wrangler login` (it opens your browser). Without one (a server, CI): " +
  'create an API token from the "Edit Cloudflare Workers" template at https://dash.cloudflare.com/profile/api-tokens ' +
  "and export it as CLOUDFLARE_API_TOKEN, or put it in .env (it stays on this machine; with several accounts, CLOUDFLARE_ACCOUNT_ID too)";

/**
 * Makes sure wrangler can reach the Cloudflare account. A `CLOUDFLARE_API_TOKEN` (exported, or in
 * `.env`, which wrangler reads) is used as it is. Otherwise `wrangler whoami --json` says whether
 * wrangler's own login holds; if not, at a terminal it offers `wrangler login`, which opens the
 * browser, and checks again. Without a terminal it throws what to do (`LOGIN_HELP`).
 */
export async function login(options: AccountOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  if (apiToken(cwd, options.env ?? process.env) !== undefined) return;
  if (await loggedIn(options)) return;
  const interactive = options.interactive ?? isTerminal();
  if (!interactive) throw new Error(`wrangler is not logged in to Cloudflare. ${LOGIN_HELP}. Then run this again`);
  const ask = options.confirm ?? askAtTerminal;
  if (!(await ask("wrangler is not logged in to Cloudflare. Log in now? It opens your browser"))) {
    throw new Error(`not logged in to Cloudflare. ${LOGIN_HELP}. Then run this again`);
  }
  const done = await run(["wrangler", "login"], options, false);
  if (done.code !== 0 || !(await loggedIn(options))) {
    throw new Error(`\`wrangler login\` did not log in (exit code ${done.code}). ${LOGIN_HELP}. Then run this again`);
  }
}

/** `CLOUDFLARE_API_TOKEN`, exported or in `.env`: wrangler reads both. */
function apiToken(cwd: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  return env.CLOUDFLARE_API_TOKEN || readDotEnv(cwd).CLOUDFLARE_API_TOKEN || undefined;
}

/** `wrangler whoami --json`: it prints `{ "loggedIn": true, … }`, or exits non-zero with `{ "loggedIn": false }`. */
async function loggedIn(options: CommandOptions): Promise<boolean> {
  const result = await run(["wrangler", "whoami", "--json"], options, true);
  // `#!/usr/bin/env node` found no `node`: wrangler never started.
  if (result.code === 127) throw new Error("wrangler did not start: it runs on Node.js >= 22, which is not on the PATH. Install it (https://nodejs.org), then run this again");
  const text = result.stdout.trim();
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let answer: { loggedIn?: unknown } | undefined;
  try {
    answer = JSON.parse(json) as { loggedIn?: unknown };
  } catch {
    answer = undefined;
  }
  if (answer?.loggedIn === true && result.code === 0) return true;
  if (answer?.loggedIn === false) return false;
  throw new Error(`could not check the Cloudflare login: \`wrangler whoami --json\` exited with code ${result.code}. Is this machine online?`);
}

function isTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && (process.env.CI ?? "") === "";
}

/** A `[Y/n]` question on the terminal: Enter is yes. */
async function askAtTerminal(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await terminal.question(`${question} [Y/n] `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    terminal.close();
  }
}

/** What `up` deployed, and where it answers. */
export interface Deployed {
  /** The Worker version wrangler uploaded, as `/health` reports it. */
  version: string;
  /** Where `/health` was asked: the `workers.dev` URL wrangler reported, or `url`. */
  url: string;
}

export interface UpOptions extends AccountOptions {
  /** Where the Worker answers. Default: the `https://…workers.dev` URL wrangler reports. */
  url?: string | URL;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** How long to wait for the new version to answer `/health`. Default: 180 000 ms. */
  waitMs?: number;
  /** Between two probes. Default: 2000 ms. */
  intervalMs?: number;
  /** Roll back (`wrangler rollback`) when the new version answers that its App does not start. Default: true. */
  rollback?: boolean;
  /** Where the components' deploy hooks' lines go. Default: `console.log`. */
  say?: (line: string) => void;
}

/**
 * What a component's `afterDeploy` receives (`component.json`'s `hooks.afterDeploy` names its file).
 * It resolves with its problems, one line each: empty when done.
 */
export interface AfterDeployIO {
  /** The deployed Worker's public base URL, once it answers with the new version. */
  url: string;
  /** The component's config in `pikit.config.ts` (its default export's), with its defaults. */
  config: Readonly<Record<string, unknown>>;
  /** A variable exported in the environment, or else in `.env`: the secrets the deploy uploaded. */
  get(name: string): string | undefined;
  say(line: string): void;
}

/**
 * Deploys the project, with `.env`'s secrets, and resolves once `/health` answers ok from the version
 * it deployed (C8): a new version takes seconds to reach every request, and whatever registers
 * against the Worker next (a Telegram webhook) must reach this one.
 *
 * Secrets go with the version (`wrangler deploy --secrets-file`), not before it (`wrangler secret`):
 * the version `/health` checks is the code and its secrets together, and no request ever sees new
 * secrets with old code. Wrangler adds them to the ones already set and deletes none. Variables named
 * `CLOUDFLARE_*` stay on this machine: they are wrangler's own credentials, never the Worker's.
 *
 * If the new version answers that its App does not start, it is rolled back to the previous one and
 * `up` rejects. If it never answers, `up` rejects and leaves it: whether to roll back is yours.
 */
export async function up(options: UpOptions = {}): Promise<Deployed> {
  const cwd = options.cwd ?? process.cwd();
  const name = workerName(cwd);
  await login(options);
  await beforeDeploy(cwd, options.say ?? ((line) => console.log(line)));
  // Private to this user (mkdtemp is 0700): the secrets file and wrangler's output file.
  const work = mkdtempSync(join(tmpdir(), "pikit-cloudflare-"));
  try {
    const output = join(work, "wrangler-output.jsonl");
    const args = ["deploy", "--name", name];
    const secrets = deploySecrets(cwd);
    if (Object.keys(secrets).length > 0) {
      const file = join(work, "secrets.json");
      writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
      args.push("--secrets-file", file);
    }
    const deploy = await run(["wrangler", ...args], options, false, { WRANGLER_OUTPUT_FILE_PATH: output });
    if (deploy.code !== 0) throw new Error(deployFailure(output, name, deploy.code));
    const deployed = readDeployOutput(output, options.url);
    writeFileSync(recordPath(cwd, true), `${JSON.stringify(deployed, null, 2)}\n`);

    const outcome = await waitForVersion(deployed, options);
    if (outcome.kind === "ok") {
      await afterDeploy(cwd, deployed, options.say ?? ((line) => console.log(line)));
      return deployed;
    }
    if (outcome.kind === "failing" && options.rollback !== false) {
      const rolledBack = await run(["wrangler", "rollback", "--name", name, "--message", `pikit up: ${deployed.version} failed /health`, "--yes"], options, false);
      throw new Error(
        `the new version ${deployed.version} answers ${deployed.url}/health that its App does not start (${outcome.detail}); ` +
          (rolledBack.code === 0 ? "it was rolled back to the previous version" : "rolling it back failed: run `wrangler rollback`") +
          ". Its logs say why: `pikit logs`, or Workers Logs in the dashboard",
      );
    }
    throw new Error(
      outcome.kind === "failing"
        ? `the new version ${deployed.version} answers ${deployed.url}/health that its App does not start (${outcome.detail}); it is still deployed`
        : `the new version ${deployed.version} did not answer ${deployed.url}/health within ${Math.round((options.waitMs ?? 180_000) / 1000)} s (last: ${outcome.detail}); it is deployed: check \`pikit status\`, and \`wrangler rollback --name ${name}\` if it is broken`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A component's deploy hook, as `pikit.json` records it: its project-relative file. */
export interface DeployHook {
  component: string;
  file: string;
}

/** The installed components' `hook` hooks (default: `afterDeploy`), in `pikit.json`'s order; none without `pikit.json`. */
export function deployHooks(cwd: string, hook: "beforeDeploy" | "afterDeploy" = "afterDeploy"): DeployHook[] {
  const path = join(cwd, "pikit.json");
  if (!existsSync(path)) return [];
  const { components } = JSON.parse(readFileSync(path, "utf8")) as { components?: Record<string, { hooks?: Record<string, unknown> }> };
  return Object.entries(components ?? {}).flatMap(([component, installed]) => {
    const file = installed.hooks?.[hook];
    return typeof file === "string" ? [{ component, file }] : [];
  });
}

/**
 * What a component's `beforeDeploy` receives (`component.json`'s `hooks.beforeDeploy` names its file).
 * It resolves with its problems, one line each: empty when done.
 */
export interface BeforeDeployIO {
  /** The component's config in `pikit.config.ts` (its default export's). */
  config: Readonly<Record<string, unknown>>;
  /** A variable exported in the environment, or else in `.env`. */
  get(name: string): string | undefined;
  /**
   * Writes `text` to `file`, a file name of the component's own `src/pikit/<name>/`, unless it already
   * holds it; resolves whether it changed. What it writes is what the bundle takes.
   */
  write(file: string, text: string): boolean;
  say(line: string): void;
}

/**
 * Runs every installed component's `beforeDeploy` before anything is bundled or uploaded (tool-mcp
 * writes the seed the bundle carries). Every hook runs, then `up` fails with all their problems, and
 * nothing is deployed.
 */
async function beforeDeploy(cwd: string, say: (line: string) => void): Promise<void> {
  const hooks = deployHooks(cwd, "beforeDeploy");
  if (hooks.length === 0) return;
  const config = await projectConfig(cwd);
  const env = readDotEnv(cwd);
  const get = (name: string): string | undefined => process.env[name] || env[name] || undefined;
  const problems: string[] = [];
  for (const hook of hooks) {
    try {
      const module = (await import(pathToFileURL(join(cwd, hook.file)).href)) as { beforeDeploy?: unknown };
      if (typeof module.beforeDeploy !== "function") {
        problems.push(`${hook.component}: ${hook.file} does not export beforeDeploy`);
        continue;
      }
      const own = config[hook.component];
      const io: BeforeDeployIO = {
        config: typeof own === "object" && own !== null ? (own as Record<string, unknown>) : {},
        get,
        write: (file, text) => writeOwnFile(cwd, hook.component, file, text),
        say,
      };
      const found = (await (module.beforeDeploy as (io: BeforeDeployIO) => Promise<unknown>)(io)) ?? [];
      if (!Array.isArray(found)) throw new Error("beforeDeploy did not resolve with a list of problems");
      for (const problem of found) problems.push(`${hook.component}: ${String(problem)}`);
    } catch (error) {
      problems.push(`${hook.component}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`what runs before a deploy failed, so nothing was deployed:\n  ${problems.join("\n  ")}\nFix it, then \`pikit up\` again`);
  }
}

/** `beforeDeploy`'s `write`: only a file of the component's own directory, and only when its text changes. */
function writeOwnFile(cwd: string, component: string, file: string, text: string): boolean {
  if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(file)) throw new Error(`beforeDeploy may write only a file of src/pikit/${component}/, not "${file}"`);
  const path = join(cwd, "src", "pikit", component, file);
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text);
  return true;
}

/**
 * Runs every installed component's `afterDeploy` once the new version answers (C8): a Telegram webhook
 * is registered against the version that will receive it. Each hook gets the URL, its component's
 * config and a reader of the secrets; what it says is printed. Every hook runs, then `up` fails with
 * all their problems (the version stays deployed: it answers, what failed is outside it).
 */
async function afterDeploy(cwd: string, deployed: Deployed, say: (line: string) => void): Promise<void> {
  const hooks = deployHooks(cwd);
  if (hooks.length === 0) return;
  const config = await projectConfig(cwd);
  const env = readDotEnv(cwd);
  const get = (name: string): string | undefined => process.env[name] || env[name] || undefined;
  const problems: string[] = [];
  for (const hook of hooks) {
    try {
      const module = (await import(pathToFileURL(join(cwd, hook.file)).href)) as { afterDeploy?: unknown };
      if (typeof module.afterDeploy !== "function") {
        problems.push(`${hook.component}: ${hook.file} does not export afterDeploy`);
        continue;
      }
      const own = config[hook.component];
      const io: AfterDeployIO = { url: deployed.url, config: typeof own === "object" && own !== null ? (own as Record<string, unknown>) : {}, get, say };
      const found = (await (module.afterDeploy as (io: AfterDeployIO) => Promise<unknown>)(io)) ?? [];
      if (!Array.isArray(found)) throw new Error("afterDeploy did not resolve with a list of problems");
      for (const problem of found) problems.push(`${hook.component}: ${String(problem)}`);
    } catch (error) {
      problems.push(`${hook.component}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `the new version ${deployed.version} answers at ${deployed.url}, but what runs after a deploy failed:\n  ${problems.join("\n  ")}\n` +
        "The version stays deployed. Fix it, then `pikit up` again",
    );
  }
}

/** The default App's config, as `pikit.config.ts` resolves it (its defaults applied). */
async function projectConfig(cwd: string): Promise<Readonly<Record<string, unknown>>> {
  const path = join(cwd, "pikit.config.ts");
  if (!existsSync(path)) return {};
  const app = ((await import(pathToFileURL(path).href)) as { default?: { config?: unknown } }).default;
  const config = app?.config;
  return typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
}

function readDotEnv(cwd: string): Record<string, string | undefined> {
  const path = join(cwd, ".env");
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

/**
 * Why `wrangler deploy` failed, from its output file's `command-failed` entry, with what to do when
 * pikit knows: a first deploy on an account that has no workers.dev subdomain yet (wrangler asks for
 * one at a terminal, and fails without one), or no login.
 */
export function deployFailure(outputPath: string, name: string, code: number): string {
  const failed = existsSync(outputPath)
    ? readFileSync(outputPath, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          try {
            return JSON.parse(line) as { type?: unknown; message?: unknown };
          } catch {
            return {};
          }
        })
        .filter((entry) => entry.type === "command-failed")
        .at(-1)
    : undefined;
  const message = typeof failed?.message === "string" ? failed.message : "";
  const plain = `\`wrangler deploy --name ${name}\` exited with code ${code}`;
  if (/workers\.dev subdomain/i.test(message)) {
    const link = /https:\/\/dash\.cloudflare\.com\/\S+/.exec(message)?.[0] ?? "https://dash.cloudflare.com/?to=/:account/workers/onboarding";
    return (
      `${plain}: your Cloudflare account has no workers.dev subdomain yet, where the Worker is published. ` +
      `Choose one, once per account (it is free): run \`pikit up\` at a terminal and answer wrangler's question, or register it at ${link}. Then \`pikit up\` again`
    );
  }
  if (/CLOUDFLARE_API_TOKEN|not logged in|Authentication error|\[code: 10000\]/i.test(message)) return `${plain}: ${message.split("\n")[0]}\n${LOGIN_HELP}`;
  return message === "" ? plain : `${plain}: ${message}`;
}

export interface DownOptions extends AccountOptions {
  /** A person is at a terminal to answer wrangler's question. Default: stdin is a TTY and `CI` is unset. */
  interactive?: boolean;
}

/**
 * Deletes the Worker (`wrangler delete`), and with it every conversation's Durable Object and its
 * data: Cloudflare cannot stop a Worker without deleting it. Only a person decides that: wrangler
 * asks at the terminal, and without one (a script, CI, where wrangler would answer yes by itself)
 * `down` refuses.
 */
export async function down(options: DownOptions = {}): Promise<void> {
  const interactive = options.interactive ?? (process.stdin.isTTY === true && (process.env.CI ?? "") === "");
  if (!interactive) {
    throw new Error(
      "`down` deletes the Worker and every conversation's Durable Object with it (Cloudflare cannot stop a Worker without deleting it). " +
        "It asks a person: run it at a terminal, outside CI",
    );
  }
  const name = workerName(options.cwd ?? process.cwd());
  await login(options);
  await wrangler(["delete", "--name", name], options);
}

export interface LogsOptions extends AccountOptions {
  /** Accepted for the CLI's sake: `wrangler tail` always follows. */
  follow?: boolean;
  /** Refused: Cloudflare keeps no lines to replay here (Workers Logs in the dashboard has them). */
  tail?: number;
}

/** The Worker's and its objects' logs, live, until Ctrl-C (`wrangler tail`). */
export async function logs(options: LogsOptions = {}): Promise<void> {
  if (options.tail !== undefined) {
    throw new Error("--tail: `wrangler tail` streams from now on and replays nothing; past logs are in the dashboard (Workers Logs)");
  }
  const name = workerName(options.cwd ?? process.cwd());
  await login(options);
  await wrangler(["tail", name], options);
}

/** One deployment: which versions serve, and how much of the traffic each one gets. */
export interface Deployment {
  id: string;
  created: string;
  message?: string;
  versions: { id: string; percentage: number }[];
}

/** A probe's HTTP status, `"unreachable"` when nothing answered, `"unknown"` without a URL. */
export type Probe = number | "unreachable" | "unknown";

export interface Status {
  /** Oldest first, the last one serving now (`wrangler deployments list`, at most 10). */
  deployments: Deployment[];
  /** Where `/health` was asked: `url`, or the one the last `up` from this machine deployed to. */
  url?: string;
  /** `GET /health`. */
  health: Probe;
  /** The version `/health` answered from, when it did. */
  version?: string | null;
}

export interface StatusOptions extends AccountOptions {
  url?: string | URL;
  fetch?: typeof fetch;
  /** Default: 30 000 ms: `/health` starts an object's App. */
  probeTimeoutMs?: number;
}

/** The Worker's deployments as Cloudflare lists them, and what `/health` answers. */
export async function status(options: StatusOptions = {}): Promise<Status> {
  const cwd = options.cwd ?? process.cwd();
  const name = workerName(cwd);
  await login(options);
  const listed = await wrangler(["deployments", "list", "--name", name, "--json"], options, {}, true);
  const deployments = parseDeployments(listed.stdout);
  const url = options.url?.toString() ?? readRecord(cwd)?.url;
  if (url === undefined) return { deployments, health: "unknown" };
  const seen = await probeHealth(url, options.fetch ?? fetch, options.probeTimeoutMs ?? 30_000);
  return { deployments, url, health: seen.status, ...(seen.version !== undefined && { version: seen.version }) };
}

/** `wrangler deployments list --json`: an array, oldest first. */
export function parseDeployments(output: string): Deployment[] {
  const text = output.trim();
  if (text === "") return [];
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) throw new Error("`wrangler deployments list --json` did not print an array");
  return raw.map((entry) => {
    const item = (entry ?? {}) as { id?: unknown; created_on?: unknown; annotations?: Record<string, unknown>; versions?: unknown };
    const message = item.annotations?.["workers/message"];
    const versions = Array.isArray(item.versions) ? (item.versions as { version_id?: unknown; percentage?: unknown }[]) : [];
    return {
      id: String(item.id ?? ""),
      created: String(item.created_on ?? ""),
      ...(typeof message === "string" && { message }),
      versions: versions.map((v) => ({ id: String(v.version_id ?? ""), percentage: Number(v.percentage ?? 0) })),
    };
  });
}

/**
 * `pikit dev`: the Worker and its objects locally in workerd (`wrangler dev`), reloading on change,
 * with `.env` as its secrets. Resolves with wrangler's exit code.
 */
export async function dev(options: CommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  return (await run(["wrangler", "dev", "--name", workerName(cwd)], options, false)).code;
}

/**
 * The Worker's name: `wrangler.jsonc`'s `name` when it has one (a Deploy to Cloudflare template's: Workers
 * Builds deploys under it, and the button's setup page may have changed it), else `package.json`'s
 * `name`, in the letters Cloudflare accepts (`my_bot.v2` → `my-bot-v2`).
 */
export function workerName(cwd: string): string {
  const named = wranglerName(cwd);
  if (named !== undefined) return named;
  const path = join(cwd, "package.json");
  if (!existsSync(path)) throw new Error(`${cwd} has no package.json: the Worker is named after its "name"`);
  const { name } = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown };
  if (typeof name !== "string" || name === "") throw new Error(`package.json has no "name": the Worker is named after it`);
  const worker = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  if (worker === "") throw new Error(`package.json's name "${name}" has no letter or digit to name a Worker with`);
  return worker;
}

/** The top-level `name` of the project's `wrangler.jsonc`, if it has one; undefined when it cannot be read. */
function wranglerName(cwd: string): string | undefined {
  const path = join(cwd, "wrangler.jsonc");
  if (!existsSync(path)) return undefined;
  try {
    const { name } = parseJsonc(readFileSync(path, "utf8")) as { name?: unknown };
    return typeof name === "string" && name !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** JSON with comments and trailing commas, as wrangler reads it. */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error("an unterminated /* comment");
      i = end + 1;
    } else if (c === "}" || c === "]") {
      out = `${out.replace(/,\s*$/, "")}${c}`;
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}

/** `.env`'s values for the Worker: set, and not wrangler's own `CLOUDFLARE_*` credentials. */
export function deploySecrets(cwd: string): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const [name, value] of Object.entries(readDotEnv(cwd))) {
    if (value === undefined || value === "" || name.startsWith("CLOUDFLARE_")) continue;
    secrets[name] = value;
  }
  return secrets;
}

/** The version and URL of `wrangler deploy`'s output file (`WRANGLER_OUTPUT_FILE_PATH`, one JSON object per line). */
export function readDeployOutput(path: string, url?: string | URL): Deployed {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "") : [];
  const entry = lines
    .map((line) => JSON.parse(line) as { type?: unknown; version_id?: unknown; targets?: unknown })
    .filter((item) => item.type === "deploy")
    .at(-1);
  if (typeof entry?.version_id !== "string") throw new Error("`wrangler deploy` succeeded but reported no version id");
  const targets = Array.isArray(entry.targets) ? entry.targets.filter((t): t is string => typeof t === "string") : [];
  const found = url?.toString() ?? targets.find((t) => t.startsWith("https://"));
  if (found === undefined) {
    throw new Error(`the Worker has no workers.dev URL to check /health on (targets: ${targets.join(", ") || "none"}): pass its URL`);
  }
  return { version: entry.version_id, url: found.replace(/\/+$/, "") };
}

type Outcome = { kind: "ok" } | { kind: "failing"; detail: string } | { kind: "timeout"; detail: string };

/** Probes `/health` until the deployed version answers it. */
async function waitForVersion(deployed: Deployed, options: UpOptions): Promise<Outcome> {
  const fetcher = options.fetch ?? fetch;
  const deadline = Date.now() + (options.waitMs ?? 180_000);
  let last = "no answer yet";
  for (;;) {
    const seen = await probeHealth(deployed.url, fetcher, 30_000);
    if (seen.version === deployed.version) {
      if (seen.ok) return { kind: "ok" };
      return { kind: "failing", detail: seen.error ?? `HTTP ${String(seen.status)}` };
    }
    last = seen.status === "unreachable" ? "unreachable" : `HTTP ${seen.status} from version ${seen.version ?? "unknown"}`;
    if (Date.now() >= deadline) return { kind: "timeout", detail: last };
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 2_000));
  }
}

async function probeHealth(
  url: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number | "unreachable"; ok?: boolean; version?: string | null; error?: string }> {
  let response: Response;
  try {
    response = await fetcher(new URL("/health", url), { signal: AbortSignal.timeout(timeoutMs), headers: { "cache-control": "no-cache" } });
  } catch {
    return { status: "unreachable" };
  }
  const body = (await response.json().catch(() => undefined)) as { ok?: unknown; version?: unknown; error?: unknown } | undefined;
  return {
    status: response.status,
    ok: body?.ok === true,
    ...(body !== undefined && { version: typeof body.version === "string" ? body.version : null }),
    ...(typeof body?.error === "string" && { error: body.error }),
  };
}

/** Where `up` notes what it deployed, for `status`: `.pikit/`, this machine's state, never committed. */
function recordPath(cwd: string, create = false): string {
  const path = join(cwd, ".pikit", "deployment-cloudflare.json");
  if (create) mkdirSync(dirname(path), { recursive: true });
  return path;
}

function readRecord(cwd: string): Deployed | undefined {
  const path = recordPath(cwd);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Deployed;
  } catch {
    return undefined;
  }
}

async function wrangler(args: string[], options: CommandOptions, env: Record<string, string> = {}, capture = false): Promise<RunResult> {
  const result = await run(["wrangler", ...args], options, capture, env);
  if (result.code !== 0) throw new Error(`\`wrangler ${args.join(" ")}\` exited with code ${result.code}`);
  return result;
}

function run(command: string[], options: CommandOptions, capture: boolean, env: Record<string, string> = {}): Promise<RunResult> {
  return (options.run ?? spawnRunner)(command, { cwd: options.cwd ?? process.cwd(), capture, ...(Object.keys(env).length > 0 && { env }) });
}

/**
 * The real runner: `wrangler` is the project's (`node_modules/.bin/wrangler`, here or in a parent
 * directory), run without a shell, so no argument is ever interpreted.
 */
export const spawnRunner: Runner = (command, { cwd, capture, env }) =>
  new Promise((resolve, reject) => {
    const [name = "", ...args] = command;
    const file = name === "wrangler" ? projectWrangler(cwd) : name;
    if (file === undefined) {
      reject(new Error("wrangler is not installed in this project: run `bun add --dev wrangler`, then try again"));
      return;
    }
    const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"] });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" ? new Error(`\`${file}\` was not found`) : error),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });

function projectWrangler(cwd: string): string | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", "wrangler");
    if (existsSync(bin)) return bin;
    if (dirname(dir) === dir) return undefined;
  }
}
