/**
 * runtime-pi's reopening of pi-durable after a storage error (`reopen.ts`): the backoff's waits, and a
 * server's reopener retrying an open that fails. The runtime that calls them is tested in
 * runtime-pi.test.ts.
 */

import { expect, test } from "bun:test";
import { defineApp, type Logger, silentLogger } from "@pikit/core";
import { createReopenBackoff, createReopener, REOPEN_FIRST_MS, REOPEN_MAX_MS, REOPEN_QUIET_MS } from "./reopen.ts";

test("the backoff doubles for each storage error in a row, up to its longest wait", () => {
  let now = 0;
  const backoff = createReopenBackoff(() => now);
  const waits: number[] = [];
  for (let i = 0; i < 12; i++) {
    const wait = backoff();
    waits.push(wait);
    now += wait;
  }
  expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, REOPEN_MAX_MS, REOPEN_MAX_MS, REOPEN_MAX_MS]);
  expect(waits[0]).toBe(REOPEN_FIRST_MS);
});

test("an open that works between two errors does not start the waits over; a quiet spell as long as REOPEN_QUIET_MS does", () => {
  let now = 0;
  const backoff = createReopenBackoff(() => now);
  backoff();
  now += 1_000;
  // Opened at once, failed again a second later: still in a row.
  now += 1_000;
  expect(backoff()).toBe(2_000);
  // The longest wait is not a quiet spell.
  now += REOPEN_MAX_MS;
  expect(backoff()).toBe(4_000);
  now += REOPEN_QUIET_MS - 1;
  expect(backoff()).toBe(8_000);
  now += REOPEN_QUIET_MS;
  expect(backoff()).toBe(REOPEN_FIRST_MS);
});

test("a server's reopener opens after the backoff's wait, tries again after an open that failed, and stops when stopped", async () => {
  const errors: string[] = [];
  const logger: Logger = { ...silentLogger, error: (message) => void errors.push(message) };
  const ctx = (await defineApp({ components: [], logger }).create()).context();
  const waits: number[] = [];
  const backoff = () => (waits.push(waits.length + 1), 5);
  let opens = 0;
  let opened!: () => void;
  const done = new Promise<void>((resolve) => (opened = resolve));
  // The storage is down for the first two opens.
  const reopener = createReopener(
    async () => {
      opens++;
      if (opens <= 2) throw new Error("the storage is unreachable");
      opened();
    },
    ctx,
    backoff,
  );

  reopener.failed();
  await done;

  expect(opens).toBe(3);
  // One wait for the error that closed pi-durable, one for each failed open.
  expect(waits).toEqual([1, 2, 3]);
  expect(errors).toEqual([
    "runtime-pi: opening pi-durable again after a storage error failed; it tries again later",
    "runtime-pi: opening pi-durable again after a storage error failed; it tries again later",
  ]);

  reopener.failed();
  reopener.stop();
  await Bun.sleep(30);
  expect(opens).toBe(3);
});

test("two failures before the wait ends ask for one open", async () => {
  const ctx = (await defineApp({ components: [], logger: silentLogger }).create()).context();
  let opens = 0;
  const reopener = createReopener(async () => void opens++, ctx, () => 10);
  reopener.failed();
  reopener.failed();
  await Bun.sleep(40);
  expect(opens).toBe(1);
  reopener.stop();
});
