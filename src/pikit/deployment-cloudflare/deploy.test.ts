/**
 * `deploy.mjs`, the deploy command of a build without pikit (Workers Builds), run by Node as a build
 * runs it: against a fake `wrangler` on the PATH (a shell script that notes each command) and a fake
 * `/health`. A healthy version runs the after-deploy scripts; a failing one, or one that never
 * answers, is rolled back to the previous version; one that changed the Durable Object classes is
 * not. No wrangler, no account.
 */

import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "pikit-cloudflare-deploy-"));
  dirs.push(dir);
  return dir;
}

/** What `wrangler` prints and writes: its output file's `deploy` entry, the deployments, the previous version's tag. */
const FAKE_WRANGLER = `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$1" in
  deploy)
    if [ -n "$FAKE_DEPLOY_FAILS" ]; then echo "X [ERROR] the deploy failed" >&2; exit 1; fi
    echo "Uploaded my-bot"
    out="\${WRANGLER_OUTPUT_FILE_PATH:-$WRANGLER_OUTPUT_FILE_DIRECTORY/wrangler-output-fake.json}"
    printf '{"type":"deploy","version_id":"v2","targets":["%s","example.com/*"]}\\n' "$FAKE_URL" >> "$out" ;;
  deployments)
    printf '[{"id":"d1","created_on":"2026-09-01T10:00:00Z","versions":[{"version_id":"v1","percentage":100}]},{"id":"d2","created_on":"2026-09-02T10:00:00Z","versions":[{"version_id":"v2","percentage":100}]}]' ;;
  versions)
    printf '{"id":"%s","annotations":{"workers/tag":"%s"}}' "$3" "$FAKE_PREVIOUS_TAG" ;;
  rollback)
    echo "Current Version ID: $2" ;;
esac
`;

/** An after-deploy script: notes what it is given. */
const STEP = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.STEP_LOG, process.argv.slice(2).join(" ") + "\\n");
process.exitCode = Number(process.env.STEP_CODE ?? 0);
`;

const NODE = Bun.which("node") ?? process.execPath;

/**
 * A project whose wrangler.jsonc has the `migrations` tags given, `/health` answering each body in turn
 * (then the last one forever), and `deploy.mjs` run there with one after-deploy script.
 */
async function deploy(options: { migrations: string[]; health: ({ ok: boolean; version: string; error?: string })[]; env?: Record<string, string> }) {
  const dir = temp();
  const project = join(dir, "project");
  const bin = join(dir, "bin");
  mkdirSync(project);
  mkdirSync(bin);
  writeFileSync(join(bin, "wrangler"), FAKE_WRANGLER);
  chmodSync(join(bin, "wrangler"), 0o755);
  writeFileSync(join(dir, "step.mjs"), STEP);
  const migrations = options.migrations.map((tag) => `{ "tag": "${tag}", "new_sqlite_classes": ["Class${tag}"] },`).join(" ");
  writeFileSync(join(project, "wrangler.jsonc"), `{\n  // the Worker\n  "name": "my-bot",\n  "migrations": [${migrations}],\n}\n`);

  const answers = [...options.health];
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      asked.push(new URL(request.url).pathname);
      const body = (answers.length > 1 ? answers.shift() : answers[0]) as { ok: boolean };
      return Response.json(body, { status: body.ok ? 200 : 503 });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  try {
    const own = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("WRANGLER_OUTPUT_FILE"))) as Record<string, string>;
    const child = Bun.spawn([NODE, join(import.meta.dir, "deploy.mjs"), join(dir, "step.mjs")], {
      cwd: project,
      env: {
        ...own,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_LOG: join(dir, "wrangler.log"),
        FAKE_URL: url,
        FAKE_PREVIOUS_TAG: "migrations:v1",
        STEP_LOG: join(dir, "step.log"),
        PIKIT_HEALTH_WAIT_MS: "2000",
        PIKIT_HEALTH_INTERVAL_MS: "10",
        ...options.env,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    const read = (file: string) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8").trim().split("\n") : []);
    return { code, out, err, url, asked, wrangler: read("wrangler.log"), steps: read("step.log"), dir };
  } finally {
    server.stop(true);
  }
}

const ROLLBACK = ["deployments list --json", "versions view v1 --json", "rollback v1 --message pikit: v2 failed /health --yes"];

test("a version that answers: tagged with its migrations, waited for, then the after-deploy scripts get its URL and version", async () => {
  const run = await deploy({ migrations: ["v1"], health: [{ ok: true, version: "v1" }, { ok: true, version: "v2" }] });
  expect(run.err).toBe("");
  expect(run.code).toBe(0);
  expect(run.wrangler).toEqual(["deploy --tag migrations:v1"]);
  expect(run.asked).toEqual(["/health", "/health"]);
  expect(run.steps).toEqual([`${run.url} v2`]);
  // wrangler's output, then pikit's line, in the build log.
  expect(run.out).toBe(`Uploaded my-bot\npikit: v2 answers ${run.url}/health\n`);
});

test("a build's own output directory is where wrangler writes, and is read from there", async () => {
  const outputs = join(temp(), "outputs");
  mkdirSync(outputs);
  const run = await deploy({ migrations: ["v1"], health: [{ ok: true, version: "v2" }], env: { WRANGLER_OUTPUT_FILE_DIRECTORY: outputs } });
  expect(run.code).toBe(0);
  expect(readFileSync(join(outputs, "wrangler-output-fake.json"), "utf8")).toContain('"version_id":"v2"');
});

test("a version whose App does not start is rolled back to the previous one, and the build fails", async () => {
  const run = await deploy({ migrations: ["v1"], health: [{ ok: false, version: "v2", error: "the object's App did not start" }] });
  expect(run.code).toBe(1);
  expect(run.wrangler).toEqual(["deploy --tag migrations:v1", ...ROLLBACK]);
  expect(run.err).toContain(`pikit: v2 answers ${run.url}/health that its App does not start (the object's App did not start)\n`);
  expect(run.err).toContain("pikit: v2 failed /health: rolled back to v1\n");
  expect(run.steps).toEqual([]);
});

test("a version that never answers is rolled back too", async () => {
  const run = await deploy({ migrations: ["v1"], health: [{ ok: true, version: "v1" }], env: { PIKIT_HEALTH_WAIT_MS: "200" } });
  expect(run.code).toBe(1);
  expect(run.wrangler).toEqual(["deploy --tag migrations:v1", ...ROLLBACK]);
  expect(run.err).toContain(`pikit: v2 did not answer ${run.url}/health within 0 s (last: HTTP 200 from version v1)\n`);
  expect(run.err).toContain("pikit: v2 failed /health: rolled back to v1\n");
  expect(run.steps).toEqual([]);
});

test("a deploy that changed the Durable Object classes is not rolled back: it fails, saying why", async () => {
  const run = await deploy({ migrations: ["v1", "v2"], health: [{ ok: false, version: "v2" }] });
  expect(run.code).toBe(1);
  expect(run.wrangler).toEqual(["deploy --tag migrations:v2", "deployments list --json", "versions view v1 --json"]);
  expect(run.err).toContain(
    "pikit: v2 failed /health and was NOT rolled back: this deploy changed the Durable Object classes (migrations:v2; the previous version v1 has migrations:v1)",
  );
  // A previous version with no such tag (deployed another way) is rolled back to: Cloudflare refuses if it must.
  const untagged = await deploy({ migrations: ["v1", "v2"], health: [{ ok: false, version: "v2" }], env: { FAKE_PREVIOUS_TAG: "" } });
  expect(untagged.wrangler).toEqual(["deploy --tag migrations:v2", ...ROLLBACK]);
});

test("a failed wrangler deploy fails the build with its exit code, and nothing is asked", async () => {
  const run = await deploy({ migrations: ["v1"], health: [{ ok: true, version: "v2" }], env: { FAKE_DEPLOY_FAILS: "1" } });
  expect(run.code).toBe(1);
  expect(run.wrangler).toEqual(["deploy --tag migrations:v1"]);
  expect(run.err).toBe("X [ERROR] the deploy failed\n");
  expect(run.asked).toEqual([]);
});

test("an after-deploy script that fails fails the build, and the version stays", async () => {
  const run = await deploy({ migrations: ["v1"], health: [{ ok: true, version: "v2" }], env: { STEP_CODE: "1" } });
  expect(run.code).toBe(1);
  expect(run.wrangler).toEqual(["deploy --tag migrations:v1"]);
  expect(run.err).toContain("step.mjs failed (exit code 1); v2 stays deployed\n");
});
