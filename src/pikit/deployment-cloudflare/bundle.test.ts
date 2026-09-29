/**
 * The Worker bundles: `wrangler deploy --dry-run` on a throwaway project with this component where
 * `pikit add` puts it and a two-App `pikit.config.ts`. It uploads nothing and needs no account, only
 * the project's wrangler (`node_modules/.bin/wrangler`, which runs on Node).
 */

import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");

test("wrangler bundles worker.ts with the project's two Apps, and exports the Conversation class", async () => {
  const project = mkdtempSync(join(tmpdir(), "pikit-deployment-cloudflare-"));
  try {
    const installed = join(project, "src", "pikit", "deployment-cloudflare");
    mkdirSync(installed, { recursive: true });
    for (const file of ["worker.ts", "entrypoint.ts", "host.ts"]) copyFileSync(join(import.meta.dir, file), join(installed, file));
    copyFileSync(join(ROOT, "wrangler.jsonc"), join(project, "wrangler.jsonc"));
    const modules = nodeModules();
    symlinkSync(modules, join(project, "node_modules"), "dir");
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "bundle-check", type: "module" }));
    writeFileSync(
      join(project, "pikit.config.ts"),
      [
        'import { defineApp, defineComponent } from "@pikit/core";',
        'const hello = defineComponent({ name: "hello", setup(pikit) { pikit.provideKeyed("http.route", "GET /hello", () => new Response("hi")); } });',
        "export const worker = defineApp({ components: [hello] });",
        "export default defineApp({ components: [] });",
        "",
      ].join("\n"),
    );

    const child = Bun.spawn([join(modules, ".bin", "wrangler"), "deploy", "--dry-run", "--outdir", "out", "--name", "bundle-check"], {
      cwd: project,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: expect.any(String) });
    expect(stdout).toContain("env.CONVERSATION (Conversation)");

    const bundle = readFileSync(join(project, "out", "worker.js"), "utf8");
    expect(bundle).toMatch(/export \{[^}]*\bConversation\b[^}]*\bas default\b[^}]*\}/s);
    // The machine's commands (node:child_process) never reach the Worker.
    expect(bundle).not.toContain("child_process");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}, 60_000);

/** The `node_modules` with `@pikit/core` and wrangler: the project's (or the monorepo's). */
function nodeModules(): string {
  for (let dir = import.meta.dir; dir !== dirname(dir); dir = dirname(dir)) {
    const modules = join(dir, "node_modules");
    if (existsSync(join(modules, "@pikit", "core"))) {
      if (!existsSync(join(modules, ".bin", "wrangler"))) throw new Error(`${modules} has no wrangler: run \`bun add --dev wrangler\``);
      return modules;
    }
  }
  throw new Error("no node_modules with @pikit/core above this test");
}
