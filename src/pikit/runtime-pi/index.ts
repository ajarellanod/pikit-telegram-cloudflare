/**
 * runtime-pi: the agent runtime (SPEC §6). Pi runs the agent; this component wires it into the app.
 *
 * It provides `agent.runtime` and uses:
 * - `sessions.store`: where each conversation's Pi session lives;
 * - `agent.definition`: your agents, one per name (a project component provides them);
 * - `model.provider`: the model providers your agents name as `provider/modelId`;
 * - `agent.tool`: the installed tools (`tool-*` components) that agents name in their `tools`;
 * - `agent.extension`: the installed Pi extensions that agents name in their `extensions`;
 * - `model.credentials`, if installed: where the providers' credentials live. Without it, providers
 *   read only their environment variables (`ANTHROPIC_API_KEY`).
 * - `agent.submissions`, if installed (`submissions-sql`): where each admitted message and each run's
 *   end are recorded. At start, the conversations holding a message nobody answered are resumed in the
 *   background (`resume.ts`), or by a wakeup with `wakeups`, with no new message needed; channels
 *   deliver answers from its feed.
 *   Messages that can never be answered are abandoned, and their senders told: at once when their
 *   agent or session is gone, and after `abandonPendingAfterHours` when resuming did not answer them.
 * - `wakeups`, if installed: runs are driven inside wakeups, in slices (SPEC §4.1, C4), for a host
 *   that keeps running only while an event is in progress (a Durable Object). See `createDriver` below.
 *
 * Everything that talks to Pi is in `@pikit/pi-adapter`, an npm dependency pinned with Pi: it
 * changes when Pi changes, and this file does not. What is here is the wiring, which is yours to
 * edit: which capabilities the runtime reads, and what it refuses to start without.
 *
 * Delivery: `dispatch` resolves once the message is durable in the conversation's session, and in
 * `agent.submissions` when installed (the point where a channel may acknowledge it); the answer
 * arrives as `agent.settled`, also for a run resumed after a crash. At-least-once: a crash can repeat
 * an answer, never lose an accepted message. Without `agent.submissions`, a crash leaves a run for the
 * next message to that conversation to resume, and an answer that ends while its channel is stopped
 * reaches nobody but the session.
 */

import { type AppContext, BACKGROUND_CONTEXT, defineComponent, withAbortSignal } from "@pikit/core";
import { type AgentRuntime, type AgentSubmissions, type ConversationRef, type Wakeups } from "@pikit/contracts";
import { createPiRuntime, type HarnessHook, modelsFrom, type PiExtension, type PiRuntime } from "@pikit/pi-adapter";
import Type from "typebox";
import { resumePending, type ResumeOptions } from "./resume.ts";

const Config = Type.Object({
  /**
   * With `agent.submissions`: how long, in hours, a conversation's oldest pending message may wait
   * before the ones still unanswered after resuming it at start are abandoned (their channel tells the
   * user to send them again) instead of being retried at every start. At least 1: a message must
   * survive a deploy and the run that answers it.
   */
  abandonPendingAfterHours: Type.Integer({
    minimum: 1,
    default: 72,
    description: "Hours after which messages still unanswered at start are abandoned, and their senders told. At least 1.",
  }),
});

/** The wakeup handler that drives this worker's runs, with `wakeups` installed. */
export const DRIVE = "runtime-pi.drive";

export interface RuntimePiOptions {
  /**
   * Pi extensions, unmodified, for every agent: `createRuntimePi({ extensions: [permissionGate] })`
   * in `pikit.config.ts`. Each conversation loads them when it opens, as Pi loads them per session,
   * then the extensions its agent names (`agent.extension`). There is no terminal UI: `ctx.hasUI` is
   * false and `ctx.ui.*` does nothing (SPEC §6.2b).
   */
  extensions?: readonly PiExtension[];
  /** Attach Pi hooks to each conversation's harness when it opens (tests). */
  onHarness?: HarnessHook;
}

export function createRuntimePi(options: RuntimePiOptions = {}) {
  return defineComponent({
    name: "runtime-pi",
    config: Config,
    setup(pikit, config) {
      const sessions = pikit.use("sessions.store");
      const agents = pikit.useKeyed("agent.definition");
      const providers = pikit.useKeyed("model.provider");
      const credentials = pikit.useOptional("model.credentials");
      const tools = pikit.useKeyed("agent.tool");
      const extensions = pikit.useKeyed("agent.extension");
      // Optional: with it, admitted messages and run ends are recorded, and resumed at start.
      const submissions = pikit.useOptional("agent.submissions");
      // Optional: with it, runs are driven inside wakeups, in slices, instead of in the background.
      const wakeupsHandle = pikit.useOptional("wakeups");

      // Created in start, when the capabilities can be read; consumers start after this component.
      let runtime: PiRuntime | undefined;
      /** The resumption started by `start` without `wakeups`, which `stop` cancels and waits for. */
      let resuming: { controller: AbortController; done: Promise<void> } | undefined;
      /** With `wakeups`: the driving of this App's runs, from start to stop. */
      let driver: Driver | undefined;
      const current = (): PiRuntime => {
        if (runtime === undefined) throw new Error("runtime-pi: agent.runtime used while the app is not running");
        return runtime;
      };
      /** After a call that may have left a run going: with `wakeups`, a wakeup drives it (the call's event may end first). */
      const wakeFor = async (conversation: ConversationRef, ctx: AppContext): Promise<void> => {
        const going = runtime;
        if (driver !== undefined && going !== undefined && going.holds(conversation)) await driver.wake(ctx.clock.now(), ctx);
      };
      const agentRuntime: AgentRuntime = {
        async dispatch(request, ctx) {
          const admission = await current().dispatch(request, ctx);
          // Asked before the dispatch resolves: a channel acknowledges its platform only once a wakeup
          // will drive the run. If asking fails, so does the dispatch; the platform sends it again.
          await wakeFor(request.conversation, ctx);
          return admission;
        },
        abort: (conversation, ctx) => current().abort(conversation, ctx),
        async resume(conversation, ctx) {
          await current().resume(conversation, ctx);
          await wakeFor(conversation, ctx);
        },
      };
      pikit.provide("agent.runtime", agentRuntime);

      return {
        async start(ctx) {
          const models = modelsFrom(
            providers.keys().flatMap((key) => providers.get(key) ?? []),
            { credentials: credentials.get() },
          );
          // Fail at start, not at the first message: an agent that cannot run is a broken deployment.
          if (agents.keys().length === 0) throw new Error("runtime-pi: no agent.definition is provided");
          for (const key of tools.keys()) {
            const tool = tools.get(key);
            if (tool !== undefined && tool.name !== key) {
              throw new Error(`runtime-pi: the agent.tool "${key}" is a tool named "${tool.name}"; a tool is provided under its own name`);
            }
          }
          for (const name of agents.keys()) {
            for (const tool of agents.get(name)?.tools ?? []) {
              if (typeof tool === "string" && tools.get(tool) === undefined) {
                throw new Error(`runtime-pi: agent "${name}" names the tool "${tool}", which no agent.tool provides (install tool-${tool}?)`);
              }
            }
            for (const extension of agents.get(name)?.extensions ?? []) {
              if (extensions.get(extension) === undefined) {
                throw new Error(`runtime-pi: agent "${name}" names the extension "${extension}", which no agent.extension provides`);
              }
            }
            const model = agents.get(name)?.model ?? "";
            const slash = model.indexOf("/");
            if (models.getModel(model.slice(0, slash), model.slice(slash + 1)) === undefined) {
              throw new Error(`runtime-pi: agent "${name}" names model "${model}", which no model.provider provides`);
            }
            // Checked without a network call or an OAuth refresh: is anything configured at all?
            const provider = model.slice(0, slash);
            if ((await models.checkAuth(provider, ctx.abortSignal ? { signal: ctx.abortSignal } : {})) === undefined) {
              throw new Error(
                `runtime-pi: agent "${name}" uses provider "${provider}", which has no credentials: ` +
                  "log in to store one in model.credentials, or set the provider's API key in the environment",
              );
            }
          }
          const recorded = submissions.get();
          const wakeups = wakeupsHandle.get();
          // Runs outlive the calls that admit them; never keep start's context (its deadline).
          const background = ctx.derive(() => BACKGROUND_CONTEXT);
          const resumeOptions = { abandonAfterMs: config.abandonPendingAfterHours * 60 * 60 * 1_000 };
          const drives = wakeups === undefined ? undefined : createDriver(wakeups, background, resumeOptions, recorded);
          const created = createPiRuntime({
            sessions: sessions.get(),
            agent: (name) => agents.get(name),
            tool: (name) => tools.get(name),
            extension: (name) => extensions.get(name),
            models,
            events: background,
            ...(options.onHarness !== undefined && { onHarness: options.onHarness }),
            ...(options.extensions !== undefined && { extensions: options.extensions }),
            ...(recorded !== undefined && { submissions: recorded }),
            ...(drives !== undefined && { retryAt: drives.retryAt }),
          });
          runtime = created;
          if (drives !== undefined) {
            drives.attach(created);
            driver = drives;
            // At start, the conversations agent.submissions holds pending are resumed by a wakeup, not
            // by a promise left running: it waits for their runs, in slices.
            if (recorded !== undefined) {
              await drives.wake(ctx.clock.now(), ctx).catch((error: unknown) => {
                ctx.logger.error("runtime-pi: could not ask for a wakeup to resume the conversations with unanswered messages; they resume at the next one", {
                  error: error instanceof Error ? error.message : String(error),
                });
              });
            }
          } else if (recorded !== undefined) {
            // In the background: start does not wait for runs to resume, and stop cancels it.
            const controller = new AbortController();
            const done = resumePending(created, recorded, background.derive((inner) => withAbortSignal(controller.signal, inner)), resumeOptions);
            resuming = { controller, done };
          }
        },
        async stop(ctx) {
          // Runs in progress stay open in their sessions; the next process resumes them.
          const stopping = runtime;
          runtime = undefined;
          const resumed = resuming;
          resuming = undefined;
          resumed?.controller.abort(new Error("runtime-pi: stopping"));
          // A handler still waiting stops now, and asks again for what remains: the next App drives it.
          driver?.stop();
          driver = undefined;
          await stopping?.close(ctx);
          // Settles once `close` ended the conversations it opened; bounded by the stop deadline all the same.
          if (resumed !== undefined) await Promise.race([resumed.done, aborted(ctx.abortSignal)]);
        },
      };
    },
  });
}

/** The driving of one App's runs by wakeups (SPEC §4.1, C4). */
interface Driver {
  /** Asks for the handler at or after `time`, unless a request as soon or sooner is already made. */
  wake(time: number, ctx: AppContext): Promise<void>;
  /** The adapter's `retryAt`: a run waiting out Pi's backoff is continued by a wakeup. */
  retryAt(conversation: ConversationRef, notBefore: number, ctx: AppContext): Promise<void>;
  /** Registers the handler for `runtime`. */
  attach(runtime: PiRuntime): void;
  /** Cancels the handler's run in progress; nothing is registered after. */
  stop(): void;
}

/**
 * With `wakeups`, every run is driven inside a run of the handler `runtime-pi.drive`, since a promise
 * left running after its event may be killed (SPEC §4.1, C4). Whatever may leave a run going (a
 * dispatch, a resume, start with pending messages, a retry wait) asks for the handler. The handler:
 * 1. resumes the conversations whose retry wait is due;
 * 2. with `agent.submissions`, resumes the ones it holds pending that this worker does not drive
 *    (a run an evicted object left open, a message it never answered: as at start, `resume.ts`);
 * 3. waits until this worker drives no run, or its context is cancelled (the provider's slice deadline,
 *    or the App stopping);
 * 4. asks again at once if runs are still going, or for the earliest retry wait left.
 * A request carries nothing: what to do is read from the session and `agent.submissions` each time, so
 * a handler that runs twice, or late, or after the object was evicted, does the right thing.
 */
function createDriver(wakeups: Wakeups, background: AppContext, resumeOptions: ResumeOptions, submissions: AgentSubmissions | undefined): Driver {
  /** The earliest time asked for and not yet taken by a run of the handler, in this App. */
  let requested: number | undefined;
  /** Conversations whose run waits for a retry, and when it is due. In memory: after a restart, `agent.submissions` finds them. */
  const retries = new Map<string, { conversation: ConversationRef; at: number }>();
  /** Cancels the handler's run in progress when the App stops. */
  const stopping = new AbortController();
  const logger = background.logger;

  const wake = async (time: number, ctx: AppContext): Promise<void> => {
    // One request per name, and `at` replaces it: a later time must never push back a sooner one.
    if (requested !== undefined && requested <= time) return;
    requested = time;
    try {
      await wakeups.at(DRIVE, time, ctx);
    } catch (error) {
      if (requested === time) requested = undefined;
      throw error;
    }
  };
  /** Asks from the handler, whose context may be cancelled already: with the App's, and never rejects. */
  const wakeLater = (time: number): Promise<void> =>
    wake(time, background).catch((error: unknown) => {
      logger.error("runtime-pi: could not ask for a wakeup; runs still open resume at the next one, or at the next start", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  const handler = (runtime: PiRuntime) => async (handlerCtx: AppContext): Promise<void> => {
    // This run took the request: whatever is asked from now on stands after it.
    requested = undefined;
    const signal = handlerCtx.abortSignal === undefined ? stopping.signal : AbortSignal.any([handlerCtx.abortSignal, stopping.signal]);
    const ctx = handlerCtx.derive((inner) => withAbortSignal(signal, inner));
    const now = ctx.clock.now();
    for (const [sessionId, { conversation, at }] of retries) {
      if (at > now) continue;
      retries.delete(sessionId);
      await runtime.resume(conversation, ctx).catch((error: unknown) => {
        if (signal.aborted) return;
        logger.error("runtime-pi: a run waiting for a retry could not be resumed; it resumes when its conversation opens again", {
          conversation: conversation.key,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    if (submissions !== undefined && !signal.aborted) {
      await resumePending(runtime, submissions, ctx, {
        ...resumeOptions,
        // What this worker drives needs no resuming, and a run waiting for its retry is not due yet.
        skip: (conversation) => runtime.holds(conversation) || (retries.get(conversation.sessionId)?.at ?? now) > now,
      });
    }
    const idle = await runtime.whenIdle(ctx);
    if (!idle) {
      // The slice ended (or the App is stopping) with runs going: the next run of the handler, in this
      // App or the next one, picks them up, from the session if this one is gone.
      await wakeLater(background.clock.now());
      return;
    }
    const next = Math.min(...[...retries.values()].map((retry) => retry.at));
    if (Number.isFinite(next)) await wakeLater(next);
  };

  return {
    wake,
    async retryAt(conversation, notBefore, ctx) {
      retries.set(conversation.sessionId, { conversation, at: notBefore });
      await wake(notBefore, ctx);
    },
    attach(runtime) {
      wakeups.handle(DRIVE, handler(runtime));
    },
    stop() {
      stopping.abort(new Error("runtime-pi: stopping"));
    },
  };
}

/** Resolves when `signal` aborts; never, without one. */
function aborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal === undefined) return;
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export default createRuntimePi();
