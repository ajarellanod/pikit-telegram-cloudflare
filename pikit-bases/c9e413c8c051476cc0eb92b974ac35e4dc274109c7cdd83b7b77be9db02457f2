/**
 * admin-api: the operator's HTTP API (SPEC §5), what the dashboard reads and does, and the dashboard's
 * built files. The routes are in `routes.ts`, their JSON in `api.ts`.
 *
 * - **Every API answer asks `admin.auth`** first: no operator, `401`. The dashboard's files hold no
 *   data and are served to anyone (`assets.ts`), under a Content-Security-Policy. They are a module the
 *   dashboard's own build writes (`dashboard-files.ts`), bundled with the app: no disk.
 * - **It reads contracts, never internals:** the composition from `APP_DESCRIPTION` (K13, config
 *   values that look like secrets redacted), the agents from `agent.definition` (name, model, the
 *   names of their tools), the runtime from `agent.observe`. Nothing it reads changes anything.
 * - **The dashboard is a channel of its own.** It reads every conversation; it writes only into its
 *   own (`dashboard:<uuid>`, with an agent of the App) and, into another channel's, as a follow-up
 *   (never a steer) whose request id starts with `dashboard:`: a run only such messages started is
 *   never delivered to that channel (`startAnswerDelivery`), and the agent reads that the message is
 *   the operator's (`operatorPrompt`). Abort and reset stay on every conversation.
 * - **Every action goes through the contract that owns it:** a message through `agent.runtime`'s
 *   `dispatch`, a new conversation through `conversations.registry`'s `resolve`, an abort through
 *   `agent.runtime`'s `abort`, a reset through `conversations.registry`'s `reset`. Each is logged with
 *   the operator's id and the conversation, never the message's text.
 * - **The list is newest activity first**, paged, from the conversation index (`conversation-index.ts`)
 *   that this component keeps from the runtime's events (a message dispatched, a run started, settled
 *   or failed, a reset) and, when the App starts, from what `agent.observe` holds.
 * - **Delivery, when an `outbound.queue` is installed:** the pieces not delivered yet (`pending`) and
 *   those that settled (`receipts`, read after a cursor), as the queue keeps them; never their text.
 * - **Slash commands** are the App's `agent.command`s, listed and run in a conversation (as an action:
 *   its key's current one) by `runAgentCommand`. admin-api registers two of Pi's built-ins, through the
 *   same capability: `/new` (Pi's "Start a new session": the key's reset, `conversations.registry`'s
 *   `reset`) and `/name <title>` (the conversation's title). runtime-pi registers `/compact`; a
 *   component of yours registers its own.
 * - **Titles**: after a conversation's first run settles, a model (`model.complete`, runtime-pi's;
 *   `titleModel`, else the agent's) titles it from its first message, in the background, once (tried
 *   once more after a later run if that failed): `titles.ts`. A reset's new conversation gets its own.
 *   `/name` replaces the current one's. They are kept with the index (`conversation-index.ts`) and
 *   listed with each conversation; one with no title yet is listed by its first message.
 * - **Only a conversation's current one is talked to.** A message, an abort or a reset to a
 *   conversation a reset left behind is `409 not_current`. A reset's new conversation is its key's
 *   current one, with the key's agent, before any message reaches it: it is talked to at once.
 *
 * Targets: `server` and `durable`.
 * - **On a server** this export is the whole API, over the App's own contracts (`createLocalBackend`):
 *   every conversation, live events from `agent.observe`'s `watch`; the index is a table of the App's
 *   `storage.sql`, filled at start in the background from every conversation the runtime holds.
 * - **On Cloudflare** it goes in each conversation's Durable Object (the default App), and the routes
 *   are the Worker's half's (`worker.ts`, `export const worker`). Here it answers the Worker's calls
 *   about this object's conversations (`calls.ts`), and tells the index (the object `admin-api:index`)
 *   of their activity: when a message is dispatched, a resumed run starts, a run settles or fails, a
 *   reset, and when the object's App starts (its conversations, from `agent.observe`). Its routes are
 *   registered in the object's App too, where no server serves them. The index object runs this same
 *   App and answers the Worker's list: nothing here makes a conversation for it.
 */

import { type AppContext, BACKGROUND_CONTEXT, defineComponent, withAbortSignal } from "@pikit/core";
import { type AgentCommand, type AgentObserver, type ConversationRef, isCommandName } from "@pikit/contracts";
import { cleanTitle } from "./api.ts";
import { createAssets } from "./assets.ts";
import { agentOf, createLocalBackend } from "./backend.ts";
import { answerCalls, SEEN } from "./calls.ts";
import { Config } from "./config.ts";
import { createConversationIndex, INDEX_KEY, type IndexedConversation } from "./conversation-index.ts";
import { DASHBOARD_FILES } from "./dashboard-files.ts";
import { provideRoutes } from "./routes.ts";
import { createTitler } from "./titles.ts";

export { worker, WORKER_NAME } from "./worker.ts";

/** Conversations read from `agent.observe` per page when the App starts, and sent to the index at once. */
const BACKFILL_PAGE = 100;

/** A conversation's first messages, oldest first: its transcript's last page (newest first), read through at most 50 pages. */
async function firstMessages(observer: AgentObserver, conversationId: string, ctx: AppContext): Promise<readonly unknown[]> {
  let cursor: string | undefined;
  let last: readonly { messages: readonly unknown[] }[] = [];
  for (let pages = 0; pages < 50; pages++) {
    const page = await observer.transcript(conversationId, { limit: BACKFILL_PAGE, ...(cursor !== undefined && { cursor }) }, ctx);
    if (page === undefined) return [];
    last = page.items;
    cursor = page.next;
    if (cursor === undefined) break;
  }
  return [...last].reverse().flatMap((entry) => entry.messages);
}

export default defineComponent({
  name: "admin-api",
  config: Config,
  setup(pikit, config) {
    const auth = pikit.use("admin.auth");
    const observe = pikit.use("agent.observe");
    const runtime = pikit.use("agent.runtime");
    const registry = pikit.use("conversations.registry");
    // The conversation index: the App's own table on a server; on Cloudflare the index object's.
    const sql = pikit.use("storage.sql");
    // Delivery: shown when an outbound queue is installed.
    const queue = pikit.useOptional("outbound.queue");
    // On Cloudflare (`durable`): the Worker's calls, and the index's messages.
    const inbox = pikit.useOptional("actor.inbox");
    const mailbox = pikit.useOptional("actor.mailbox");
    // The agents, for `GET /admin/api/agents` and a web search asked of one.
    const definitions = pikit.useKeyed("agent.definition");
    // The slash commands the dashboard lists and runs: its own two below, runtime-pi's, yours.
    const commands = pikit.useKeyed("agent.command");
    // Titles: a model's text, through the runtime's models.
    const completion = pikit.useOptional("model.complete");
    const durable = pikit.target === "durable";
    const assets = createAssets(DASHBOARD_FILES);
    const index = createConversationIndex(() => sql.get());
    const contracts = {
      observe: () => observe.get(),
      runtime: () => runtime.get(),
      registry: () => registry.get(),
      index: () => index,
      agents: () => definitions.keys().sort().map((name) => agentOf(name, definitions.get(name))),
      commands: () => ({ keys: () => commands.keys().filter(isCommandName), get: (name: string) => commands.get(name) }),
    };
    // A server's: a conversation no message reached yet is its key's by the index's row (a reset's new one).
    const backend = createLocalBackend({ ...contracts, keyOf: (conversationId) => index.keyOf(conversationId) });

    provideRoutes(pikit, {
      auth,
      backend: () => backend,
      queue: () => queue.get(),
      noQueue: "no outbound.queue is installed: answers go straight to their platform, with nothing to show here",
      heartbeatMs: config.heartbeatMs,
      assets,
    });

    // Pi's built-ins pikit does for real, registered as any component's are.
    const newConversation: AgentCommand = {
      description: "Start a new conversation: this one is kept, and its key starts again empty",
      async run(conversation, _args, ctx) {
        const reset = await registry.get().reset(conversation.key, ctx);
        if (reset === undefined) throw new Error("this conversation's key points to no conversation");
        return { text: "A new conversation started; the previous one is kept, and can be read." };
      },
    };
    const nameCommand: AgentCommand = {
      description: "Set the conversation's title",
      argumentHint: "<title>",
      async run(conversation, args) {
        const title = cleanTitle(args);
        if (title === undefined) throw new Error("Write the title after the command: /name <title>");
        await index.name(conversation.conversationId, title);
        return { text: `Titled \u201c${title}\u201d.` };
      },
    };
    pikit.provideKeyed("agent.command", "new", newConversation);
    pikit.provideKeyed("agent.command", "name", nameCommand);

    const titler = createTitler({
      index: () => index,
      complete: () => completion.get(),
      modelFor: (agent) => config.titleModel ?? definitions.get(agent)?.model,
    });

    /**
     * Records activity in the index: the App's own on a server, the index object's on Cloudflare (a
     * message). Missed, the next activity or the App's next start records it again.
     */
    const seen = async (entries: IndexedConversation[], ctx: AppContext): Promise<void> => {
      if (entries.length === 0) return;
      try {
        if (!durable) return await index.seen(entries);
        const send = mailbox.get();
        if (send !== undefined) await send.send(INDEX_KEY, SEEN, { entries: entries.map((entry) => ({ ...entry })) }, ctx);
      } catch (error) {
        ctx.logger.warn("admin-api: the conversation index did not take this conversation's activity; its next activity tells it again", {
          conversation: entries[0]?.key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    const active = (conversation: ConversationRef, ctx: AppContext) =>
      seen([{ key: conversation.key, conversationId: conversation.conversationId, agent: conversation.agent, at: ctx.clock.now() }], ctx);

    // In the caller's context, once the message is durable: the most reliable moment.
    pikit.on("agent.dispatched", ({ conversation, admission }, ctx) => (admission.kind === "duplicate" ? undefined : active(conversation, ctx)));
    // On Cloudflare a run that is not resumed was dispatched in this object just before: one message fewer.
    pikit.on("agent.started", ({ conversation, resumed }, ctx) => (durable && !resumed ? undefined : active(conversation, ctx)));
    pikit.on("agent.settled", (result, ctx) => {
      // In the background: no event or request waits for a title.
      titler.settled(result, ctx.derive(() => background));
      return active(result.conversation, ctx);
    });
    pikit.on("agent.failed", (result, ctx) => active(result.conversation, ctx));
    pikit.on("conversation.reset", ({ conversation }, ctx) => active(conversation, ctx));

    /**
     * Every conversation `observer` holds with a key, a page at a time, into the index: what events may
     * have missed. Then the conversations with no title yet are titled (`untitled`).
     */
    const backfill = async (observer: AgentObserver, ctx: AppContext): Promise<number> => {
      let cursor: string | undefined;
      const all: { key: string; agent: string; conversationId: string; at: number }[] = [];
      do {
        if (ctx.abortSignal?.aborted === true) break;
        const page = await observer.conversations({ limit: BACKFILL_PAGE, ...(cursor !== undefined && { cursor }) }, ctx);
        const entries = page.items.flatMap(({ key, agent, conversationId, lastActivity }) =>
          key === undefined || agent === undefined ? [] : [{ key, agent, conversationId, at: lastActivity ?? 0 }],
        );
        await seen(entries, ctx);
        all.push(...entries);
        cursor = page.next;
      } while (cursor !== undefined);
      await titler.untitled(all, (conversationId) => firstMessages(observer, conversationId, ctx), ctx).catch((error: unknown) =>
        ctx.logger.warn("admin-api: the conversations with no title were not titled", { error: error instanceof Error ? error.message : String(error) }),
      );
      return all.length;
    };

    let stopping: AbortController | undefined;
    let filling: Promise<void> | undefined;
    /** What outlives the events: titles, the index's filling. Cancelled at stop. */
    let background = BACKGROUND_CONTEXT;

    return {
      async start(ctx) {
        stopping = new AbortController();
        background = withAbortSignal(stopping.signal, BACKGROUND_CONTEXT);
        if (!durable) {
          if (assets.built()) ctx.logger.info("admin-api: the dashboard is served at /admin/", { files: assets.size() });
          else ctx.logger.info("admin-api: no dashboard is built; the API alone is served at /admin/api/");
          // In the background: a server with thousands of conversations starts at once.
          filling = backfill(observe.get(), ctx.derive(() => background)).then(
            (count) => ctx.logger.info("admin-api: the conversation index has every conversation of the runtime", { conversations: count }),
            (error: unknown) => ctx.logger.warn("admin-api: the conversation index was not filled from the runtime; events keep it", { error: error instanceof Error ? error.message : String(error) }),
          );
          return;
        }
        const calls = inbox.get();
        const missing = [calls === undefined && "actor.inbox", mailbox.get() === undefined && "actor.mailbox"].filter(Boolean);
        if (calls === undefined || missing.length > 0) {
          throw new Error(`admin-api: in a Durable Object's App it answers the Worker's calls and tells the conversation index, which needs ${missing.join(", ")}: install platform-cloudflare`);
        }
        // An object's conversations are all of its key.
        answerCalls(calls, (key) => createLocalBackend({ ...contracts, keyOf: async () => key }), index);
        // This object's conversations (a few): the index learns of them even if their events were missed.
        await backfill(observe.get(), ctx).catch((error: unknown) =>
          ctx.logger.warn("admin-api: this object's conversations were not told to the index", { error: error instanceof Error ? error.message : String(error) }),
        );
      },
      async stop() {
        stopping?.abort();
        await Promise.all([filling, titler.idle()]);
      },
    };
  },
});
