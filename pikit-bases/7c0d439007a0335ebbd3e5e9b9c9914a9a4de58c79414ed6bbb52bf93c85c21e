/**
 * conversations-kv: the conversation registry in `storage.kv` (`conversations.registry`,
 * in @pikit/contracts' conversations.ts; SPEC §4.1, C5).
 *
 * It provides `conversations.registry`: which runtime conversation each conversation key is in now.
 * The first message of a conversation creates its conversation (through `agent.conversations`, which
 * the agent runtime provides) and records the pointer; a reset creates a new conversation and moves
 * the pointer, keeping the old conversation and remembering it. No pointer is ever deleted, and
 * nothing here is dropped when a conversation goes idle.
 *
 * Dependency direction: the registry uses `agent.conversations`, the runtime never uses the registry.
 * So the runtime starts first, and conversations are created only once it runs.
 *
 * Each pointer is one value in the namespace `conversations-kv`, at the conversation's key. The
 * store is the record and nothing is cached: every call reads it, so a new worker (a restarted
 * server, an evicted Durable Object) finds what the last one wrote.
 *
 * `storage.kv` has no transaction across calls, so this is what holds:
 * - **A first pointer is written with `setIfAbsent`**: of racing first resolves, exactly one
 *   writes, and every one of them returns that pointer. In one process the racers wait for each
 *   other and create one conversation; across processes, each loser leaves an unused conversation behind.
 * - **Nothing overwrites a first pointer but a reset**, and a reset changes only a pointer that
 *   exists, so a resolve never undoes a reset and a reset never undoes a resolve.
 * - **In one process, the changes to one key run one at a time**: two resets move the pointer
 *   twice and remember both previous conversations. Across processes, two resets of one key at once both
 *   succeed and the last write wins: the other's new conversation exists but is neither the current one
 *   nor in `previousConversationIds`. On Cloudflare one Durable Object owns a conversation (SPEC §4.1
 *   C1), so this does not happen there; on a server, run one replica, as with conversations-file.
 * - **A pointer is used only once it is stored**, and `conversation.reset` is emitted after that.
 *   A crash between creating a conversation and storing its pointer leaves an unused conversation behind,
 *   never a pointer to a conversation that does not exist.
 *
 * Targets: `server` and `durable`: it imports nothing platform-specific, and its records are
 * whatever provides `storage.kv` there.
 */

import { type AppContext, defineComponent } from "@pikit/core";
import type { ConversationRef, ConversationRegistry, ConversationReset, KeyValueStore } from "@pikit/contracts";
import Type, { type Static } from "typebox";
import Value from "typebox/value";

/** The namespace of `storage.kv` the pointers live in, named after the component. */
export const NAMESPACE = "conversations-kv";

/** One conversation's pointer, the value stored at its key. */
const Pointer = Type.Object({
  agent: Type.String({ minLength: 1 }),
  conversationId: Type.String({ minLength: 1 }),
  /** Conversations this key was in before, oldest first. Kept, never deleted. */
  previousConversationIds: Type.Array(Type.String()),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});
type Pointer = Static<typeof Pointer>;

export default defineComponent({
  name: "conversations-kv",
  setup(pikit) {
    const kv = pikit.use("storage.kv");
    const conversations = pikit.use("agent.conversations");

    let store: KeyValueStore | undefined;
    /**
     * The changes in progress, by key: a change waits for the one before it on the same key, so a
     * first resolve and its concurrent twin create one conversation, and two resets both count. A `Map`,
     * not an object: keys are opaque and may be `__proto__`.
     */
    const lines = new Map<string, Promise<unknown>>();
    const inLine = <T>(key: string, work: () => Promise<T>): Promise<T> => {
      const next = (lines.get(key) ?? Promise.resolve()).then(work);
      const settled = next.then(
        () => {},
        () => {},
      );
      lines.set(key, settled);
      // The last change on a key removes the line, so idle keys cost no memory.
      void settled.then(() => {
        if (lines.get(key) === settled) lines.delete(key);
      });
      return next;
    };

    const running = (): KeyValueStore => {
      if (store === undefined) throw new Error("conversations-kv: conversations.registry used while the app is not running");
      return store;
    };
    const ref = (key: string, pointer: Pointer): ConversationRef => ({ key, agent: pointer.agent, conversationId: pointer.conversationId });

    /** The pointer stored at `key`, `undefined` when there is none. A value that is not a pointer fails. */
    const current = async (from: KeyValueStore, key: string): Promise<Pointer | undefined> => {
      const value = await from.get(key);
      if (value === undefined || Value.Check(Pointer, value)) return value;
      const [first] = Value.Errors(Pointer, value);
      throw new Error(`conversations-kv: the value at ${JSON.stringify(key)} is not a conversation pointer (${first?.instancePath || "/"}: ${first?.message})`);
    };

    /** A new, empty conversation in the agent runtime. */
    const newConversation = (ctx: AppContext): Promise<string> => conversations.get().create(ctx);

    const registry: ConversationRegistry = {
      resolve: (key, agent, ctx) =>
        inLine(key, async () => {
          const from = running();
          const found = await current(from, key);
          if (found !== undefined) return ref(key, found);
          const now = ctx.clock.now();
          const pointer: Pointer = { agent, conversationId: await newConversation(ctx), previousConversationIds: [], createdAt: now, updatedAt: now };
          if (await from.setIfAbsent(key, pointer)) return ref(key, pointer);
          // Another process wrote first: its pointer is the conversation, and the conversation created
          // above stays unused. It may have been reset since; either way it is there, as no pointer
          // is ever deleted.
          const winner = await current(from, key);
          if (winner === undefined) throw new Error(`conversations-kv: the pointer at ${JSON.stringify(key)} was deleted`);
          return ref(key, winner);
        }),

      async get(key) {
        const found = await current(running(), key);
        return found === undefined ? undefined : ref(key, found);
      },

      async reset(key, ctx, agent) {
        const reset = await inLine(key, async (): Promise<ConversationReset | undefined> => {
          const from = running();
          const previous = await current(from, key);
          if (previous === undefined) return undefined;
          const pointer: Pointer = {
            ...previous,
            // Another agent only when asked: the key's own is gone (`admitInbound`).
            ...(agent !== undefined && { agent }),
            conversationId: await newConversation(ctx),
            previousConversationIds: [...previous.previousConversationIds, previous.conversationId],
            updatedAt: ctx.clock.now(),
          };
          await from.set(key, pointer);
          return { conversation: ref(key, pointer), previousConversationId: previous.conversationId, newConversationId: pointer.conversationId };
        });
        // Only once the pointer is stored, and outside the line: a listener may call the registry.
        if (reset !== undefined) await ctx.emit("conversation.reset", reset);
        return reset;
      },
    };
    pikit.provide("conversations.registry", registry);

    return {
      start() {
        store = kv.get().namespace(NAMESPACE);
      },
      async stop(ctx) {
        store = undefined;
        // Let the changes in progress reach the store; the stop deadline bounds the wait.
        await untilAborted(Promise.all(lines.values()), ctx.abortSignal);
      },
    };
  },
});

function untilAborted(work: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
  const settled = work.then(
    () => {},
    () => {},
  );
  if (signal === undefined) return settled;
  return Promise.race([
    settled,
    new Promise<void>((done) => {
      if (signal.aborted) done();
      signal.addEventListener("abort", () => done(), { once: true });
    }),
  ]);
}
