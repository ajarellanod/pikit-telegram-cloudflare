/**
 * What the admin API's routes read and do, apart from where it is (`routes.ts` is written once, over
 * this): the composition, the agents, conversations, a transcript, a conversation live, a message, an
 * abort, a reset.
 *
 * - **`createLocalBackend`**: the contracts of the App it runs in (`agent.observe`, `agent.runtime`,
 *   `conversations.registry`) and the conversation index (`conversation-index.ts`), which the list
 *   reads, newest activity first. On a server that is every conversation; in a Cloudflare Durable
 *   Object, that object's own, which its answers to the Worker's calls read (`calls.ts`).
 *
 * **What the operator writes** (the dashboard is a channel of its own): a message to a conversation is
 * a follow-up, never a steer, whose request id starts with `dashboard:` (`DASHBOARD_REQUEST_PREFIX`),
 * so that a run only such messages started is never delivered to the conversation's chat; the agent
 * reads it after a first line saying it is the operator's (`operatorPrompt`), which also asks for a web
 * search when the message does (only of an agent with `WEB_SEARCH_TOOL`), and its images in the
 * request (`AgentRequest.images`). A new conversation is one of the dashboard's own
 * (`dashboard:<uuid>`), with an agent of the App. A slash command (`agent.command`, the App's) runs
 * in a conversation as the other actions do: only in a key's current one (`runAgentCommand`).
 * - **`createRemoteBackend`** (`remote.ts`): the Worker's, which reaches each conversation's object by
 *   `actor.mailbox.call` and lists them from the index (`conversation-index.ts`).
 *
 * A refusal is an `ActorCallError` whose code the routes answer with (`not_found` and
 * `unknown_command` are a `404`, `no_agent` and `not_current` a `409`, `invalid_cursor` and
 * `invalid_request` a `400`, `command_failed` a `422`): the same error crosses a call from an object to
 * the Worker whole.
 *
 * **Ids.** On a server a conversation's id is the runtime's. On Cloudflare every object numbers its
 * own conversations from `1`, so the Worker's API names one `<conversation key>~<the object's id>`
 * (`qualify`), split on the last `~`. A client treats every id as opaque.
 */

import { APP_DESCRIPTION, type AppContext, type AppDescription } from "@pikit/core";
import {
  ActorCallError,
  type AgentObserver,
  type AgentRuntime,
  type CommandLookup,
  type ConversationRef,
  type ConversationRegistry,
  type ObservedConversation,
  type PageRequest,
  listAgentCommands,
  redactSecrets,
  runAgentCommand,
} from "@pikit/contracts";
import {
  type ApiAbortResponse,
  type ApiAgent,
  type ApiAgents,
  type ApiApp,
  type ApiAttachment,
  type ApiCommandResponse,
  type ApiCommands,
  type ApiConversation,
  type ApiEvent,
  type ApiPage,
  type ApiResetResponse,
  type ApiSendResponse,
  type ApiStartResponse,
  type ApiTranscriptEntry,
  type ApiUsage,
  isDashboardKey,
  operatorPrompt,
  WEB_SEARCH_TOOL,
} from "./api.ts";
import type { ConversationIndex, Hidden } from "./conversation-index.ts";

/**
 * A message to a conversation, checked: what `POST …/messages` takes (its attachments by
 * `attachmentsProblem`). Its request id starts with `dashboard:`.
 */
export interface Message {
  text: string;
  requestId: string;
  attachments?: ApiAttachment[];
  /** Asks the agent to search the web: its agent must have `WEB_SEARCH_TOOL` (else `invalid_request`). */
  webSearch?: boolean;
}

/** A new conversation of the dashboard's own, checked: what `POST /admin/api/conversations` takes. */
export interface NewConversation extends Message {
  /** `dashboard:<uuid>`, made by the routes. */
  key: string;
  agent: string;
}

/** What an action did, and to which key (for the operator's log line). */
export type Sent = ApiSendResponse & { key: string };
export type Aborted = ApiAbortResponse & { key: string };
export type Commanded = ApiCommandResponse & { key: string };

export interface AdminBackend {
  /** The composition of the App that runs the agents. */
  app(ctx: AppContext): Promise<ApiApp>;
  /** The App's agents, by name. */
  agents(ctx: AppContext): Promise<ApiAgents>;
  /**
   * The most recently active first: those listed, or with `archived` those the operator archived.
   * Throws `invalid_cursor` for a cursor it did not give.
   */
  conversations(page: PageRequest, ctx: AppContext, archived?: boolean): Promise<ApiPage<ApiConversation>>;
  /**
   * Puts the conversation away (`archived`, `deleted`) or back in the list (`undefined`): the list
   * only, nothing of the runtime's. Any conversation, current or not. Throws `not_found`.
   */
  hide(id: string, how: Hidden | undefined, ctx: AppContext): Promise<void>;
  /** A conversation of the dashboard's own, with its first message. Throws `unknown_agent`, `invalid_request`. */
  start(conversation: NewConversation, ctx: AppContext): Promise<ApiStartResponse>;
  /** Throws `not_found`. */
  conversation(id: string, ctx: AppContext): Promise<ApiConversation>;
  /** Newest first. Throws `not_found`, `invalid_cursor`. */
  transcript(id: string, page: PageRequest, ctx: AppContext): Promise<ApiPage<ApiTranscriptEntry>>;
  /** What the conversation is now: the first event of its live events. Throws `not_found`. */
  snapshot(id: string, ctx: AppContext): Promise<ApiEvent>;
  /**
   * Its live events, a `snapshot` first, until `ctx` is cancelled or they end. Throws `not_found`
   * before the first one, so a route answers `404` rather than an empty stream.
   */
  live(id: string, ctx: AppContext): Promise<AsyncIterable<ApiEvent>>;
  /** Throws `not_found`. */
  usage(id: string, ctx: AppContext): Promise<ApiUsage>;
  /**
   * The actions reach only a key's current conversation: they throw `not_found`, `no_agent`,
   * `not_current`; a message also `invalid_request` (a web search its agent cannot do, attachments the
   * API does not take) and `too_large`.
   */
  send(id: string, message: Message, ctx: AppContext): Promise<Sent>;
  abort(id: string, ctx: AppContext): Promise<Aborted>;
  reset(id: string, ctx: AppContext): Promise<ApiResetResponse>;
  /** The App's slash commands (`agent.command`), by name. */
  commands(ctx: AppContext): Promise<ApiCommands>;
  /**
   * Runs the command `name` in the conversation with `args`, as an action: it throws
   * `unknown_command` (no such command, before anything else), the actions' refusals, and
   * `command_failed` with the command's message.
   */
  command(id: string, name: string, args: string, ctx: AppContext): Promise<Commanded>;
}

/** A refusal the routes answer with: `code` is the API's `error`. */
export function refusal(
  code: "not_found" | "no_agent" | "not_current" | "invalid_cursor" | "invalid_request" | "unknown_agent" | "too_large" | "unknown_command" | "command_failed",
  message: string,
): ActorCallError {
  return new ActorCallError(code, message);
}

export const NOT_FOUND = "no such conversation";

/** Splits a qualified id on its last `~`. */
const QUALIFIED = /^(.+)~([0-9]+)$/s;

/** The Worker's id of the object `key`'s conversation `local` (`telegram:1~2`). */
export function qualify(key: string, local: string): string {
  return `${key}~${local}`;
}

/** The key and the object's own id a qualified id names; `undefined` when it is not one. */
export function unqualify(id: string): { key: string; local: string } | undefined {
  const match = QUALIFIED.exec(id);
  return match === null ? undefined : { key: match[1] as string, local: match[2] as string };
}

export interface LocalContracts {
  observe(): AgentObserver;
  runtime(): AgentRuntime;
  registry(): ConversationRegistry;
  /** The index the list reads (on Cloudflare only the index object's has rows, and no call lists there). */
  index(): ConversationIndex;
  /**
   * The key a conversation no message reached yet may be of (a reset's new one, which `agent.observe`
   * knows no key of until a message reaches it): on a server the index's row, written when the reset
   * pointed the key to it; in a Cloudflare object, the object's own key.
   */
  keyOf(conversationId: string, ctx: AppContext): Promise<string | undefined>;
  /** The App's agents (`agent.definition`), by name: `agentOf` describes each. */
  agents(): ApiAgent[];
  /** The App's slash commands (`agent.command`). */
  commands(): CommandLookup;
}

/** An agent definition as the API says it: its name, its model, the names of the tools it is defined with. */
export function agentOf(name: string, definition: { model?: unknown; tools?: readonly unknown[] } | undefined): ApiAgent {
  const tools = (definition?.tools ?? []).flatMap((tool) => {
    const named = typeof tool === "string" ? tool : (tool as { name?: unknown } | null)?.name;
    return typeof named === "string" ? [named] : [];
  });
  return { name, model: typeof definition?.model === "string" ? definition.model : "", tools };
}

/** The App's agents: the keys of `agent.definition`. */
export function agentsOf(description: AppDescription | undefined): string[] {
  return Object.keys(description?.capabilities["agent.definition"]?.keys ?? {}).sort();
}

/** The backend over the contracts of the App it runs in (a server's, or one Durable Object's). */
export function createLocalBackend(contracts: LocalContracts): AdminBackend {
  /**
   * Its key and agent, and whether its key points to it now: `agent.observe`'s once a message reached
   * it; before that (a reset's new conversation), the key `keyOf` knows and the agent its key has
   * (`conversations.registry`'s `get`: a key keeps its agent through resets). Neither: none.
   */
  const identify = async (conversation: ObservedConversation, ctx: AppContext): Promise<{ key: string; agent: string; current: boolean } | undefined> => {
    const key = conversation.key ?? (await contracts.keyOf(conversation.conversationId, ctx));
    if (key === undefined) return undefined;
    const now = await contracts.registry().get(key, ctx);
    const agent = conversation.agent ?? now?.agent;
    return agent === undefined ? undefined : { key, agent, current: now?.conversationId === conversation.conversationId };
  };

  /** The conversation, with its key, its agent, whether its key points to it now and its key's title when it has a key. */
  const described = async (conversation: ObservedConversation, ctx: AppContext): Promise<ApiConversation> => {
    const identity = await identify(conversation, ctx);
    if (identity === undefined) return conversation as ApiConversation;
    const title = await contracts.index().title(identity.key);
    return { ...(conversation as ApiConversation), ...identity, ...(title !== undefined && { title }) };
  };

  const found = async (id: string, ctx: AppContext): Promise<ObservedConversation> => {
    const conversation = id === "" ? undefined : await contracts.observe().conversation(id, ctx);
    if (conversation === undefined) throw refusal("not_found", NOT_FOUND);
    return conversation;
  };

  /**
   * The conversation as an action takes it, or why not: it has no key, or a reset left it behind. A
   * reset's new conversation is its key's current one: it takes them before any message reached it.
   */
  const actionable = async (id: string, ctx: AppContext): Promise<ConversationRef> => {
    const conversation = await found(id, ctx);
    const identity = await identify(conversation, ctx);
    if (identity === undefined) throw refusal("no_agent", "no message has reached this conversation and no reset pointed a key to it: it has no agent to talk to");
    if (!identity.current) throw refusal("not_current", "a reset left this conversation behind: its key points to another one");
    return { key: identity.key, agent: identity.agent, conversationId: conversation.conversationId };
  };

  /** A read with the client's cursor: an observer refuses a cursor it did not give. */
  const paged = async <T>(page: PageRequest, read: () => Promise<T>): Promise<T> => {
    if (page.cursor === undefined) return read();
    try {
      return await read();
    } catch {
      throw refusal("invalid_cursor", "the cursor is not one this API gave");
    }
  };

  const live = async (id: string, ctx: AppContext): Promise<AsyncIterable<ApiEvent>> => {
    // `watch` rejects an unknown conversation only once read: ask first.
    await found(id, ctx);
    return contracts.observe().watch(id, ctx);
  };

  /** Whether `message` asks for a web search; one that `agent` cannot do is refused. */
  const searchable = (agent: string, message: Message): boolean => {
    if (message.webSearch !== true) return false;
    if (!contracts.agents().some((each) => each.name === agent && each.tools.includes(WEB_SEARCH_TOOL))) {
      throw refusal("invalid_request", `the agent "${agent}" has no ${WEB_SEARCH_TOOL} tool: it cannot search the web`);
    }
    return true;
  };

  /**
   * Dispatches `message` to `conversation` as the operator's: a follow-up, marked for the agent, with its
   * images. A web search is asked only of an agent that has the tool.
   */
  const dispatch = async (conversation: ConversationRef, message: Message, ctx: AppContext) => {
    const webSearch = searchable(conversation.agent, message);
    const images = (message.attachments ?? []).map(({ mimeType, data }) => ({ mimeType, data }));
    const prompt = operatorPrompt(conversation.key, message.text, { webSearch });
    return contracts.runtime().dispatch({ requestId: message.requestId, conversation, prompt, ...(images.length > 0 && { images }), whenBusy: "followUp" }, ctx);
  };

  return {
    async app(ctx) {
      const description = ctx.value(APP_DESCRIPTION) as unknown as ApiApp;
      // Config holds no secret; one put there by mistake is still never sent.
      return { ...description, config: redactSecrets(description.config) };
    },

    agents: async () => ({ items: contracts.agents() }),

    async conversations(page, ctx, archived = false) {
      const listed = await contracts.index().list({ limit: page.limit ?? 50, archived, ...(page.cursor !== undefined && { cursor: page.cursor }) });
      // A row whose conversation the runtime no longer has is left out.
      const found = await Promise.all(listed.items.map((row) => contracts.observe().conversation(row.conversationId, ctx)));
      const items = await Promise.all(found.filter((each) => each !== undefined).map((each) => described(each, ctx)));
      return { items, ...(listed.next !== undefined && { next: listed.next }) };
    },

    async start(message, ctx) {
      if (!isDashboardKey(message.key)) throw refusal("invalid_request", "a conversation the dashboard starts has a key of its own, dashboard:<id>");
      const agents = agentsOf(ctx.value(APP_DESCRIPTION));
      if (!agents.includes(message.agent)) throw refusal("unknown_agent", `no agent "${message.agent}" in the App: ${agents.join(", ") || "none"}`);
      // Before the key is made: a refused message makes no conversation.
      searchable(message.agent, message);
      const conversation = await contracts.registry().resolve(message.key, message.agent, ctx);
      const admission = await dispatch(conversation, message, ctx);
      return { key: conversation.key, conversationId: conversation.conversationId, requestId: message.requestId, admission: admission.kind };
    },

    conversation: async (id, ctx) => described(await found(id, ctx), ctx),

    async hide(id, how, ctx) {
      const conversation = await found(id, ctx);
      const key = conversation.key ?? (await contracts.keyOf(conversation.conversationId, ctx));
      if (key === undefined || !(await contracts.index().hide(key, conversation.conversationId, how))) throw refusal("not_found", NOT_FOUND);
    },

    async transcript(id, page, ctx) {
      const result = id === "" ? undefined : await paged(page, () => contracts.observe().transcript(id, page, ctx));
      if (result === undefined) throw refusal("not_found", NOT_FOUND);
      return result as ApiPage<ApiTranscriptEntry>;
    },

    async snapshot(id, ctx) {
      const iterator = (await live(id, ctx))[Symbol.asyncIterator]();
      try {
        const first = await iterator.next();
        if (first.done === true) throw refusal("not_found", NOT_FOUND);
        return first.value;
      } finally {
        await iterator.return?.();
      }
    },

    live,

    async usage(id, ctx) {
      const usage = id === "" ? undefined : await contracts.observe().usage(id, ctx);
      if (usage === undefined) throw refusal("not_found", NOT_FOUND);
      return usage as ApiUsage;
    },

    async send(id, message, ctx) {
      const conversation = await actionable(id, ctx);
      const admission = await dispatch(conversation, message, ctx);
      return { key: conversation.key, requestId: message.requestId, admission: admission.kind };
    },

    async abort(id, ctx) {
      const conversation = await actionable(id, ctx);
      await contracts.runtime().abort(conversation, ctx);
      return { key: conversation.key, conversationId: conversation.conversationId };
    },

    async reset(id, ctx) {
      const conversation = await actionable(id, ctx);
      const reset = await contracts.registry().reset(conversation.key, ctx);
      if (reset === undefined) throw refusal("not_found", NOT_FOUND);
      return { key: conversation.key, previousConversationId: reset.previousConversationId, conversationId: reset.newConversationId };
    },

    commands: async () => ({ items: listAgentCommands(contracts.commands()) }),

    async command(id, name, args, ctx) {
      const commands = contracts.commands();
      if (!listAgentCommands(commands).some((each) => each.name === name)) throw refusal("unknown_command", `no command "/${name}" in the App`);
      const conversation = await actionable(id, ctx);
      const outcome = await runAgentCommand(commands, name, conversation, args, ctx);
      if (outcome.kind === "unknown") throw refusal("unknown_command", `no command "/${name}" in the App`);
      if (outcome.kind === "failed") throw refusal("command_failed", outcome.message);
      return { key: conversation.key, ...(outcome.text !== undefined && { text: outcome.text }) };
    },
  };
}
