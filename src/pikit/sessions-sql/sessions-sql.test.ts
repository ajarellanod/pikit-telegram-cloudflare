/**
 * sessions-sql's tests. They are copied with the component and keep running in your project. Pi's
 * own session suites run over the store this component provides (SPEC §4: the Durable Object session
 * backend passes Pi's session conformance), on a SQLite file that refuses every statement a Durable
 * Object's SQL would, through `@pikit/pi-adapter/testing`, so they never import Pi.
 *
 * The runtime on these sessions, with a worker killed mid-run, is in runtime-pi's tests
 * (`createPiRuntimeFixture(…, { sessions: "sql" })`).
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { createLifecycleConformance } from "@pikit/core/testing";
import type { SessionStore } from "@pikit/pi-adapter";
import { createSessionRepoConformance, createSessionRepoStreamingForkConformance, createStorageConformance, storageOf } from "@pikit/pi-adapter/testing";
import sessionsSql from "./index.ts";
import { openTestDatabase, testStorage } from "./storage.test-support.ts";

const directories: string[] = [];
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function temporaryDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), "pikit-sessions-sql-"));
  directories.push(dir);
  return join(dir, "pikit.db");
}

/** A started app with this component over the database at `path`, and the store it provides. */
async function started(path: string, config: { cwd?: string } = {}): Promise<{ app: App; sessions: SessionStore }> {
  let sessions: SessionStore | undefined;
  const reader = defineComponent({
    name: "sessions-reader",
    setup(pikit) {
      const handle = pikit.use("sessions.store");
      return { start: () => void (sessions = handle.get()) };
    },
  });
  const app = await defineApp({ components: [testStorage(path), sessionsSql, reader], config: { "sessions-sql": config }, logger: silentLogger }).create();
  await app.start();
  if (sessions === undefined) throw new Error("sessions.store was not resolved");
  return { app, sessions };
}

// Pi's SessionRepo suites, including the fork cases Pi runs for its own repositories.
let current: App | undefined;
const repo = async () => {
  const { app, sessions } = await started(temporaryDatabase());
  current = app;
  return sessions;
};
const stopRepo = async () => {
  await current?.stop();
};
for (const c of [...createSessionRepoConformance(repo, stopRepo), ...createSessionRepoStreamingForkConformance(repo, stopRepo)]) {
  test(`sessions-sql ${c.group}: ${c.name}`, () => c.run());
}

// Pi's Storage suite, over the storage of a session this store created.
for (const c of createStorageConformance(async () => {
  const { app, sessions } = await started(temporaryDatabase());
  const session = await sessions.create({}, app.context());
  return {
    storage: storageOf(session),
    [Symbol.asyncDispose]: async () => {
      await session.close(app.context());
      await app.stop();
    },
  };
})) {
  test(`sessions-sql storage ${c.group}: ${c.name}`, () => c.run(), 30_000);
}

// Start and stop honour their deadline, and a fresh app over the same database starts again.
for (const c of createLifecycleConformance(() => ({ component: sessionsSql, providers: [testStorage(temporaryDatabase())] }))) {
  test(`sessions-sql ${c.group}: ${c.name}`, () => c.run());
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [testStorage(temporaryDatabase()), sessionsSql], logger: silentLogger }).create();

  expect(app.describe().components.find((component) => component.name === "sessions-sql")).toEqual({
    name: "sessions-sql",
    provides: ["sessions.store"],
    requires: ["storage.sql"],
    optional: [],
  });
});

test("a session outlives the process: a new app over the same database finds and opens it", async () => {
  const path = temporaryDatabase();
  const first = await started(path, { cwd: "/srv/agent" });
  const created = await first.sessions.create({}, first.app.context());
  await created.setName("remembered", first.app.context());
  await created.close(first.app.context());
  await first.app.stop();

  const second = await started(path);
  const ctx = second.app.context();
  const metadata = await second.sessions.find?.(created.metadata.id, ctx);
  if (metadata === undefined) throw new Error("the session was not found");
  const reopened = await second.sessions.open(metadata, ctx);

  expect(metadata).toEqual(created.metadata);
  expect(metadata.cwd).toBe("/srv/agent");
  expect(await reopened.getName(ctx)).toBe("remembered");
  await reopened.close(ctx);
  await second.app.stop();
});

test("its records are rows of its own versioned tables, which you can read with SQL", async () => {
  const path = temporaryDatabase();
  const { app, sessions } = await started(path);
  const session = await sessions.create({ id: "readable" }, app.context());
  await session.setName("in SQL", app.context());
  await session.close(app.context());
  await app.stop();

  const db = openTestDatabase(path);
  try {
    const tables = await db.database.query<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name");
    expect(tables.map((table) => table.name)).toEqual([
      "sessions_sql_chunks",
      "sessions_sql_entries",
      "sessions_sql_lists",
      "sessions_sql_meta",
      "sessions_sql_sessions",
      "sessions_sql_usage",
      "sessions_sql_values",
    ]);
    expect(await db.database.query("SELECT value FROM sessions_sql_meta WHERE name = 'schema_version'")).toEqual([{ value: 1 }]);
    expect(await db.database.query("SELECT namespace, json FROM sessions_sql_values WHERE session_id = 'readable'")).toEqual([
      { namespace: "pi.session.name", json: '"in SQL"' },
    ]);
  } finally {
    await db.close();
  }
});

test("it refuses to start on a database written by a newer version", async () => {
  const path = temporaryDatabase();
  await (await started(path)).app.stop();
  const db = openTestDatabase(path);
  await db.database.run("UPDATE sessions_sql_meta SET value = value + 1 WHERE name = 'schema_version'");
  await db.close();

  const app = await defineApp({ components: [testStorage(path), sessionsSql], logger: silentLogger }).create();
  const error = await app.start().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(String((error as Error).message)).toContain('"sessions-sql" failed to start');
});

test("the store is refused while the app is not running", async () => {
  const { app, sessions } = await started(temporaryDatabase());
  await app.stop();

  expect(() => sessions.list(undefined, app.context())).toThrow("while the app is not running");
});
