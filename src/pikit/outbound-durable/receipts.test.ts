/**
 * outbound-durable's receipts and its schema versions. The queue suite already checks what every
 * queue's receipts must do (outbound-durable.test.ts); these check what is this component's: its
 * retention (`keepDeliveredDays`) as the feed's pruning, and a database from before receipts.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type App, type AppEvents, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { type DeliveryReceipt, type OutboundQueue } from "@pikit/contracts";
import { createManualClock, type ManualClock } from "@pikit/core/testing";
import { createFeedConformance } from "@pikit/contracts/testing";
import outboundDurable from "./index.ts";
import type { SqlDatabase, SqlStatements } from "@pikit/contracts";
import { createStore, SCHEMA_VERSION } from "./store.ts";
import { openTestDatabase, testStorage } from "./storage.test-support.ts";

const DAY = 24 * 60 * 60 * 1_000;
const directories: string[] = [];
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function temporaryDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), "pikit-outbound-receipts-"));
  directories.push(dir);
  return join(dir, "pikit.db");
}

/** One process of the outbox over `database`, with a transport that delivers everything at once. */
async function openOutbox(database: string, clock: ManualClock) {
  let queue: OutboundQueue | undefined;
  const delivered = new Set<string>();
  const observer = defineComponent({
    name: "receipts-test",
    setup(pikit) {
      const handle = pikit.use("outbound.queue");
      pikit.on("outbound.delivered", (event: AppEvents["outbound.delivered"]) => void delivered.add(event.key));
      return { start: () => void (queue = handle.get()) };
    },
  });
  const app: App = await defineApp({ components: [testStorage(database), outboundDurable, observer], logger: silentLogger, clock }).create();
  await app.start();
  if (queue === undefined) throw new Error("no queue");
  let sent = 0;
  queue.attach("chat", { idempotent: true, split: (text) => [text], send: async () => ({ platformMessageId: `p${++sent}` }) });
  return { app, queue, delivered };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`expected ${what}`);
    await Bun.sleep(2);
  }
}

// Receipts are pruned with their pieces (after `keepDeliveredDays`, 7 by default, at start): a reader
// left behind is told it missed some.
for (const c of createFeedConformance<DeliveryReceipt>(
  async () => {
    const database = temporaryDatabase();
    const clock = createManualClock();
    let outbox = await openOutbox(database, clock);
    let n = 0;
    return {
      feed: () => outbox.queue.receipts,
      async commit() {
        const key = `fact-${++n}`;
        await outbox.queue.enqueue({ idempotencyKey: key, channel: "chat", conversationKey: "chat:1", text: `fact ${n}` });
        await until(() => outbox.delivered.has(`${key}#0`), `${key} delivered`);
        return key;
      },
      identify: (receipt) => receipt.idempotencyKey,
      async prune() {
        await outbox.app.stop();
        await clock.advance(8 * DAY);
        outbox = await openOutbox(database, clock);
      },
      async restart() {
        await outbox.app.stop();
        outbox = await openOutbox(database, clock);
      },
      dispose: () => outbox.app.stop(),
    };
  },
  { prunes: true, restarts: true },
)) {
  test(`outbound-durable receipts ${c.group}: ${c.name}`, () => c.run());
}

test("a database from before receipts gains them, and its pending pieces are still delivered", async () => {
  const database = temporaryDatabase();
  // The table as the first outbound-durable created it, with no schema version, and a piece waiting.
  const old = new DatabaseSync(database);
  old.exec(`CREATE TABLE outbound_pieces (
    seq INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, channel TEXT NOT NULL, conversation_key TEXT NOT NULL,
    text TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL, possible_duplicate INTEGER NOT NULL DEFAULT 0, platform_message_id TEXT,
    last_error TEXT, created_at INTEGER NOT NULL, settled_at INTEGER)`);
  const clock = createManualClock();
  old.prepare("INSERT INTO outbound_pieces (key, channel, conversation_key, text, state, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)").run(
    "s1:r1#0",
    "chat",
    "chat:1",
    "waiting since before the upgrade",
    clock.now(),
    clock.now(),
  );
  old.close();

  const outbox = await openOutbox(database, clock);
  try {
    await until(() => outbox.delivered.has("s1:r1#0"), "the old piece delivered");
    const page = await outbox.queue.receipts.read(undefined, 10);
    expect(page.items.map((i) => [i.fact.idempotencyKey, i.fact.index, i.fact.outcome.kind])).toEqual([["s1:r1", 0, "delivered"]]);
  } finally {
    await outbox.app.stop();
  }
  const check = new DatabaseSync(database);
  expect(check.prepare("SELECT value FROM outbound_meta WHERE name = 'schema_version'").get()).toEqual({ value: SCHEMA_VERSION });
  check.close();
});

test("two processes migrating at once: the one that waited for the lock finds the schema done", async () => {
  const database = temporaryDatabase();
  const first = openTestDatabase(database);
  const second = openTestDatabase(database);
  try {
    // The second process migrates just before the first's transaction takes the lock.
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
    expect(await first.database.query("SELECT value FROM outbound_meta WHERE name = 'schema_version'")).toEqual([{ value: SCHEMA_VERSION }]);
  } finally {
    await first.close();
    await second.close();
  }
});

test("a database written by a newer outbox is refused at start", async () => {
  const database = temporaryDatabase();
  const newer = new DatabaseSync(database);
  newer.exec("CREATE TABLE outbound_meta (name TEXT PRIMARY KEY, value INTEGER NOT NULL)");
  newer.prepare("INSERT INTO outbound_meta (name, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION + 1);
  newer.close();
  const failure = await openOutbox(database, createManualClock()).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  // The app says which component failed; the component's own reason is the cause.
  expect(String((failure as Error).cause)).toMatch(/newer than this component/);
});
