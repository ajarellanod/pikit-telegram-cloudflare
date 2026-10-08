/**
 * Conversation titles, made by a model (`model.complete`) once per conversation (a reset's new one
 * gets its own), after its first run settles, in the background: no request waits for one, and a failure is logged and tried once
 * more after a later run (`TITLE_TRIES`). The operator's `/name` replaces a title, and a model never
 * replaces the operator's (`conversation-index.ts`).
 *
 * - **What is titled**: the conversation's first message, its text as written (the operator's note
 *   line taken off), at most `TITLE_INPUT` characters. A first message with no text is not titled.
 * - **The model**: admin-api's `titleModel` when set, else the conversation's agent's.
 * - **The answer** is cleaned (`cleanTitle`: one line, no quotes, at most `TITLE_MAX` characters);
 *   one with nothing left is a failure.
 * - **At start** (`untitled`), the most recently active conversations with no title yet (made before
 *   titles existed, or before admin-api was installed) are titled from their first message, one at a
 *   time and at most `UNTITLED_PER_START` per start: an old history costs a few model calls, never
 *   hundreds.
 * - **A model that reasons** thinks besides the title's `TITLE_TOKENS`: `model.complete` leaves it room.
 */

import type { AppContext } from "@pikit/core";
import type { AgentResult, ModelComplete } from "@pikit/contracts";
import { cleanTitle, OPERATOR_NOTE } from "./api.ts";
import type { ConversationIndex } from "./conversation-index.ts";

/** What the model is told. */
export const TITLE_SYSTEM =
  "You title conversations. Reply with a title of 2 to 6 words for the conversation that starts with the user's message, " +
  "in the language of that message. Reply with the title only: no quotes, no punctuation at the end, no explanation.";
/** The longest text a model is asked to title, in characters. */
export const TITLE_INPUT = 1_000;
/** The most tokens a title may take. */
export const TITLE_TOKENS = 32;
/** The conversations with no title titled at one start, the most recently active first. */
export const UNTITLED_PER_START = 20;

/** What was written in a user message (pi-ai's JSON), without the operator's note line; `undefined` for another. */
export function userTextOf(message: unknown): string | undefined {
  const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
  if (role !== "user") return undefined;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap((part: { type?: unknown; text?: unknown }) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
        : "";
  if (!text.startsWith(OPERATOR_NOTE)) return text;
  const newline = text.indexOf("\n");
  return newline === -1 ? "" : text.slice(newline + 1);
}

/** The first text a user wrote among `messages`, trimmed, at most `TITLE_INPUT` characters; `undefined` when none. */
export function firstTextOf(messages: readonly unknown[]): string | undefined {
  for (const message of messages) {
    const text = userTextOf(message)?.trim();
    if (text !== undefined && text !== "") return text.slice(0, TITLE_INPUT);
  }
  return undefined;
}

export interface TitlerOptions {
  index(): ConversationIndex;
  /** `model.complete`, when installed: without it no title is made. */
  complete(): ModelComplete | undefined;
  /** The model a conversation of `agent` is titled with: `titleModel`, else the agent's. */
  modelFor(agent: string): string | undefined;
}

/**
 * Titles the key of a run that settled, unless it has a title or had its tries: `settled` is the
 * `agent.settled` handler's body, which starts the work and returns at once; `idle` waits for what is
 * under way (at stop).
 */
export function createTitler(options: TitlerOptions) {
  /** Conversations being titled now, in this App: one try at a time. */
  const titling = new Set<string>();
  const work = new Set<Promise<void>>();

  const title = async (conversation: { key: string; conversationId: string; agent: string }, messages: readonly unknown[], ctx: AppContext): Promise<void> => {
    const { key, conversationId, agent } = conversation;
    const complete = options.complete();
    const input = firstTextOf(messages);
    const model = options.modelFor(agent);
    if (complete === undefined || model === undefined) return;
    // A run whose messages hold no text (images only) leaves the title to a later one.
    if (input === undefined) return;
    const claim = await options.index().titling(conversationId, input);
    if (claim === undefined) return;
    try {
      const answer = await complete.complete({ model, system: TITLE_SYSTEM, prompt: claim.input, maxTokens: TITLE_TOKENS }, ctx);
      const made = cleanTitle(answer);
      if (made === undefined) throw new Error("the model's answer had no title in it");
      await options.index().titled(conversationId, made);
      ctx.logger.info("admin-api: a model titled a conversation", { conversation: key, conversationId, model });
    } catch (error) {
      ctx.logger.warn("admin-api: a model did not title this conversation; it is tried once more after a later run", {
        conversation: key,
        conversationId,
        model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    /** Starts titling `result`'s conversation in the background, in `ctx` (one that outlives the event). */
    settled(result: AgentResult, ctx: AppContext): void {
      const { conversationId } = result.conversation;
      if (result.kind !== "completed" || titling.has(conversationId)) return;
      titling.add(conversationId);
      const done = title(result.conversation, result.messages as unknown[], ctx)
        .catch((error: unknown) =>
          ctx.logger.warn("admin-api: a conversation could not be titled", { conversation: result.conversation.key, error: error instanceof Error ? error.message : String(error) }),
        )
        .finally(() => {
          titling.delete(conversationId);
          work.delete(done);
        });
      work.add(done);
    },
    /**
     * Titles the `conversations` that have none, the most recently active first, at most
     * `UNTITLED_PER_START`, one at a time: `firstMessages` reads a conversation's first messages.
     */
    async untitled(
      conversations: readonly { key: string; agent: string; conversationId: string; at: number }[],
      firstMessages: (conversationId: string) => Promise<readonly unknown[]>,
      ctx: AppContext,
    ): Promise<number> {
      if (options.complete() === undefined) return 0;
      let titled = 0;
      for (const each of [...conversations].sort((a, b) => b.at - a.at)) {
        if (titled >= UNTITLED_PER_START || ctx.abortSignal?.aborted === true) break;
        if (titling.has(each.conversationId) || (await options.index().title(each.conversationId)).title !== undefined) continue;
        titling.add(each.conversationId);
        try {
          await title(each, await firstMessages(each.conversationId), ctx);
          titled++;
        } catch (error) {
          ctx.logger.warn("admin-api: a conversation could not be titled", { conversation: each.key, error: error instanceof Error ? error.message : String(error) });
        } finally {
          titling.delete(each.conversationId);
        }
      }
      return titled;
    },
    /** Resolves once the titles under way are done. */
    async idle(): Promise<void> {
      await Promise.all([...work]);
    },
  };
}
