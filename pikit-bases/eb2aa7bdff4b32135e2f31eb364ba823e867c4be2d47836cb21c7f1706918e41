/**
 * The process killed after each of outbound-durable's commits in turn (`createConvergenceConformance`): whatever the
 * point, the next process delivers every piece, in order per conversation, with exactly one receipt
 * each, and every piece sent more than once is marked a possible duplicate. `crash.test.ts` does the
 * same for one point with a real SIGKILL.
 */

import { afterAll, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineComponent } from "@pikit/core";
import { type OutboundQueue } from "@pikit/contracts";
import { type ConvergenceFixture, createConvergenceConformance } from "@pikit/contracts/testing";
import outboundDurable from "./index.ts";
import { BACKOFF_MS } from "./queue.ts";
import { openTestDatabase } from "./storage.test-support.ts";

const directories: string[] = [];
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

const PIECES = ["m1#0", "m1#1", "m2#0"];

function fixture(): ConvergenceFixture {
  const dir = mkdtempSync(join(tmpdir(), "pikit-outbound-convergence-"));
  directories.push(dir);
  const records = openTestDatabase(join(dir, "pikit.db"));
  /** What the platform received, across every process. */
  const sends: { key: string; possibleDuplicate: boolean }[] = [];
  let queue: OutboundQueue | undefined;

  const allReceipts = async (q: OutboundQueue) => (await q.receipts.read(undefined, 100)).items.map((i) => i.fact);

  return {
    database: records.database,
    // After a storage failure, the world waits out the queue's first backoff before it looks again.
    retryAfterMs: BACKOFF_MS[0],
    components: (life) => [
      outboundDurable,
      defineComponent({
        name: "platform",
        setup(pikit) {
          const handle = pikit.use("outbound.queue");
          return {
            start() {
              queue = handle.get();
              queue.attach("chat", {
                idempotent: false,
                split: (text) => text.split("|"),
                async send(piece) {
                  // A dead process reaches no platform.
                  if (life.dead) throw new Error("the process is dead");
                  sends.push({ key: piece.key, possibleDuplicate: piece.possibleDuplicate });
                  return { platformMessageId: `p${sends.length}` };
                },
              });
            },
          };
        },
      }),
    ],
    async scenario({ signal }) {
      const q = queue as OutboundQueue;
      await q.enqueue({ idempotencyKey: "m1", channel: "chat", conversationKey: "chat:1", text: "one|two" });
      await q.enqueue({ idempotencyKey: "m2", channel: "chat", conversationKey: "chat:2", text: "three" });
      const deadline = Date.now() + 3_000;
      while ((await allReceipts(q)).length < PIECES.length) {
        if (signal.aborted) throw signal.reason;
        if (Date.now() > deadline) throw new Error("the pieces were not all settled");
        await Bun.sleep(2);
      }
    },
    async invariant() {
      const receipts = await allReceipts(queue as OutboundQueue);
      const keys = receipts.map((r) => `${r.idempotencyKey}#${r.index}`).sort();
      if (keys.join() !== PIECES.join()) throw new Error(`receipts for ${JSON.stringify(keys)}, expected one for each of ${JSON.stringify(PIECES)}`);
      if (receipts.some((r) => r.outcome.kind !== "delivered")) throw new Error(`a piece was not delivered: ${JSON.stringify(receipts)}`);
      for (const key of PIECES) {
        const mine = sends.filter((s) => s.key === key);
        if (mine.length === 0) throw new Error(`${key} never reached the platform`);
        if (mine.slice(1).some((s) => !s.possibleDuplicate)) throw new Error(`${key} was sent again without the possible-duplicate mark: ${JSON.stringify(mine)}`);
      }
      const order = sends.map((s) => s.key);
      if (order.indexOf("m1#1") < order.lastIndexOf("m1#0")) throw new Error(`chat:1's pieces went out of order: ${JSON.stringify(order)}`);
    },
    dispose: () => records.close(),
  };
}

for (const c of createConvergenceConformance(fixture)) {
  // Known bug: send and markDelivered share one try/catch in queue.ts. A failed
  // write of a delivery (commits 13, 14 and 16 of 18, one per piece) is taken for a failed send: the
  // piece is sent again after the backoff without the possible-duplicate mark. `failing` flips to a
  // failure once queue.ts is fixed: then this line goes.
  const known = c.name.startsWith("a storage failure") ? test.failing : test;
  known(`outbound-durable ${c.group}: ${c.name}`, () => c.run(), 60_000);
}
