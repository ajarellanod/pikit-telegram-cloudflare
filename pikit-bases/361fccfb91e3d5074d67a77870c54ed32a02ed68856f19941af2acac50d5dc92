#!/usr/bin/env node
/**
 * deployment-cloudflare: the deploy command where no `pikit up` runs (a "Deploy to Cloudflare"
 * template's Workers Builds, which deploys every merge to the main branch; a deploy by hand), by the
 * same rules as `pikit up` (`rollout.mjs`). No dependency: Node 18 or later.
 *
 *   node src/pikit/deployment-cloudflare/deploy.mjs [<after-deploy script>…]
 *
 * 1. `wrangler deploy --tag migrations:<last tag>`: wrangler from the PATH (an npm script's), else the
 *    project's; its output goes to the build log. The tag records the version's Durable Object
 *    migrations, from `wrangler.jsonc`;
 * 2. it waits until `GET <url>/health` answers from the version deployed (3 minutes at most), at the
 *    workers.dev URL wrangler reports;
 * 3. if that version answers that its App does not start, or does not answer in time, it rolls back
 *    to the previous version (`wrangler rollback`, with the credentials wrangler deployed with) and
 *    exits 1, so the build fails: `pikit: <version> failed /health: rolled back to <previous>`. Not
 *    when the deploy changed the Durable Object classes: Cloudflare cannot roll back across a
 *    migration, so it exits 1 and says so, and the version stays;
 * 4. once it answers ok, it runs each after-deploy script given, in order: `node <script> <url>
 *    <version>` (channel-telegram-webhook's `setup-webhook.mjs` registers the bot's webhook). It exits
 *    1 when one fails; the version stays deployed (it answers: what failed is outside it).
 *
 * `PIKIT_HEALTH_WAIT_MS` and `PIKIT_HEALTH_INTERVAL_MS` change how long it waits, and how often it asks.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { deployedFrom, healthFailure, INTERVAL_MS, readMigrationsMark, rollBack, rollbackLine, WAIT_MS, waitForVersion } from "./rollout.mjs";

const WAIT = Number(process.env.PIKIT_HEALTH_WAIT_MS ?? WAIT_MS);
const INTERVAL = Number(process.env.PIKIT_HEALTH_INTERVAL_MS ?? INTERVAL_MS);

/** The PATH for wrangler: the one given first, then every `node_modules/.bin` from here up. */
function wranglerPath(cwd) {
  const bins = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    bins.push(join(dir, "node_modules", ".bin"));
    if (dirname(dir) === dir) break;
  }
  return [process.env.PATH ?? "", ...bins].filter((entry) => entry !== "").join(delimiter);
}

/** Runs `command`, its output to ours (or captured); resolves with its exit code and stdout. */
function run(command, args, { capture = false, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"] });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.on("error", (error) => {
      console.error(`pikit: \`${command}\` did not start (${error.message})`);
      resolve({ code: 127, stdout });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

/**
 * Where wrangler writes its output (one JSON object per line). A build's own choice is kept
 * (`WRANGLER_OUTPUT_FILE_PATH`, or a new file in `WRANGLER_OUTPUT_FILE_DIRECTORY`); otherwise a file of ours.
 */
function outputFiles() {
  const given = process.env.WRANGLER_OUTPUT_FILE_PATH;
  if (given) return { env: {}, read: () => [given], done: () => {} };
  const directory = process.env.WRANGLER_OUTPUT_FILE_DIRECTORY;
  const listed = () => (existsSync(directory) ? readdirSync(directory).filter((file) => file.startsWith("wrangler-output-")) : []);
  if (directory) {
    const before = new Set(listed());
    return { env: {}, read: () => listed().filter((file) => !before.has(file)).map((file) => join(directory, file)), done: () => {} };
  }
  const work = mkdtempSync(join(tmpdir(), "pikit-deploy-"));
  const path = join(work, "wrangler-output.jsonl");
  return { env: { WRANGLER_OUTPUT_FILE_PATH: path }, read: () => [path], done: () => rmSync(work, { recursive: true, force: true }) };
}

async function main(scripts) {
  const cwd = process.cwd();
  const env = { PATH: wranglerPath(cwd) };
  const wrangler = (args, capture) => run("wrangler", args, { capture, env });

  const mark = readMigrationsMark(cwd);
  const output = outputFiles();
  let deployed;
  try {
    const deploy = await run("wrangler", ["deploy", ...(mark === undefined ? [] : ["--tag", mark])], { env: { ...env, ...output.env } });
    if (deploy.code !== 0) return deploy.code;
    const lines = output
      .read()
      .filter((file) => existsSync(file))
      .flatMap((file) => readFileSync(file, "utf8").split("\n"))
      .filter((line) => line.trim() !== "");
    deployed = deployedFrom(lines);
  } catch (error) {
    console.error(`pikit: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    output.done();
  }

  const outcome = await waitForVersion(deployed, { waitMs: WAIT, intervalMs: INTERVAL });
  if (outcome.kind !== "ok") {
    console.error(`pikit: ${healthFailure(deployed, outcome, WAIT)}`);
    console.error(rollbackLine(deployed.version, await rollBack({ wrangler, deployed, mark })));
    console.error("pikit: its logs say why: Workers Logs in the Cloudflare dashboard, or `wrangler tail`");
    return 1;
  }
  console.log(`pikit: ${deployed.version} answers ${deployed.url}/health`);

  let code = 0;
  for (const script of scripts) {
    const done = await run(process.execPath, [script, deployed.url, deployed.version]);
    if (done.code !== 0) {
      console.error(`pikit: ${script} failed (exit code ${done.code}); ${deployed.version} stays deployed`);
      code = 1;
    }
  }
  return code;
}

process.exitCode = await main(process.argv.slice(2));
