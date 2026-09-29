/**
 * submissions-sql's tests. They are copied with the component and keep running in your project: the
 * `agent.submissions` suite (with its `answers` feed, pruning and restarts), the lifecycle suite, this
 * component's retention, and its schema versions. `convergence.test.ts` kills the process after each
 * of its commits.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type App, type AppContext, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { type AgentSubmissions, type SqlDatabase, type SqlStatements } from "@pikit/contracts";
import { createLifecycleConformance, createManualClock, type ManualClock } from "@pikit/core/testing";
import { createSubmissionsConformance } from "@pikit/contracts/testing";
import submissionsSql from "./index.ts";
import { createStore, SCHEMA_VERSION } from "./store.ts";
import { openTestDatabase, testStorage } from "./storage.test-support.ts";

const DAY = 24 * 60 * 60 * 1_000;
const directories: string[] = [];
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function temporaryDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), "pikit-submissions-"));
  directories.push(dir);
  return join(dir, "pikit.db");
}

/** One process of the component over `database`. */
async function open(database: string, clock: ManualClock, config: Record<string, unknown> = {}): Promise<{ app: App; submissions: AgentSubmissions; ctx: AppContext }> {
  let submissions: AgentSubmissions | undefined;
  const reader = defineComponent({
    name: "submissions-test",
    setup(pikit) {
      const handle = pikit.use("agent.submissions");
      return { start: () => void (submissions = handle.get()) };
    },
  });
  const app = await defineApp({ components: [testStorage(database), submissionsSql, reader], config, logger: silentLogger, clock }).create();
  await app.start();
  if (submissions === undefined) throw new Error("agent.submissions was not resolved");
  return { app, submissions, ctx: app.context() };
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [testStorage(temporaryDatabase()), submissionsSql], logger: silentLogger }).create();
  expect(app.describe().components.find((component) => component.name === "submissions-sql")).toMatchObject({
    provides: ["agent.submissions"],
    requires: ["storage.sql"],
    optional: [],
  });
});

// Settlements are pruned after `keepSettledDays` (7 by default), at start: `prune` restarts eight days later.
for (const c of createSubmissionsConformance(
  async () => {
    const database = temporaryDatabase();
    const clock = createManualClock();
    let process = await open(database, clock);
    return {
      submissions: () => process.submissions,
      async prune() {
        await process.app.stop();
        await clock.advance(8 * DAY);
        process = await open(database, clock);
      },
      async restart() {
        await process.app.stop();
        process = await open(database, clock);
      },
      dispose: () => process.app.stop(),
    };
  },
  { prunes: true, restarts: true },
)) {
  test(`submissions-sql ${c.group}: ${c.name}`, () => c.run());
}

for (const c of createLifecycleConformance(() => ({ component: submissionsSql, providers: [testStorage(temporaryDatabase())] }))) {
  test(`submissions-sql ${c.group}: ${c.name}`, () => c.run());
}

test("a running process prunes settlements past keepSettledDays at most hourly, and keeps what is pending", async () => {
  const clock = createManualClock();
  const { app, submissions: s, ctx } = await open(temporaryDatabase(), clock, { "submissions-sql": { keepSettledDays: 1 } });
  const conversation = { key: "test:c1", agent: "support", sessionId: "s1" };
  const admittedAt = clock.now();
  try {
    await s.admitted(conversation, "waiting", ctx);
    await s.settled({ conversation, requestId: "old", requestIds: ["old"], kind: "completed", text: "old" }, ctx);
    const { items } = await s.answers.read(undefined, 10);
    const oldCursor = items[0]?.cursor;

    await clock.advance(2 * DAY);
    await s.settled({ conversation, requestId: "new", requestIds: ["new"], kind: "completed", text: "new" }, ctx);

    expect(await s.get(conversation, "old", ctx)).toBeUndefined();
    expect((await s.get(conversation, "new", ctx))?.kind).toBe("settled");
    // Pending, with the app's time of its admission: two days old by now.
    expect(await s.pending(ctx)).toEqual([{ conversation, requestIds: ["waiting"], oldestAdmittedAt: admittedAt }]);
    const page = await s.answers.read(undefined, 10);
    expect(page.items.map((i) => i.fact.requestId)).toEqual(["new"]);
    expect((await s.answers.read("0", 10)).gap).toBe(true);
    expect((await s.answers.read(oldCursor, 10)).gap).toBe(false);
  } finally {
    await app.stop();
  }
});

test("keepSettledDays is at least 1: 0 would prune, at start, every answer that ended during a deploy", async () => {
  const failure = await open(temporaryDatabase(), createManualClock(), { "submissions-sql": { keepSettledDays: 0 } }).then(
    ({ app }) => app.stop().then(() => undefined),
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toMatch(/keepSettledDays/);
});

test("two processes migrating at once: the one that waited for the lock finds the schema done", async () => {
  const database = temporaryDatabase();
  const first = openTestDatabase(database);
  const second = openTestDatabase(database);
  try {
    // The second process migrates while the first is between its own checks and its transaction:
    // it is let through just before the first's transaction takes the lock.
    let raced = false;
    const racing: SqlDatabase = {
      ...first.database,
      transaction: async <T>(work: (tx: SqlStatements) => Promise<T>): Promise<T> => {
        if (!raced) {
          raced = true;
          await createStore(second.database).migrate();
        }
        return first.database.transaction(work);
      },
    };

    await createStore(racing).migrate();

    expect(raced).toBe(true);
    expect(await first.database.query("SELECT value FROM submissions_meta WHERE name = 'schema_version'")).toEqual([{ value: SCHEMA_VERSION }]);
  } finally {
    await first.close();
    await second.close();
  }
});

test("a database written by a newer component is refused at start", async () => {
  const database = temporaryDatabase();
  const newer = new DatabaseSync(database);
  newer.exec("CREATE TABLE submissions_meta (name TEXT PRIMARY KEY, value INTEGER NOT NULL)");
  newer.prepare("INSERT INTO submissions_meta (name, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION + 1);
  newer.close();

  const failure = await open(database, createManualClock()).then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(Error);
  // The app says which component failed; the component's own reason is the cause.
  expect(String((failure as Error).cause)).toMatch(/newer than this component/);
});
