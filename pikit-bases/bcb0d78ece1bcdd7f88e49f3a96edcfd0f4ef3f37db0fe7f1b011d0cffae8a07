/**
 * At start, resume the conversations holding a message nobody answered (SPEC P5), with
 * `agent.submissions` installed. The platform was told "received" (Telegram will not send the message
 * again), the process died, and without this the user would wait until they write again.
 *
 * Each conversation is opened as a new message would open it: a run the dead process left open is
 * resumed, a message waiting in Pi's inbox gets a run, and a run that ended without its end recorded is
 * settled from the session (`recover`, in the adapter). A few at a time, in the background: start does
 * not wait for them, and stop aborts what has not started. With `wakeups`, the handler that drives the
 * runs calls this at each run instead, skipping what its App drives already (`index.ts`).
 *
 * A message nothing can answer is abandoned (`runtime.abandon`): its channel tells the user to send it
 * again, and it stops being retried at every start. At once when its agent or session is gone
 * (`recover` does it); and when its conversation's oldest pending message is older than
 * `abandonAfterMs` (runtime-pi's `abandonPendingAfterHours`), for the messages resuming did not
 * answer: no run and no inbox entry holds them, or the conversation fails to resume.
 */

import type { AppContext } from "@pikit/core";
import type { AgentSubmissions, ConversationRef } from "@pikit/contracts";
import type { PiRuntime } from "@pikit/pi-adapter";

/** Conversations resumed at once: each may run the model, and a restart should not flood the provider. */
export const RESUME_AT_ONCE = 4;

export interface ResumeOptions {
  /** How old a conversation's oldest pending message may be before what resuming leaves is abandoned. */
  abandonAfterMs: number;
  /** Conversations left alone this time: ones this worker drives already, or whose run waits for a retry. */
  skip?(conversation: ConversationRef): boolean;
}

/** Resumes every pending conversation; `ctx`'s cancellation stops taking new ones. Never rejects. */
export async function resumePending(runtime: PiRuntime, submissions: AgentSubmissions, ctx: AppContext, options: ResumeOptions): Promise<void> {
  const logger = ctx.logger;
  let pending: Awaited<ReturnType<AgentSubmissions["pending"]>> | undefined;
  try {
    // Bounded by `ctx`: a provider that never answers must not hold `stop`, which waits for this task.
    pending = await untilAborted(submissions.pending(ctx), ctx.abortSignal);
  } catch (error) {
    logger.error("runtime-pi: could not read the conversations with unanswered messages; they resume when they get a new one", { error: String(error) });
    return;
  }
  if (pending !== undefined && options.skip !== undefined) pending = pending.filter((p) => !options.skip?.(p.conversation));
  if (pending === undefined || pending.length === 0) return;
  const messages = pending.reduce((sum, p) => sum + p.requestIds.length, 0);
  logger.info("runtime-pi: resuming conversations with unanswered messages", { conversations: pending.length, messages });

  const stopped = (): boolean => ctx.abortSignal?.aborted === true;
  const list = pending;
  let next = 0;
  let failed = 0;
  const abandonBefore = ctx.clock.now() - options.abandonAfterMs;
  const worker = async (): Promise<void> => {
    while (next < list.length && !stopped()) {
      const { conversation, requestIds, oldestAdmittedAt } = list[next++] as (typeof list)[number];
      const expired = oldestAdmittedAt < abandonBefore;
      try {
        await runtime.recover(conversation, requestIds, ctx);
      } catch (error) {
        if (stopped()) return;
        if (!expired) failed++;
        logger.error(
          expired
            ? "runtime-pi: a conversation with unanswered messages could not be resumed; they waited too long and are abandoned"
            : "runtime-pi: a conversation with unanswered messages could not be resumed; it is tried again at the next start",
          { conversation: conversation.key, requests: requestIds, error: error instanceof Error ? error.message : String(error) },
        );
      }
      if (!expired || stopped()) continue;
      // Only those still pending are abandoned: the ones resuming answered are settled by now.
      await runtime.abandon(conversation, requestIds, "unanswered_too_long", ctx).catch((error: unknown) => {
        failed++;
        logger.error("runtime-pi: abandoning messages that waited too long failed; they are tried again at the next start", {
          conversation: conversation.key,
          requests: requestIds,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESUME_AT_ONCE, list.length) }, worker));
  if (stopped()) {
    logger.info("runtime-pi: stopped resuming conversations; the rest resume at the next start", { started: next, of: list.length });
    return;
  }
  logger.info("runtime-pi: resumed the conversations with unanswered messages", { conversations: list.length, failed });
}

/** `work`'s value, or `undefined` once `signal` aborts first. A late rejection of `work` is swallowed. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T | undefined> {
  if (signal === undefined) return work;
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.resolve(undefined);
  }
  return new Promise<T | undefined>((resolve, reject) => {
    const onAbort = () => {
      work.catch(() => {});
      resolve(undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
