/**
 * storage-do's tests. They are copied with the component and keep running in your project, under
 * `bun test`, over a double of a Durable Object's storage (`durable-object.test-support.ts`): the
 * `storage.sql` conformance suite, the lifecycle suite, and what it refuses at start. pikit runs the
 * same suite on a real SQLite-backed Durable Object in workerd (`tests/workerd`).
 */

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, silentLogger, withContextValue } from "@pikit/core";
import { type SqlDatabase, WORKERS_HOST, type WorkersHost } from "@pikit/contracts";
import { createLifecycleConformance } from "@pikit/core/testing";
import { createSqlDatabaseConformance, withWorkersHost } from "@pikit/contracts/testing";
import storageDo from "./index.ts";
import { fakeDurableObjectStorage, fakeObjectHost } from "./durable-object.test-support.ts";

// The storage.sql contract; one object per case, shared by the apps the case starts.
for (const c of createSqlDatabaseConformance(() => ({ components: withWorkersHost(fakeObjectHost(), [storageDo]) }))) {
  test(`storage-do ${c.group}: ${c.name}`, () => c.run());
}

// Start and stop honour their deadline, and a fresh app over the same object starts again.
const [hostedStorageDo = storageDo] = withWorkersHost(fakeObjectHost(), [storageDo]);
for (const c of createLifecycleConformance(() => ({ component: hostedStorageDo }))) {
  test(`storage-do ${c.group}: ${c.name}`, () => c.run());
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [storageDo], logger: silentLogger }).create();
  expect(app.describe().components).toEqual([{ name: "storage-do", provides: ["storage.sql"], requires: [], optional: [] }]);
});

/** The reason `app.start` fails with, when the host in its context is `host`. */
async function startFailure(host: WorkersHost | undefined): Promise<string> {
  const app = await defineApp({ components: [storageDo], logger: silentLogger }).create();
  const parent = host === undefined ? BACKGROUND_CONTEXT : withContextValue(WORKERS_HOST, host, BACKGROUND_CONTEXT);
  const error = await app.start(parent).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  // The app wraps a component's start failure; the component's own error is its cause.
  if (!(error instanceof Error) || !(error.cause instanceof Error)) throw new Error("expected start() to fail with a cause");
  return error.cause.message;
}

test("it refuses to start off Cloudflare, in the Worker's App, or on an object without SQLite", async () => {
  expect(await startFailure(undefined)).toContain("storage-do: no WORKERS_HOST in the start context");
  expect(await startFailure({ env: {} })).toContain("WORKERS_HOST has no object");
  // A key-value-backed object (`new_classes`) has no `sql`; reading it throws.
  const withoutSql = {
    get sql(): never {
      throw new Error("SQL is not enabled for this Durable Object class.");
    },
    transaction: async () => {},
  };
  expect(await startFailure(fakeObjectHost(withoutSql))).toContain("new_sqlite_classes");
});

test("it uses the object in app.start's context, as deployment-cloudflare passes it, and says when used after stop", async () => {
  const storage = fakeDurableObjectStorage();
  storage.sql.exec("CREATE TABLE seen (v TEXT)");
  storage.sql.exec("INSERT INTO seen VALUES ('in the object')");
  let db: SqlDatabase | undefined;
  const user = defineComponent({
    name: "storage-user",
    setup(pikit) {
      const handle = pikit.use("storage.sql");
      return { start: () => void (db = handle.get()) };
    },
  });
  const app = await defineApp({ components: [storageDo, user], logger: silentLogger }).create();
  await app.start(withContextValue(WORKERS_HOST, fakeObjectHost(storage), BACKGROUND_CONTEXT));
  expect(await db?.query("SELECT v FROM seen")).toEqual([{ v: "in the object" }]);
  await app.stop();
  await expect(db?.query("SELECT 1") ?? Promise.resolve()).rejects.toThrow("storage-do: storage.sql used while the app is not running");
});
