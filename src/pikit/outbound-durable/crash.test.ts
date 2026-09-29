/**
 * The process dies during a send (SIGKILL: no stop, no cleanup), and the next process delivers the
 * answer anyway: the piece in flight as a possible duplicate, the one behind it as new (SPEC §5).
 */

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppEvents, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { type OutboundPiece, type OutboundQueue } from "@pikit/contracts";
import outboundDurable from "./index.ts";
import { testStorage } from "./storage.test-support.ts";

const dir = mkdtempSync(join(tmpdir(), "pikit-outbound-crash-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("an answer whose process was killed during its send is delivered by the next process", async () => {
  const database = join(dir, "pikit.db");
  const marker = join(dir, "sending");
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "crash.test-support.ts"), database, marker], { stdout: "pipe", stderr: "pipe" });
  const deadline = Date.now() + 15_000;
  while (!existsSync(marker)) {
    if (child.exitCode !== null) throw new Error(`the fixture exited early: ${await new Response(child.stderr).text()}`);
    if (Date.now() > deadline) throw new Error("the fixture never started sending");
    await Bun.sleep(20);
  }
  child.kill("SIGKILL");
  expect(await child.exited).not.toBe(0);

  const sent: OutboundPiece[] = [];
  const delivered: AppEvents["outbound.delivered"][] = [];
  let queue: OutboundQueue | undefined;
  const channel = defineComponent({
    name: "next-process-channel",
    setup(pikit) {
      const handle = pikit.use("outbound.queue");
      pikit.on("outbound.delivered", (event) => void delivered.push(event));
      return { start: () => void (queue = handle.get()) };
    },
  });
  const app = await defineApp({ components: [testStorage(database), outboundDurable, channel], logger: silentLogger }).create();
  await app.start();
  try {
    queue?.attach("chat", {
      idempotent: false,
      split: (text) => text.split("|"),
      send: async (piece) => {
        sent.push(piece);
        return { platformMessageId: String(sent.length) };
      },
    });
    const until = Date.now() + 5_000;
    while (delivered.length < 2 && Date.now() < until) await Bun.sleep(10);
    expect(sent.map((p) => [p.key, p.text, p.possibleDuplicate])).toEqual([
      ["session-1:run-1#0", "first piece", true],
      ["session-1:run-1#1", "second piece", false],
    ]);
  } finally {
    await app.stop();
  }
}, 30_000);
