/**
 * storage-kv-sql's tests. They are copied with the component and keep running in your project: the
 * `storage.kv` conformance suite over a SQLite file (values, namespaces, `setIfAbsent` races, data
 * that survives a restart), the lifecycle suite, and two processes over one database.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, defineApp, defineComponent, silentLogger } from "@pikit/core";
import type { KeyValueStorage } from "@pikit/contracts";
import { createLifecycleConformance } from "@pikit/core/testing";
import { createKeyValueConformance } from "@pikit/contracts/testing";
import storageKvSql, { TABLE } from "./index.ts";
import { openTestDatabase, testStorage } from "./storage.test-support.ts";

const directories: string[] = [];
const apps: App[] = [];
afterAll(async () => {
  for (const app of apps) await app.stop().catch(() => {});
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function temporaryDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), "pikit-storage-kv-sql-"));
  directories.push(dir);
  return join(dir, "pikit.db");
}

// The storage.kv contract, including data that outlives the app.
for (const c of createKeyValueConformance(() => ({ components: [testStorage(temporaryDatabase()), storageKvSql] }))) {
  test(`storage-kv-sql ${c.group}: ${c.name}`, () => c.run());
}

// Start and stop honour their deadline, and a fresh app over the same database starts again.
for (const c of createLifecycleConformance(() => ({ component: storageKvSql, providers: [testStorage(temporaryDatabase())] }))) {
  test(`storage-kv-sql ${c.group}: ${c.name}`, () => c.run());
}

/** One process of the component over `database`: its `storage.kv`. */
async function open(database: string): Promise<KeyValueStorage> {
  let storage: KeyValueStorage | undefined;
  const reader = defineComponent({
    name: "storage-kv-test",
    setup(pikit) {
      const handle = pikit.use("storage.kv");
      return { start: () => void (storage = handle.get()) };
    },
  });
  const app = await defineApp({ components: [testStorage(database), storageKvSql, reader], logger: silentLogger }).create();
  apps.push(app);
  await app.start();
  if (storage === undefined) throw new Error("storage.kv was not resolved");
  return storage;
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [testStorage(temporaryDatabase()), storageKvSql], logger: silentLogger }).create();
  expect(app.describe().components.find((component) => component.name === "storage-kv-sql")).toMatchObject({
    provides: ["storage.kv"],
    requires: ["storage.sql"],
    optional: [],
  });
});

test("two processes over one database see each other's writes, and one setIfAbsent race has one winner", async () => {
  const database = temporaryDatabase();
  const first = (await open(database)).namespace("shared");
  const second = (await open(database)).namespace("shared");

  await first.set("cursor", "42");
  expect(await second.get("cursor")).toBe("42");

  const results = await Promise.all([first.setIfAbsent("owner", "first"), second.setIfAbsent("owner", "second")]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await first.get("owner")).toBe(results[0] ? "first" : "second");
});

test("its values are rows of one table you can read with SQL", async () => {
  const database = temporaryDatabase();
  await (await open(database)).namespace("channel-telegram").set("cursor:answers", "7");
  const db = openTestDatabase(database);
  try {
    expect(await db.database.query(`SELECT namespace, entry_key, json FROM ${TABLE}`)).toEqual([{ namespace: "channel-telegram", entry_key: "cursor:answers", json: '"7"' }]);
  } finally {
    await db.close();
  }
});
