/**
 * runtime-pi: the agent runtime (SPEC P1). Pi (pi-durable) runs the agent; this component wires it
 * into the app.
 *
 * It provides `agent.runtime`, `agent.conversations` (where `conversations.registry` creates the
 * conversation of a new key, or of a reset), and `agent.submissions`: what became of each admitted
 * message, read from pi-durable, and `answers`, the log of every run's end channels deliver from
 * (`runtime_pi_answers`, kept `keepSettledDays`). It also provides `model.complete` (a text from one
 * of the models its agents run on, once: admin-api's conversation titles) and the slash command
 * `/compact` (`agent.command`: pi-durable's manual compaction of the conversation it runs in, with
 * what follows it as the summary's instructions). At start, the conversations holding a message nobody
 * answered are resumed in the background (`resume.ts`), or by a wakeup with `wakeups`, with no new
 * message needed. Messages that can never be answered are abandoned, and their senders told: at once
 * when their agent is gone, and after `abandonPendingAfterHours` when resuming them fails.
 *
 * It uses:
 * - `storage.sql`: where pi-durable keeps every conversation (its tables, unprefixed: one runtime per
 *   database) and the answers log. On a server that is storage-sqlite, in a Cloudflare object storage-do;
 * - `agent.definition`: your agents, one per name (a project component provides them), at most one of
 *   them the steward (`steward: true`, SPEC §6);
 * - `model.provider`: the model providers your agents name as `provider/modelId`;
 * - `agent.tool`: the installed tools (`tool-*` components) that agents name in their `tools`;
 * - `agent.extension`: the installed agent extensions (Pi's `defineExtension`: prompt sections, hooks,
 *   wrappers, durable tasks, tools) that agents name in their `extensions`, each run with the agents
 *   that name it, in that order, after the agent's own tools. Only the agents name them: no extension
 *   applies to every agent by being installed, so a project's agents share one by listing it;
 * - `execution` and `workspace`, if installed: where tools work (each call on its conversation's
 *   workspace when a provider is installed, otherwise on `execution`);
 * - `model.credentials`, if installed: where the providers' credentials live. Without it, providers
 *   read only their environment variables (`ANTHROPIC_API_KEY`).
 * - `secrets`, if installed: where those variables are read first, before the environment (on
 *   Cloudflare, the Worker's secrets, with no `process.env`);
 * - `wakeups`, if installed: runs are driven inside wakeups, in slices (SPEC §4.1, C4), for a host
 *   that keeps running only while an event is in progress (a Durable Object). See `createDriver` below.
 * - `settings`, if installed (settings-store): the agents' live overrides, an operator's system prompt,
 *   model and tools per agent (`overrides.ts`), declared at start and read before every admission, every
 *   resume and compaction, and every run of the driving wakeup; on a server also at start, before what
 *   is pending resumes (in a Durable Object's start it is not: the object cannot call while it starts,
 *   and the first wakeup reads them before it opens anything). What was read last applies until the
 *   next read; one that fails keeps it, logged. Without `settings`, every agent is its definition.
 * - `agent.directory`, if installed (agents-live): the agents that are data, an operator's. A name
 *   `agent.definition` does not have is looked up there, read with the overrides (at every admission,
 *   resume, compaction and driving wakeup) and checked when used, not at start: a model an installed
 *   provider has, installed tools and extensions. A message to an agent that is neither, or to a live
 *   one that does not check, fails its admission with why (`AgentUnavailableError`: for good, so the
 *   key moves to the agent routed now, `admitInbound`); the code's agents are checked at start as before. A live agent gets the overrides as any agent does. Until the directory was read once, the
 *   conversations of an agent it may hold are not resumed (nor abandoned as having no agent).
 *
 * In a Cloudflare object's App (`WORKERS_HOST` has an `object`) the object is one chat: its first
 * conversation is pi-durable's root, and pi-durable's clock is the app's (workerd freezes `Date.now()`).
 *
 * Everything that talks to Pi is in `@pikit/pi-adapter`, an npm dependency pinned with Pi: it
 * changes when Pi changes, and this file does not. What is here is the wiring, which is yours to
 * edit: which capabilities the runtime reads, and what it refuses to start without.
 *
 * Delivery: `dispatch` resolves once the message is durable in pi-durable (the point where a channel
 * may acknowledge it); the answer arrives as `agent.settled`, also for a run resumed after a crash, and
 * in `answers`, where a channel that was stopped finds it. Messages that arrive while a run goes are
 * queued and answered together by the next run; a steer (`whenBusy: "steer"`) joins the run in
 * progress after its tool round instead, and a steer to an idle conversation starts a run, as any
 * message does. At-least-once: a crash can repeat an answer, never lose an accepted message.
 */

import { type AppContext, BACKGROUND_CONTEXT, defineComponent, withAbortSignal } from "@pikit/core";
import {
  type AgentCommand,
  type AgentConversations,
  type AgentDefinition,
  type AgentRuntime,
  type AgentSubmissions,
  AgentUnavailableError,
  type ConversationRef,
  defineAgent,
  type Wakeups,
} from "@pikit/contracts";
import { WORKERS_HOST } from "@pikit/contracts/cloudflare";
import {
  createDurableRuntime,
  createModelComplete,
  createObserver,
  type DurableRuntime,
  type DurableRuntimeOptions,
  type Models,
  modelsFrom,
  nextWakeAtOf,
  parseModelName,
} from "@pikit/pi-adapter";
import Type from "typebox";
import { type AgentOverrides, overridesOf, overridesSchema, withOverride } from "./overrides.ts";
import { resumePending, type ResumeOptions } from "./resume.ts";

const Config = Type.Object({
  /**
   * How long, in hours, a conversation's oldest pending message may wait before the ones still queued
   * when resuming it at start fails are abandoned (their channel tells the user to send them again)
   * instead of being retried at every start. At least 1: a message must survive a deploy and the run
   * that answers it.
   */
  abandonPendingAfterHours: Type.Integer({
    minimum: 1,
    default: 72,
    description: "Hours after which messages still unanswered at start are abandoned, and their senders told. At least 1.",
  }),
  /**
   * How long a run's end is kept in `answers` (and `get` reads it there), in days. At least 1: a channel
   * must be able to read an answer after a deploy. Past it, `get` still answers from pi-durable.
   */
  keepSettledDays: Type.Integer({
    minimum: 1,
    default: 7,
    description: "Days a run's end is kept in agent.submissions' answers feed. At least 1, so answers that ended during a deploy are still delivered.",
  }),
});

/**
 * The tools that work on the environment the runtime builds for each call (`api.env`): pi-durable's
 * coding tools. An agent that names one needs an `execution` (or a `workspace`), or every call fails;
 * start refuses instead. Add the name of a tool of yours that works on `api.env`.
 */
const ENVIRONMENT_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit", "bash"]);

/** The extensions only the steward may name (SPEC §6): never a live agent's, which is never the steward. */
const STEWARD_EXTENSIONS: ReadonlySet<string> = new Set(["pikit-self"]);

/** The wakeup handler that drives this worker's runs, with `wakeups` installed. */
export const DRIVE = "runtime-pi.drive";

export interface RuntimePiOptions {
  /** pi-durable's run policy (retry, compaction, tools), for tests. Default: pi-durable's. */
  settings?: DurableRuntimeOptions["settings"];
}

export function createRuntimePi(options: RuntimePiOptions = {}) {
  return defineComponent({
    name: "runtime-pi",
    config: Config,
    setup(pikit, config) {
      // The App's models, from start (a conversation's title too, through model.complete).
      let models: Models | undefined;
      const sql = pikit.use("storage.sql");
      const agents = pikit.useKeyed("agent.definition");
      const providers = pikit.useKeyed("model.provider");
      const credentials = pikit.useOptional("model.credentials");
      const secrets = pikit.useOptional("secrets");
      const tools = pikit.useKeyed("agent.tool");
      const extensions = pikit.useKeyed("agent.extension");
      const execution = pikit.useOptional("execution");
      const workspace = pikit.useOptional("workspace");
      // Optional: with it, runs are driven inside wakeups, in slices, instead of in the background.
      const wakeupsHandle = pikit.useOptional("wakeups");
      // Optional: the agents' live overrides, an operator's (`overrides.ts`).
      const settings = pikit.useOptional("settings");
      // Optional: the agents that are data (agents-live), for a name no agent.definition has.
      const directory = pikit.useOptional("agent.directory");

      /** Whether an `execution` or a `workspace` is installed: tools that work on files and commands need one. */
      let environment = false;
      /** Why `agent` cannot run in this App (a model, tool or extension nothing provides), or `undefined`. */
      const problemOf = (agent: AgentDefinition): string | undefined => {
        for (const tool of agent.tools ?? []) {
          if (typeof tool === "string" && tools.get(tool) === undefined) {
            return (
              `agent "${agent.name}" names the tool "${tool}", which no agent.tool provides: ` +
              `install the component that provides it (\`pikit doctor\` names it from the registry), or take "${tool}" out of the agent's tools`
            );
          }
          if (typeof tool === "string" && !environment && ENVIRONMENT_TOOLS.has(tool)) {
            return (
              `agent "${agent.name}" names the tool "${tool}", which works on files and commands, and no execution is installed: ` +
              `install one (execution-local on a server, execution-do on Cloudflare), or take "${tool}" out of the agent's tools`
            );
          }
        }
        for (const extension of agent.extensions ?? []) {
          if (extensions.get(extension) === undefined) return `agent "${agent.name}" names the extension "${extension}", which no agent.extension provides`;
        }
        const ref = parseModelName(agent.model);
        if (ref === undefined || models?.getModel(ref.provider, ref.modelId) === undefined) return `agent "${agent.name}" names model "${agent.model}", which no model.provider provides`;
        return undefined;
      };

      /** The live agents read last (`agent.directory`) that can run here, by name; and why the others cannot. */
      let live = new Map<string, AgentDefinition>();
      let liveProblems = new Map<string, string>();
      /** Whether the directory was read in this App: until then, a name the code does not have may be live. */
      let liveRead = false;
      /** Reads the directory again; a failure keeps what was read last. */
      const refreshLive = async (ctx: AppContext): Promise<void> => {
        const source = directory.get();
        if (source === undefined || models === undefined) return;
        try {
          const found = new Map<string, AgentDefinition>();
          const problems = new Map<string, string>();
          for (const agent of await source.list(ctx)) {
            if (agents.get(agent.name) !== undefined) continue;
            let problem: string | undefined;
            const stewards = (agent.extensions ?? []).filter((name) => STEWARD_EXTENSIONS.has(name));
            try {
              const definition = defineAgent({
                name: agent.name,
                model: agent.model,
                ...(agent.systemPrompt !== undefined && { systemPrompt: agent.systemPrompt }),
                ...(agent.tools !== undefined && { tools: agent.tools }),
                ...(agent.extensions !== undefined && { extensions: agent.extensions }),
              });
              // Never the steward (SPEC §6): the data has no such field, and names no steward's extension.
              problem =
                (agent as { steward?: unknown }).steward !== undefined
                  ? `agent "${agent.name}" is marked steward; a live agent never is`
                  : stewards.length > 0
                    ? `agent "${agent.name}" names "${stewards[0]}", which only the steward may name; a live agent never is the steward`
                    : problemOf(definition);
              if (problem === undefined) found.set(agent.name, definition);
            } catch (error) {
              problem = error instanceof Error ? error.message : String(error);
            }
            if (problem !== undefined) problems.set(agent.name, `live ${problem}`);
          }
          live = found;
          liveProblems = problems;
          liveRead = true;
        } catch (error) {
          ctx.logger.warn("runtime-pi: the live agents (agent.directory) could not be read; the ones read last apply", { error: error instanceof Error ? error.message : String(error) });
        }
      };
      /**
       * Throws, saying why, unless `name` is an agent that runs here: the code's, or a live one that
       * checks. For good (`AgentUnavailableError`: `admitInbound` moves the key to the agent routed now)
       * once the directory was read; while it never was (it cannot be read yet), a plain error: the
       * agent may be live, and the message is delivered again.
       */
      const runnable = (name: string): void => {
        if (agents.get(name) !== undefined || live.has(name)) return;
        if (directory.get() !== undefined && !liveRead) {
          throw new Error(`runtime-pi: the live agents (agent.directory) could not be read yet, and "${name}" is no agent.definition: try again`);
        }
        const problem = liveProblems.get(name);
        if (problem !== undefined) throw new AgentUnavailableError(name, `runtime-pi: ${problem}`);
        const known = [...agents.keys(), ...live.keys()].sort().map((each) => `"${each}"`).join(", ") || "none";
        throw new AgentUnavailableError(
          name,
          directory.get() === undefined
            ? `runtime-pi: no agent "${name}": it is no agent.definition (agents: ${known})`
            : `runtime-pi: no agent "${name}": it is no agent.definition, nor a live agent of agent.directory (agents: ${known})`,
        );
      };
      /** While the directory was never read, a conversation of a name the code does not have waits: its agent may be live. */
      const unread = (conversation: ConversationRef): boolean => directory.get() !== undefined && !liveRead && agents.get(conversation.agent) === undefined;

      /** The overrides read last, by agent; none until read. */
      let overrides: AgentOverrides = {};
      let declared = false;
      /** Reads the overrides and the live agents again; a failure keeps the ones read last. */
      const refresh = async (ctx: AppContext): Promise<void> => {
        await refreshLive(ctx);
        const store = settings.get();
        if (store === undefined || !declared) return;
        try {
          overrides = overridesOf(await store.get("runtime-pi", ctx));
        } catch (error) {
          ctx.logger.warn("runtime-pi: the agents' settings could not be read; the ones read last apply", { error: error instanceof Error ? error.message : String(error) });
        }
      };
      /** An agent as it runs now: its definition (the code's, else a live one), with the operator's override over what `prepare` gives. */
      const definition = (name: string) => withOverride(agents.get(name) ?? live.get(name), overrides[name]);

      // Created in start, when the capabilities can be read; consumers start after this component.
      let runtime: DurableRuntime | undefined;
      /** The resumption started by `start` without `wakeups`, which `stop` cancels and waits for. */
      let resuming: { controller: AbortController; done: Promise<void> } | undefined;
      /** With `wakeups`: the driving of this App's runs, from start to stop. */
      let driver: Driver | undefined;
      const current = (): DurableRuntime => {
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
          // The agent this admission builds is the definition with the overrides as they are now.
          await refresh(ctx);
          runnable(request.conversation.agent);
          const admission = await current().dispatch(request, ctx);
          // Asked before the dispatch resolves: a channel acknowledges its platform only once a wakeup
          // will drive the run. If asking fails, so does the dispatch; the platform sends it again.
          await wakeFor(request.conversation, ctx);
          return admission;
        },
        abort: (conversation, ctx) => current().abort(conversation, ctx),
        async resume(conversation, ctx) {
          await refresh(ctx);
          await current().resume(conversation, ctx);
          await wakeFor(conversation, ctx);
        },
      };
      pikit.provide("agent.runtime", agentRuntime);
      const conversations: AgentConversations = { create: (ctx) => current().createConversation(ctx) };
      pikit.provide("agent.conversations", conversations);
      const submissions: AgentSubmissions = {
        pending: (ctx) => current().submissions.pending(ctx),
        get: (conversation, requestId, ctx) => current().submissions.get(conversation, requestId, ctx),
        answers: { read: (after, limit) => current().submissions.answers.read(after, limit) },
      };
      pikit.provide("agent.submissions", submissions);
      // What an operator sees of the runtime (the dashboard), read-only, from pi-durable's records.
      pikit.provide("agent.observe", createObserver(current));
      pikit.provide(
        "model.complete",
        createModelComplete(() => {
          if (models === undefined) throw new Error("runtime-pi: model.complete used while the app is not running");
          return models;
        }),
      );
      // Pi's /compact, in the conversation it is run in (admin-api runs it from the dashboard's "/").
      const compact: AgentCommand = {
        description: "Compact the context: summarize the older messages",
        argumentHint: "<what the summary keeps>",
        async run(conversation, args, ctx) {
          await refresh(ctx);
          const done = await current().compact(conversation, args === "" ? undefined : args, ctx);
          await wakeFor(conversation, ctx);
          return { text: done.compacted ? "Compacted: the older messages are summarized, and the model reads the summary from now on." : "Nothing to compact: the conversation is short enough as it is." };
        },
      };
      pikit.provideKeyed("agent.command", "compact", compact);

      return {
        async start(ctx) {
          const made = modelsFrom(
            providers.keys().flatMap((key) => providers.get(key) ?? []),
            { credentials: credentials.get(), secrets: secrets.get() },
          );
          models = made;
          // Fail at start, not at the first message: an agent that cannot run is a broken deployment.
          if (agents.keys().length === 0) throw new Error("runtime-pi: no agent.definition is provided");
          // One steward at most (SPEC §6): the agent its operators ask to change the project.
          const stewards = agents
            .keys()
            .sort()
            .filter((name) => agents.get(name)?.steward === true);
          if (stewards.length > 1) {
            throw new Error(
              `runtime-pi: agents ${stewards.map((name) => `"${name}"`).join(" and ")} are each marked \`steward: true\`; a project has one steward, its main agent: take it off the others`,
            );
          }
          for (const key of tools.keys()) {
            const tool = tools.get(key);
            if (tool !== undefined && tool.name !== key) {
              throw new Error(`runtime-pi: the agent.tool "${key}" is a tool named "${tool.name}"; a tool is provided under its own name`);
            }
          }
          for (const key of extensions.keys()) {
            const extension = extensions.get(key);
            if (extension !== undefined && extension.name !== key) {
              throw new Error(`runtime-pi: the agent.extension "${key}" is an extension named "${extension.name}"; an extension is provided under its own name`);
            }
            if (key.startsWith("pikit.")) throw new Error(`runtime-pi: the agent.extension "${key}" has a reserved name (pikit.*: the runtime's own)`);
          }
          environment = execution.get() !== undefined || workspace.get() !== undefined;
          for (const name of agents.keys()) {
            const model = agents.get(name)?.model ?? "";
            const problem = problemOf({ ...agents.get(name), name, model });
            if (problem !== undefined) throw new Error(`runtime-pi: ${problem}`);
            const ref = parseModelName(model);
            if (ref === undefined) throw new Error(`runtime-pi: agent "${name}" names model "${model}", which no model.provider provides`);
            // Checked without a network call or an OAuth refresh: is anything configured at all?
            if ((await made.checkAuth(ref.provider, ctx.abortSignal ? { signal: ctx.abortSignal } : {})) === undefined) {
              throw new Error(
                `runtime-pi: agent "${name}" uses provider "${ref.provider}", which has no credentials: ` +
                  "log in to store one in model.credentials, or set the provider's API key in the environment",
              );
            }
          }
          // The overrides an operator may set: the agents', among the models and tools this App has.
          const store = settings.get();
          if (store !== undefined) {
            const modelNames = made.getModels().map((model) => `${model.provider}/${model.id}`);
            const live = directory.get() === undefined ? undefined : { tools: tools.keys() };
            store.declare("runtime-pi", overridesSchema(agents.keys().flatMap((name) => agents.get(name) ?? []), modelNames, live), {});
            declared = true;
          }
          // A Cloudflare object is one chat: its storage holds that chat's conversations, the root first.
          const perObject = ctx.value(WORKERS_HOST)?.object !== undefined;
          // A server reads them before what is pending resumes; an object, in its first wakeup.
          if (!perObject) await refresh(ctx);
          const wakeups = wakeupsHandle.get();
          // Runs outlive the calls that admit them; never keep start's context (its deadline).
          const background = ctx.derive(() => BACKGROUND_CONTEXT);
          const now = () => background.clock.now();
          const resumeOptions: ResumeOptions = { abandonAfterMs: config.abandonPendingAfterHours * 60 * 60 * 1_000, skip: unread };
          const drives = wakeups === undefined ? undefined : createDriver(wakeups, background, resumeOptions, refresh);
          const db = sql.get();
          const created = createDurableRuntime({
            db,
            keepSettledDays: config.keepSettledDays,
            agent: definition,
            tool: (name) => tools.get(name),
            extension: (name) => extensions.get(name),
            models: made,
            events: background,
            now,
            conversations: perObject ? "root" : "ownerless",
            execution: () => execution.get(),
            workspace: () => workspace.get(),
            ...(options.settings !== undefined && { settings: options.settings }),
            ...(drives !== undefined && { onIdleWithPendingWork: (inspection) => drives.later(nextWakeAtOf(inspection, { now })) }),
          });
          runtime = created;
          if (drives !== undefined) {
            drives.attach(created);
            driver = drives;
            // What a previous instance left (a run an eviction cut, a retry's backoff, a message nobody
            // answered, a run's end never logged) is driven by a wakeup, not by a promise left running:
            // asked for at once, as the request may be gone with the object.
            try {
              await drives.wake(now(), ctx);
            } catch (error) {
              ctx.logger.error("runtime-pi: could not ask for a wakeup to resume what is pending; it resumes at the next one", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          } else {
            // In the background: start does not wait for runs to resume, and stop cancels it.
            const controller = new AbortController();
            const done = resumePending(created, created.submissions, background.derive((inner) => withAbortSignal(controller.signal, inner)), resumeOptions);
            resuming = { controller, done };
          }
        },
        async stop(ctx) {
          // Runs in progress stay pending in pi-durable; the next process resumes them.
          declared = false;
          overrides = {};
          live = new Map();
          liveProblems = new Map();
          liveRead = false;
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
  /**
   * The runtime's `onIdleWithPendingWork`: nothing is driven, and live work waits for a time (a model
   * retry's backoff): asks for the handler when it is due (`nextWakeAtOf`), and the handler suspends the
   * runtime so the host can go meanwhile.
   */
  later(time: number | undefined): Promise<void>;
  /** Registers the handler for `runtime`. */
  attach(runtime: DurableRuntime): void;
  /** Cancels the handler's run in progress; nothing is registered after. */
  stop(): void;
}

/**
 * With `wakeups`, every run is driven inside a run of the handler `runtime-pi.drive`, since a promise
 * left running after its event may be killed (SPEC §4.1, C4). Whatever may leave a run going (a
 * dispatch, a resume, start with work pending) asks for the handler. The handler:
 * 0. reads the agents' overrides (`settings`), so what it opens builds each agent as admissions do;
 * 1. opens pi-durable if it is not open (a new instance after an eviction): what it finds resumes;
 * 2. resumes the conversations holding pending messages that this worker does not drive (a message
 *    nobody answered: as at start, `resume.ts`);
 * 3. waits until this worker drives no run, or its context is cancelled (the provider's slice deadline,
 *    or the App stopping);
 * 4. asks again at once if runs are still going; when what is left only waits for a time (a model
 *    retry's backoff), the runtime asked for a wakeup at that time (`later`), and the handler closes
 *    pi-durable (`suspend`, inside the event) so the host can be evicted until then.
 * A request carries nothing: what to do is read from pi-durable each time, so
 * a handler that runs twice, or late, or after the object was evicted, does the right thing.
 */
function createDriver(wakeups: Wakeups, background: AppContext, resumeOptions: ResumeOptions, refresh: (ctx: AppContext) => Promise<void>): Driver {
  /** The earliest time asked for and not yet taken by a run of the handler, in this App. */
  let requested: number | undefined;
  /** Set by `later` during a run of the handler: what is left only waits for a time. */
  let waiting = false;
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
  /** Asks from the handler, whose context may be cancelled already: with the App's (start's), and never rejects. */
  const wakeLater = (time: number): Promise<void> =>
    wake(time, background).catch((error: unknown) => {
      logger.error("runtime-pi: could not ask for a wakeup; runs still open resume at the next one, or at the next start", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  const handler = (runtime: DurableRuntime) => async (handlerCtx: AppContext): Promise<void> => {
    // This run took the request: whatever is asked from now on stands after it.
    requested = undefined;
    waiting = false;
    const signal = handlerCtx.abortSignal === undefined ? stopping.signal : AbortSignal.any([handlerCtx.abortSignal, stopping.signal]);
    const ctx = handlerCtx.derive((inner) => withAbortSignal(signal, inner));
    // The agents' overrides before anything is opened: a reopened Harness rebuilds each agent with them.
    await refresh(ctx);
    try {
      // Opened first, so what it finds running counts as held below and is not waited for twice.
      await runtime.inspect(ctx);
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    if (!signal.aborted) {
      // What this worker drives needs no resuming (a run going, or waiting out a retry).
      await resumePending(runtime, runtime.submissions, ctx, { ...resumeOptions, skip: (conversation) => runtime.holds(conversation) || resumeOptions.skip?.(conversation) === true });
    }
    const idle = await runtime.whenIdle(ctx);
    if (!idle) {
      // The slice ended (or the App is stopping) with runs going: the next run of the handler, in this
      // App or the next one, picks them up, from pi-durable if this one is gone.
      await wakeLater(background.clock.now());
      return;
    }
    // Nothing is driven, and what is left waits for a time: the wakeup at that time reopens pi-durable.
    if (waiting) await runtime.suspend(ctx);
  };

  return {
    wake,
    async later(time) {
      waiting = true;
      if (time !== undefined) await wakeLater(time);
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
