/**
 * conversations-kv: the conversation registry in `storage.kv` (SPEC §7.4, §7.6, §4.1 C5).
 *
 * It provides `conversations.registry`: which Pi session each conversation key is in now. The first
 * message of a conversation creates its session (through `sessions.store`) and records the pointer;
 * a reset creates a new session and moves the pointer, keeping the old session and remembering it.
 * No pointer is ever deleted, and nothing here is dropped when a conversation goes idle.
 *
 * Each pointer is one value in the namespace `conversations-kv`, at the conversation's key. The
 * store is the record and nothing is cached: every call reads it, so a new worker (a restarted
 * server, an evicted Durable Object) finds what the last one wrote.
 *
 * `storage.kv` has no transaction across calls, so this is what holds:
 * - **A first pointer is written with `setIfAbsent`**: of racing first resolves, exactly one
 *   writes, and every one of them returns that pointer. In one process the racers wait for each
 *   other and create one session; across processes, each loser leaves an unused session behind.
 * - **Nothing overwrites a first pointer but a reset**, and a reset changes only a pointer that
 *   exists, so a resolve never undoes a reset and a reset never undoes a resolve.
 * - **In one process, the changes to one key run one at a time**: two resets move the pointer
 *   twice and remember both previous sessions. Across processes, two resets of one key at once both
 *   succeed and the last write wins: the other's new session exists but is neither the current one
 *   nor in `previousSessionIds`. On Cloudflare one Durable Object owns a conversation (SPEC §4.1
 *   C1), so this does not happen there; on a server, run one replica, as with conversations-file.
 * - **A pointer is used only once it is stored**, and `conversation.reset` is emitted after that.
 *   A crash between creating a session and storing its pointer leaves an unused session behind,
 *   never a pointer to a session that does not exist.
 *
 * Targets: `server` and `cloudflare`: it imports nothing platform-specific, and its records are
 * whatever provides `storage.kv` there.
 */

import { type AppContext, defineComponent } from "@pikit/core";
import type { ConversationRef, ConversationRegistry, ConversationReset, KeyValueStore } from "@pikit/contracts";
import type { SessionStore } from "@pikit/pi-adapter";
import Type, { type Static } from "typebox";
import Value from "typebox/value";

/** The namespace of `storage.kv` the pointers live in, named after the component. */
export const NAMESPACE = "conversations-kv";

/** One conversation's pointer, the value stored at its key. */
const Pointer = Type.Object({
  agent: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
  /** Sessions this conversation was in before, oldest first. Kept, never deleted (§7.6). */
  previousSessionIds: Type.Array(Type.String()),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
});
type Pointer = Static<typeof Pointer>;

export default defineComponent({
  name: "conversations-kv",
  setup(pikit) {
    const kv = pikit.use("storage.kv");
    const sessions = pikit.use("sessions.store");

    let store: KeyValueStore | undefined;
    /**
     * The changes in progress, by key: a change waits for the one before it on the same key, so a
     * first resolve and its concurrent twin create one session, and two resets both count. A `Map`,
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
    const ref = (key: string, pointer: Pointer): ConversationRef => ({ key, agent: pointer.agent, sessionId: pointer.sessionId });

    /** The pointer stored at `key`, or `undefined`. A value that is not a pointer fails. */
    const read = async (from: KeyValueStore, key: string): Promise<Pointer | undefined> => {
      const value = await from.get(key);
      if (value === undefined || Value.Check(Pointer, value)) return value;
      const [first] = Value.Errors(Pointer, value);
      throw new Error(`conversations-kv: the value at ${JSON.stringify(key)} is not a conversation pointer (${first?.instancePath || "/"}: ${first?.message})`);
    };

    /** A new, empty session. Closed at once: the agent runtime opens it when a message comes. */
    const newSession = async (sessionStore: SessionStore, ctx: AppContext): Promise<string> => {
      const session = await sessionStore.create({}, ctx);
      await session.close(ctx);
      return session.metadata.id;
    };

    const registry: ConversationRegistry = {
      resolve: (key, agent, ctx) =>
        inLine(key, async () => {
          const from = running();
          const found = await read(from, key);
          if (found !== undefined) return ref(key, found);
          const now = ctx.clock.now();
          const pointer: Pointer = { agent, sessionId: await newSession(sessions.get(), ctx), previousSessionIds: [], createdAt: now, updatedAt: now };
          if (await from.setIfAbsent(key, pointer)) return ref(key, pointer);
          // Another process wrote first: its pointer is the conversation, and the session created
          // above stays unused. It may have been reset since; either way it is there, as no pointer
          // is ever deleted.
          const winner = await read(from, key);
          if (winner === undefined) throw new Error(`conversations-kv: the pointer at ${JSON.stringify(key)} was deleted`);
          return ref(key, winner);
        }),

      async get(key) {
        const found = await read(running(), key);
        return found === undefined ? undefined : ref(key, found);
      },

      async reset(key, ctx) {
        const reset = await inLine(key, async (): Promise<ConversationReset | undefined> => {
          const from = running();
          const previous = await read(from, key);
          if (previous === undefined) return undefined;
          const pointer: Pointer = {
            ...previous,
            sessionId: await newSession(sessions.get(), ctx),
            previousSessionIds: [...previous.previousSessionIds, previous.sessionId],
            updatedAt: ctx.clock.now(),
          };
          await from.set(key, pointer);
          return { conversation: ref(key, pointer), previousSessionId: previous.sessionId, newSessionId: pointer.sessionId };
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
