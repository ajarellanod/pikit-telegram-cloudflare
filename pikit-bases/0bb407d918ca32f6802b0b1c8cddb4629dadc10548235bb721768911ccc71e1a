/**
 * What follows a `wrangler deploy`, the same for every way a project deploys on Cloudflare: `pikit up`
 * (`commands.ts`) and a build without pikit (`deploy.mjs`: Workers Builds, which deploys every merge).
 * Read what wrangler deployed, wait until `/health` answers from that version (C8), and roll a version
 * that fails back to the previous one, unless the deploy changed the Durable Object classes.
 *
 * Plain JavaScript with no dependency, so Node runs it in a build that has neither pikit nor
 * TypeScript; its types are in `rollout.d.mts`. Every command goes through a `wrangler(args, capture)`
 * the caller gives, and every probe through its `fetch`, so tests need no wrangler and no account.
 *
 * **Not reversible: a Durable Object migration.** Cloudflare refuses to roll back across a change of
 * Durable Object classes (a migration), and the change stays applied. So every deploy tags its version
 * with the last migration tag of its `wrangler.jsonc` (`wrangler deploy --tag migrations:v1`,
 * `migrationsMark`), and before a rollback the previous version's tag is read: a different one means
 * this deploy migrated, and nothing is rolled back (`kind: "migration"`). A previous version without
 * such a tag (deployed some other way) is rolled back to: if a migration lies between, Cloudflare
 * refuses, and that is reported too.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** JSON with comments and trailing commas, as wrangler reads it. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
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

/** What a version's tag starts with when it records its Durable Object migrations. */
const MARK = "migrations:";

/** A version's tag for `config` (a parsed `wrangler.jsonc`): `migrations:<its last tag>`, or `migrations:none`. */
export function migrationsMark(config) {
  const migrations = Array.isArray(config?.migrations) ? config.migrations : [];
  const tag = migrations.at(-1)?.tag;
  return `${MARK}${typeof tag === "string" && tag !== "" ? tag : "none"}`;
}

/** The tag of the project's `wrangler.jsonc` in `cwd`; undefined without one, or when it cannot be read (wrangler then fails). */
export function readMigrationsMark(cwd) {
  const path = join(cwd, "wrangler.jsonc");
  if (!existsSync(path)) return undefined;
  try {
    return migrationsMark(parseJsonc(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

/** The version and URL of `wrangler deploy`'s output file (`WRANGLER_OUTPUT_FILE_PATH`, one JSON object per line). */
export function readDeployOutput(path, url) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "") : [];
  return deployedFrom(lines, url);
}

/** The last `deploy` entry of wrangler's output lines: its version, and its URL (`url`, else the first `http(s)://` target). */
export function deployedFrom(lines, url) {
  const entry = lines
    .map((line) => JSON.parse(line))
    .filter((item) => item?.type === "deploy")
    .at(-1);
  if (typeof entry?.version_id !== "string") throw new Error("`wrangler deploy` succeeded but reported no version id");
  const targets = Array.isArray(entry.targets) ? entry.targets.filter((t) => typeof t === "string") : [];
  const found = url?.toString() ?? targets.find((t) => /^https?:\/\//.test(t));
  if (found === undefined) {
    throw new Error(`the Worker has no workers.dev URL to check /health on (targets: ${targets.join(", ") || "none"})`);
  }
  return { version: entry.version_id, url: found.replace(/\/+$/, "") };
}

/** `wrangler deployments list --json`: an array, oldest first. */
export function parseDeployments(output) {
  const text = output.trim();
  if (text === "") return [];
  const raw = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("`wrangler deployments list --json` did not print an array");
  return raw.map((entry) => {
    const item = entry ?? {};
    const message = item.annotations?.["workers/message"];
    const versions = Array.isArray(item.versions) ? item.versions : [];
    return {
      id: String(item.id ?? ""),
      created: String(item.created_on ?? ""),
      ...(typeof message === "string" && { message }),
      versions: versions.map((v) => ({ id: String(v?.version_id ?? ""), percentage: Number(v?.percentage ?? 0) })),
    };
  });
}

/** `GET <url>/health`: its status (`"unreachable"` when nothing answered), and what its body says. */
export async function probeHealth(url, fetcher, timeoutMs) {
  let response;
  try {
    response = await fetcher(new URL("/health", url), { signal: AbortSignal.timeout(timeoutMs), headers: { "cache-control": "no-cache" } });
  } catch {
    return { status: "unreachable" };
  }
  const body = await response.json().catch(() => undefined);
  return {
    status: response.status,
    ok: body?.ok === true,
    ...(body !== undefined && { version: typeof body?.version === "string" ? body.version : null }),
    ...(typeof body?.error === "string" && { error: body.error }),
  };
}

/** How long a new version has to answer `/health` (3 minutes), and between two probes. */
export const WAIT_MS = 180_000;
export const INTERVAL_MS = 2_000;

/** Probes `/health` until the deployed version answers it: ok, failing (its App does not start), or not in time. */
export async function waitForVersion(deployed, options = {}) {
  const fetcher = options.fetch ?? fetch;
  const deadline = Date.now() + (options.waitMs ?? WAIT_MS);
  for (;;) {
    const seen = await probeHealth(deployed.url, fetcher, 30_000);
    if (seen.version === deployed.version) {
      if (seen.ok) return { kind: "ok" };
      return { kind: "failing", detail: seen.error ?? `HTTP ${String(seen.status)}` };
    }
    const last = seen.status === "unreachable" ? "unreachable" : `HTTP ${seen.status} from version ${seen.version ?? "unknown"}`;
    if (Date.now() >= deadline) return { kind: "timeout", detail: last };
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? INTERVAL_MS));
  }
}

/** What went wrong with a version that is not ok: `v2 answers …/health that its App does not start (…)`. */
export function healthFailure(deployed, outcome, waitMs = WAIT_MS) {
  return outcome.kind === "failing"
    ? `${deployed.version} answers ${deployed.url}/health that its App does not start (${outcome.detail})`
    : `${deployed.version} did not answer ${deployed.url}/health within ${Math.round(waitMs / 1000)} s (last: ${outcome.detail})`;
}

/**
 * Rolls `deployed`, which failed `/health`, back to the version deployed before it (`wrangler
 * rollback <version>`), unless this deploy changed the Durable Object classes (its `mark` differs from
 * the previous version's tag). `name` is passed as `--name` when given (else wrangler reads
 * `wrangler.jsonc`'s). Resolves with what happened; it never throws for wrangler's failures.
 */
export async function rollBack({ wrangler, name, deployed, mark }) {
  const named = name === undefined ? [] : ["--name", name];
  const listed = await wrangler(["deployments", "list", ...named, "--json"], true);
  let deployments;
  try {
    if (listed.code !== 0) throw new Error(`exited with code ${listed.code}`);
    deployments = parseDeployments(listed.stdout);
  } catch (error) {
    return { kind: "failed", detail: `\`wrangler deployments list\` ${error instanceof Error ? error.message : String(error)}` };
  }
  const to = previousVersion(deployments, deployed.version);
  if (to === undefined) return { kind: "none" };
  if (mark !== undefined) {
    const previous = versionTag(await wrangler(["versions", "view", to, ...named, "--json"], true));
    if (previous?.startsWith(MARK) && previous !== mark) return { kind: "migration", to, mark, previous };
  }
  const message = `pikit: ${deployed.version} failed /health`;
  const done = await wrangler(["rollback", to, ...named, "--message", message, "--yes"], false);
  return done.code === 0 ? { kind: "rolled-back", to } : { kind: "failed", to, detail: `\`wrangler rollback\` exited with code ${done.code}` };
}

/** The newest deployment's version at 100% that is not `failing`: what `wrangler rollback` would go back to. */
function previousVersion(deployments, failing) {
  const newestFirst = [...deployments].sort((a, b) => b.created.localeCompare(a.created));
  for (const deployment of newestFirst) {
    const stable = deployment.versions.find((v) => v.percentage === 100);
    if (stable !== undefined && stable.id !== failing) return stable.id;
  }
  return undefined;
}

/** The `workers/tag` of `wrangler versions view --json`'s answer; undefined when it has none or failed. */
function versionTag(result) {
  if (result.code !== 0) return undefined;
  try {
    const text = result.stdout;
    const tag = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1))?.annotations?.["workers/tag"];
    return typeof tag === "string" ? tag : undefined;
  } catch {
    return undefined;
  }
}

/** The build log's line for a rollback's result: `pikit: v2 failed /health: rolled back to v1`, or why not. */
export function rollbackLine(version, result) {
  const failed = `pikit: ${version} failed /health`;
  switch (result.kind) {
    case "rolled-back":
      return `${failed}: rolled back to ${result.to}`;
    case "migration":
      return (
        `${failed} and was NOT rolled back: this deploy changed the Durable Object classes (${result.mark}; the previous version ${result.to} has ${result.previous}), ` +
        "and Cloudflare cannot roll back across a migration, which stays applied. It is still deployed: fix it forward, " +
        "with a version that keeps the migration in wrangler.jsonc"
      );
    case "none":
      return `${failed} and was not rolled back: there is no earlier version to go back to`;
    default:
      return (
        `${failed}, and rolling it back${result.to === undefined ? "" : ` to ${result.to}`} failed (${result.detail}): it is still deployed. ` +
        "Cloudflare refuses a rollback across a Durable Object migration; otherwise run `wrangler rollback`"
      );
  }
}
