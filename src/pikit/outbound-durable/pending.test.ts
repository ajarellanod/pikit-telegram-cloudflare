/**
 * outbound-durable's `pending`: what the queue suite does not check because it is this component's
 * own. A piece left `sending` by a process that died, a long failure cut short, and its page sizes.
 */

import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, PENDING_MAX_PAGE, PENDING_PAGE } from "./store.ts";
import { openTestDatabase } from "./storage.test-support.ts";

const directories: string[] = [];
const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) await db.close();
});
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

async function store() {
  const dir = mkdtempSync(join(tmpdir(), "pikit-outbound-pending-"));
  directories.push(dir);
  const db = openTestDatabase(join(dir, "pikit.db"));
  open.push(db);
  const s = createStore(db.database);
  await s.migrate();
  return s;
}

const piece = (key: string, conversationKey = "chat:1") => ({ key, channel: "chat", conversationKey, text: `the text of ${key}` });

test("a piece the last process died sending is retrying, a possible duplicate, and says why", async () => {
  const s = await store();
  await s.add([piece("m1#0")], 1_000);
  expect(await s.markSending("m1#0")).toBe(true);
  // The process dies here; the next one starts.
  expect(await s.recoverInterrupted()).toBe(1);
  expect((await s.readPending({})).items).toEqual([
    {
      idempotencyKey: "m1",
      index: 0,
      channel: "chat",
      conversationKey: "chat:1",
      state: "retrying",
      attempts: 1,
      nextAttemptAt: 1_000,
      lastError: "the process stopped while sending",
      possibleDuplicate: true,
      storedAt: 1_000,
    },
  ]);
});

test("an idempotency key that holds '#' is split at its last one", async () => {
  const s = await store();
  await s.add([piece("s1:telegram#42#3")], 1);
  const [item] = (await s.readPending({})).items;
  expect([item?.idempotencyKey, item?.index]).toEqual(["s1:telegram#42", 3]);
});

test("a long failure is cut short; the text is never shown", async () => {
  const s = await store();
  await s.add([piece("m1#0")], 1);
  await s.markSending("m1#0");
  await s.retryLater("m1#0", { nextAttemptAt: 5_001, failed: true, possibleDuplicate: false, error: `transient: ${"x".repeat(1_000)}` });
  const [item] = (await s.readPending({})).items;
  expect(item?.lastError?.length).toBe(200);
  expect(item?.lastError?.endsWith("…")).toBe(true);
  expect(item?.nextAttemptAt).toBe(5_001);
  expect(JSON.stringify(item)).not.toContain("the text of");
});

test("settled pieces are not pending", async () => {
  const s = await store();
  await s.add([piece("m1#0"), piece("m2#0", "chat:2")], 1);
  await s.markSending("m1#0");
  const [head] = await s.heads();
  if (head === undefined) throw new Error("no head");
  await s.markDelivered(head, 1, "p1", 2);
  const second = (await s.heads()).find((p) => p.key === "m2#0");
  if (second === undefined) throw new Error("no second head");
  await s.abandon(second, 0, "permanent: the chat is gone", 2);
  expect((await s.readPending({})).items).toEqual([]);
});

test(`a page holds ${PENDING_PAGE} by default and at most ${PENDING_MAX_PAGE}; a bad limit or cursor rejects`, async () => {
  const s = await store();
  await s.add(
    Array.from({ length: PENDING_MAX_PAGE + 1 }, (_, i) => piece(`m${i}#0`, `chat:${i}`)),
    1,
  );
  const first = await s.readPending({});
  expect(first.items.length).toBe(PENDING_PAGE);
  expect(first.next).toBeDefined();
  const most = await s.readPending({ limit: 10_000 });
  expect(most.items.length).toBe(PENDING_MAX_PAGE);
  const rest = await s.readPending({ limit: 10_000, ...(most.next !== undefined && { cursor: most.next }) });
  expect(rest.items.map((p) => p.idempotencyKey)).toEqual([`m${PENDING_MAX_PAGE}`]);
  expect(rest.next).toBeUndefined();
  for (const limit of [0, -1, 1.5]) await expect(s.readPending({ limit })).rejects.toThrow(/positive integer/);
  await expect(s.readPending({ cursor: "abc" })).rejects.toThrow(/not a cursor/);
});
