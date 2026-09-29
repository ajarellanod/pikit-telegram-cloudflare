/**
 * `wrangler.jsonc` keeps the promises the entrypoint relies on, and nothing Cloudflare-specific leaks
 * out of the entrypoint (C5). The file is yours to edit; these tests say what must stay.
 */

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OBJECT_BINDING, VERSION_BINDING } from "./host.ts";

/** The project's root, where `pikit add` puts `wrangler.jsonc` (in the registry: `files/`). */
const ROOT = join(import.meta.dir, "..", "..", "..");

interface WranglerConfig {
  name?: string;
  main: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  durable_objects: { bindings: { name: string; class_name: string }[] };
  migrations: { tag: string; new_sqlite_classes?: string[]; new_classes?: string[] }[];
  version_metadata?: { binding: string };
  rules?: { type: string; globs: string[] }[];
}

const config = Bun.JSONC.parse(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8")) as WranglerConfig;

test("the Worker is this component's worker.ts, which exports the Durable Object class", () => {
  expect(config.main).toBe("src/pikit/deployment-cloudflare/worker.ts");
  expect(existsSync(join(ROOT, config.main))).toBe(true);
  expect(readFileSync(join(ROOT, config.main), "utf8")).toContain("export const Conversation");
});

test("one Durable Object class, Conversation, SQLite-backed, bound where the entrypoint reads it", () => {
  expect(config.durable_objects.bindings).toEqual([{ name: OBJECT_BINDING, class_name: "Conversation" }]);
  // storage-do needs SQLite; a class first created without it can never get it.
  expect(config.migrations[0]).toEqual({ tag: "v1", new_sqlite_classes: ["Conversation"] });
  expect(config.migrations.some((m) => m.new_classes?.includes("Conversation"))).toBe(false);
});

test("/health can report the version, nodejs_compat is on, and .md and .wasm are bundled", () => {
  expect(config.version_metadata).toEqual({ binding: VERSION_BINDING });
  expect(config.compatibility_flags).toContain("nodejs_compat");
  expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(config.rules?.map((r) => [r.type, r.globs])).toEqual([
    ["Text", ["**/*.md"]],
    // execution-do imports QuickJS by a package export without `.wasm`: a rule matches the import as written.
    ["CompiledWasm", ["**/*.wasm", "@jitl/quickjs-wasmfile-release-sync/wasm"]],
  ]);
});

test("a name in the file (a Deploy to Cloudflare template's, for Workers Builds) is one Cloudflare accepts; pikit's has none", () => {
  // Without one, the commands name the Worker after package.json, so projects never collide; with one,
  // they use it (commands.test.ts), so `pikit up` and Workers Builds deploy the same Worker.
  if (config.name !== undefined) expect(config.name).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  // In pikit's registry the file is `files/wrangler.jsonc`, and names nothing.
  if (existsSync(join(ROOT, "..", "component.json"))) expect(config.name).toBeUndefined();
});

test("entrypoint.ts is the only file that imports cloudflare:*, and worker.ts reaches no node:* (C5)", () => {
  const sources = readdirSync(import.meta.dir).filter((file) => file.endsWith(".ts") && !file.includes(".test"));
  const importing = (scheme: string) => sources.filter((file) => new RegExp(`from "${scheme}:`).test(readFileSync(join(import.meta.dir, file), "utf8")));
  expect(importing("cloudflare")).toEqual(["entrypoint.ts"]);
  // What the Worker bundles (worker.ts → entrypoint.ts → host.ts) never touches the machine.
  expect(importing("node")).toEqual(["commands.ts"]);
});
