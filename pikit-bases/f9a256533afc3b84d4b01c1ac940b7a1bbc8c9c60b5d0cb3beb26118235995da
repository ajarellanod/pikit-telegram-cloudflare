/**
 * `resumePending` (resume.ts) with a runtime and `agent.submissions` standing in for the adapter's:
 * which conversations it recovers, when it abandons (`abandonPendingAfterHours`), and that it never
 * holds `stop`. The adapter's own tests check what `recover` and `abandon` do in pi-durable.
 */

import { expect, test } from "bun:test";
import { defineApp, silentLogger, withAbortSignal } from "@pikit/core";
import type { AgentSubmissions, ConversationRef, PendingConversation } from "@pikit/contracts";
import { createManualClock } from "@pikit/core/testing";
import type { DurableRuntime } from "@pikit/pi-adapter";
import { resumePending } from "./resume.ts";

const HOUR = 60 * 60 * 1_000;
const ref = (key: string): ConversationRef => ({ key, agent: "scripted", conversationId: key.slice(5) });

/** A runtime whose `recover` fails for the conversations in `failing`, recording what it is asked. */
function standIn(pending: () => Promise<PendingConversation[]>, failing: Set<string>) {
  const calls: string[] = [];
  const runtime = {
    async recover(conversation: ConversationRef) {
      calls.push(`recover ${conversation.key}`);
      if (failing.has(conversation.key)) throw new Error("it cannot resume");
    },
    async abandon(conversation: ConversationRef, requestIds: readonly string[], reason: string) {
      calls.push(`abandon ${conversation.key} ${requestIds.join(",")} ${reason}`);
    },
  } as unknown as DurableRuntime;
  const submissions = { pending } as unknown as AgentSubmissions;
  return { runtime, submissions, calls };
}

test("a conversation whose oldest message waited past abandonAfterMs is abandoned after resuming; a younger one is resumed only", async () => {
  const clock = createManualClock(10 * HOUR);
  const ctx = (await defineApp({ components: [], logger: silentLogger, clock }).create()).context();
  const { runtime, submissions, calls } = standIn(
    async () => [
      { conversation: ref("test:1"), requestIds: ["r-old"], oldestAdmittedAt: 10 * HOUR - 2 * HOUR },
      { conversation: ref("test:2"), requestIds: ["r-young"], oldestAdmittedAt: 10 * HOUR - 10 },
    ],
    new Set(["test:1", "test:2"]),
  );

  await resumePending(runtime, submissions, ctx, { abandonAfterMs: HOUR });

  expect(calls.sort()).toEqual(["abandon test:1 r-old unanswered_too_long", "recover test:1", "recover test:2"]);
});

test("a pending() that never answers does not hold a cancelled resumption", async () => {
  const controller = new AbortController();
  const app = await defineApp({ components: [], logger: silentLogger }).create();
  const ctx = app.context().derive((inner) => withAbortSignal(controller.signal, inner));
  const { runtime, submissions, calls } = standIn(() => new Promise(() => {}), new Set());

  const done = resumePending(runtime, submissions, ctx, { abandonAfterMs: HOUR }).then(() => "done");
  controller.abort(new Error("stopping"));

  expect(await Promise.race([done, Bun.sleep(2_000).then(() => "still waiting")])).toBe("done");
  expect(calls).toEqual([]);
});
