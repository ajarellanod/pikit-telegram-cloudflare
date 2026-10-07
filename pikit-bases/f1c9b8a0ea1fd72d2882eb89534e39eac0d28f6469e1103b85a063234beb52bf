/**
 * The Worker's backend, on Cloudflare: each conversation lives in the Durable Object of its key, which
 * the Worker reaches only by `actor.mailbox.call` (JSON in, JSON out, no stream). Every route is a call
 * to that object (`calls.ts`), whose answers name its conversations by its own ids: here they are
 * qualified, `<key>~<id>` (`backend.ts`).
 *
 * - **The list** asks the index (`INDEX_KEY`, `conversation-index.ts`) for a page of conversations,
 *   the most recently active first, then each one's object for it. A page is at most
 *   `CONVERSATIONS_PER_PAGE` whatever `limit` asks (each is a subrequest; Workers count them). An
 *   object that does not answer, or no longer has the conversation, is left out of the page, and logged.
 * - **A new conversation** of the dashboard's own is its key's object's (`dashboard:<uuid>`): one call.
 * - **Live events are polled**: no call streams, so `live` asks the object for its `snapshot` every
 *   `pollMs` (2 s) and yields it only when it changed, then ends after `polls` of them (the
 *   subrequests of one request are bounded). The dashboard reconnects to a stream that ended
 *   (`live.ts`). Between two snapshots it sees no text streaming, only where the run is.
 * - **The composition**, **the agents** and **the slash commands** are an object's App's (the index
 *   object's: every object runs the same App), where the agents run. A command runs in its
 *   conversation's object, as the other actions do.
 * - **A message's images** are at most `MAX_DURABLE_IMAGE_BYTES` in all (`413 too_large`), checked
 *   before the call: the object stores the message in one Durable Object row (2 MB at most).
 */

import type { AppContext } from "@pikit/core";
import type { ActorMailbox, JsonValue } from "@pikit/contracts";
import {
  type ApiAgents,
  type ApiApp,
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
  attachmentsProblem,
} from "./api.ts";
import { type AdminBackend, type Message, NOT_FOUND, qualify, refusal, unqualify } from "./backend.ts";
import { CALL } from "./calls.ts";
import { INDEX_KEY, type IndexPage } from "./conversation-index.ts";

/** Conversations read in one page of the list: one call each, besides the index's. */
export const CONVERSATIONS_PER_PAGE = 20;
/** How often a live view asks its object for a snapshot: each ask is a Durable Object request (the Free plan has 100,000 a day). */
export const POLL_MS = 2_000;
/** Snapshots asked per stream before it ends (and the client reconnects): well under a request's subrequests. */
export const POLLS = 40;

export interface RemoteOptions {
  pollMs?: number;
  polls?: number;
}

export function createRemoteBackend(mailbox: () => ActorMailbox, options: RemoteOptions = {}): AdminBackend {
  const pollMs = options.pollMs ?? POLL_MS;
  const polls = options.polls ?? POLLS;
  const call = async <T>(key: string, type: string, message: JsonValue, ctx: AppContext): Promise<T> => (await mailbox().call(key, type, message, ctx)) as T;

  /** The key and the object's id `id` names: a malformed one is not found. */
  const target = (id: string): { key: string; local: string } => {
    const found = unqualify(id);
    if (found === undefined) throw refusal("not_found", NOT_FOUND);
    return found;
  };
  const qualified = (key: string, conversation: ApiConversation): ApiConversation => ({ ...conversation, conversationId: qualify(key, conversation.conversationId) });
  const snapshotOf = (key: string, local: string, ctx: AppContext) => call<ApiEvent>(key, CALL.snapshot, { conversationId: local }, ctx);
  /** `message` as a call carries it, its images within what an object stores. */
  const sendable = (message: Message): JsonValue => {
    const wrong = attachmentsProblem(message.attachments ?? [], "durable");
    if (wrong !== undefined) throw refusal(wrong.status === 413 ? "too_large" : "invalid_request", wrong.message);
    return message as unknown as JsonValue;
  };

  return {
    app: (ctx) => call<ApiApp>(INDEX_KEY, CALL.app, null, ctx),

    agents: (ctx) => call<ApiAgents>(INDEX_KEY, CALL.agents, null, ctx),

    async conversations(page, ctx, archived = false) {
      const limit = Math.min(page.limit ?? CONVERSATIONS_PER_PAGE, CONVERSATIONS_PER_PAGE);
      const listed = await call<IndexPage>(INDEX_KEY, CALL.list, { limit, ...(archived && { archived }), ...(page.cursor !== undefined && { cursor: page.cursor }) }, ctx);
      const found = await Promise.all(
        listed.items.map(async ({ key, conversationId }) => {
          try {
            return qualified(key, await call<ApiConversation>(key, CALL.conversation, { conversationId }, ctx));
          } catch (error) {
            ctx.logger.warn("admin-api: a conversation's object did not answer; it is left out of the list", {
              conversation: key,
              error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
          }
        }),
      );
      return { items: found.filter((each) => each !== undefined), ...(listed.next !== undefined && { next: listed.next }) };
    },

    async start(message, ctx) {
      const { key, agent, ...rest } = message;
      const started = await call<ApiStartResponse>(key, CALL.start, { agent, ...(sendable(rest) as object) } as JsonValue, ctx);
      return { ...started, conversationId: qualify(key, started.conversationId) };
    },

    async hide(id, how, ctx) {
      // The index object keeps what is put away: the conversation's own object is not asked.
      const { key, local } = target(id);
      await call<JsonValue>(INDEX_KEY, CALL.hide, { key, conversationId: local, ...(how !== undefined && { how }) }, ctx);
    },

    async conversation(id, ctx) {
      const { key, local } = target(id);
      return qualified(key, await call<ApiConversation>(key, CALL.conversation, { conversationId: local }, ctx));
    },

    async transcript(id, page, ctx) {
      const { key, local } = target(id);
      return call<ApiPage<ApiTranscriptEntry>>(key, CALL.transcript, { conversationId: local, ...page }, ctx);
    },

    async snapshot(id, ctx) {
      const { key, local } = target(id);
      return snapshotOf(key, local, ctx);
    },

    async live(id, ctx) {
      const { key, local } = target(id);
      // Asked before the stream starts: an unknown conversation is a 404, not an empty stream.
      const first = await snapshotOf(key, local, ctx);
      return polled(first, () => snapshotOf(key, local, ctx), pollMs, polls, ctx.abortSignal);
    },

    async usage(id, ctx) {
      const { key, local } = target(id);
      return call<ApiUsage>(key, CALL.usage, { conversationId: local }, ctx);
    },

    async send(id, message, ctx) {
      const { key, local } = target(id);
      const sent = await call<ApiSendResponse>(key, CALL.message, { conversationId: local, ...(sendable(message) as object) } as JsonValue, ctx);
      return { key, requestId: sent.requestId, admission: sent.admission };
    },

    async abort(id, ctx) {
      const { key, local } = target(id);
      await call<JsonValue>(key, CALL.abort, { conversationId: local }, ctx);
      return { key, conversationId: id };
    },

    async reset(id, ctx) {
      const { key, local } = target(id);
      const reset = await call<ApiResetResponse>(key, CALL.reset, { conversationId: local }, ctx);
      return { key: reset.key, previousConversationId: qualify(key, reset.previousConversationId), conversationId: qualify(key, reset.conversationId) };
    },

    commands: (ctx) => call<ApiCommands>(INDEX_KEY, CALL.commands, null, ctx),

    async command(id, name, args, ctx) {
      const { key, local } = target(id);
      const answer = await call<ApiCommandResponse>(key, CALL.command, { conversationId: local, name, args }, ctx);
      return { key, ...(typeof answer.text === "string" && { text: answer.text }) };
    },
  };
}

/**
 * `first`, then what `next` answers every `pollMs` when it differs from the last one yielded, `polls`
 * answers in all (`first` among them). Ends early when `signal` aborts.
 */
export async function* polled(first: ApiEvent, next: () => Promise<ApiEvent>, pollMs: number, polls: number, signal: AbortSignal | undefined): AsyncGenerator<ApiEvent> {
  let last = JSON.stringify(first);
  yield first;
  for (let asked = 1; asked < polls; asked++) {
    if (!(await sleep(pollMs, signal))) return;
    const event = await next();
    const text = JSON.stringify(event);
    if (text === last) continue;
    last = text;
    yield event;
  }
}

/** Waits `ms`; `false` when `signal` aborted first. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => done(false);
    const timer = setTimeout(() => done(true), ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
