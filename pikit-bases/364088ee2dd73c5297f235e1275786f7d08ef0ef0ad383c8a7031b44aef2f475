/**
 * platform-cloudflare: `actor.mailbox`, `actor.inbox` and `wakeups` on Cloudflare (SPEC §4.1, C2 to C5).
 *
 * One component, installed in both Apps of a Cloudflare project (C1). What it does depends on the
 * App it starts in, which it reads from `WORKERS_HOST`:
 *
 * - **In the Worker's App** (no `object`): `actor.mailbox`. `send(key, type, message)` is an RPC to
 *   the conversation's Durable Object, `env[binding].get(env[binding].idFromName(key))
 *   .deliver(type, key, message)`. It resolves when the RPC does (the object's `actor.inbox` handler
 *   resolved), and rejects on any error, so the channel does not acknowledge its platform and the
 *   platform delivers again. Its `actor.inbox` and `wakeups` throw, saying they belong in an object.
 * - **In an object's App** (`object` present):
 *   - `wakeups`, as rows in the object's SQL (`platform_cloudflare_wakeups`, one per name)
 *     multiplexed over its one alarm. The alarm is set to the earliest row whose name has a handler,
 *     and set again whenever `at`, `cancel` or `handle` changes that. When it fires, it runs one slice
 *     (`sliceMs`), a small event loop: the due handlers run at the same time (one run per name), and
 *     while any still runs, requests that come due are run on time (a channel renewing "typing" while
 *     the runtime's handler waits for the model). At the slice's deadline the running handlers'
 *     contexts are cancelled, they ask again (`at(name, now)`) and resolve, and the alarm is set for
 *     what remains, so a long piece of work is a sequence of short alarms (C4).
 *   - `actor.inbox`, the RPC's other end: the actors' components register a handler per message
 *     type (`handle(type, handler)`, in their start), and `deliver(type, key, message)` calls the one
 *     for `type`, with a context of its own (cancelled when the App stops). Registered, not provided:
 *     this component depends on no handler, so an actor's component may also use `wakeups` (the
 *     runtime does) or `actor.mailbox` with no dependency cycle.
 *   - `actor.mailbox` too, so a component in the object can reach another conversation: another key
 *     is an RPC like the Worker's; this object's own key is a local call, which spends no subrequest
 *     and does not re-enter the object. (Its own key is the one whose `idFromName` is this object.)
 * - **Calls** (`call(key, type, message)`): an RPC to the object's `call`, as `send` is to its
 *   `deliver`, answered by the handler registered with `actor.inbox`'s `answer`. The object returns an
 *   outcome (`ActorCallOutcome`: the answer, or a code and a message), never throws one: an RPC keeps
 *   only an error's message, and the caller rebuilds the `ActorCallError` with its code. A failed RPC
 *   (the object did not start, the network) is `unreachable`.
 *
 * Durability (K6): a row is deleted only when its handler resolved. An alarm cut by the platform (a
 * deploy, 15 minutes of wall clock, an eviction) is retried by the platform and finds the row still
 * there; a handler that rejects gets its row moved by the backoff. At start, if rows exist, the
 * alarm is set again: a reset may have lost it.
 *
 * Target: `durable`. It imports nothing from `cloudflare:*`: what it uses of the object's storage
 * and of the namespace binding is typed here, structurally.
 */

import { type AppContext, defineComponent, withAbortSignal } from "@pikit/core";
import {
  type ActorCallHandler,
  ActorCallError,
  type ActorCallOutcome,
  type ActorInbox,
  type ActorInboxHandler,
  type ActorMailbox,
  answerCall,
  callResult,
  type JsonValue,
  type WakeupHandler,
  type Wakeups,
} from "@pikit/contracts";
import { WORKERS_HOST } from "@pikit/contracts/cloudflare";
import Type from "typebox";

const SECOND = 1_000;
/** The waits after a handler's 1st, 2nd, 3rd and 4th consecutive failure; the last repeats. */
export const BACKOFF_MS = [SECOND, 5 * SECOND, 30 * SECOND, 60 * SECOND] as const;
/** A slice never sleeps longer between two looks at its rows: no alarm leaves a longer timer behind. */
const LONGEST_SLEEP_MS = SECOND;
/** The rows of `wakeups`, one per name. */
export const WAKEUPS_TABLE = "platform_cloudflare_wakeups";

const Config = Type.Object({
  /** The Durable Object namespace binding of the conversation objects, in `wrangler.jsonc`. */
  binding: Type.String({ minLength: 1, default: "CONVERSATION" }),
  /**
   * How long one alarm runs handlers, in ms, before it cancels the running one's context. At most
   * 10 minutes: the platform cuts an alarm at 15 (C4; the README explains the default).
   */
  sliceMs: Type.Integer({ minimum: 1, maximum: 10 * 60 * SECOND, default: 60 * SECOND }),
});

/** What this component uses of a `DurableObjectStorage` (Cloudflare's type, written structurally). */
export interface ObjectStorage {
  sql: { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] } };
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** What it uses of a `DurableObjectNamespace` whose class has the `deliver` and `call` RPC methods. */
export interface ConversationNamespace {
  idFromName(name: string): unknown;
  get(id: never): {
    deliver(type: string, key: string, message: JsonValue): Promise<void>;
    call(type: string, key: string, message: JsonValue): Promise<ActorCallOutcome>;
  };
}

/** A pending request: its handler runs at or after `time`; `failures` in a row so far. */
interface Row {
  name: string;
  time: number;
  failures: number;
}

/** What the App holds while it runs. */
interface Running {
  env: Readonly<Record<string, unknown>>;
  /** Only in an object's App. */
  object?: { id: string; storage: ObjectStorage };
  stop: AbortController;
  /** The start context's values, cancelled when the App stops: for wakeup handlers and inbox handlers. */
  wakeup: AppContext;
  inbox: AppContext;
  /** Deliveries in progress, which `stop` waits for. */
  inFlight: Set<Promise<void>>;
  /** The alarm being handled, if one is. */
  alarm: Promise<void> | undefined;
}

export default defineComponent({
  name: "platform-cloudflare",
  config: Config,
  setup(pikit, config) {
    const { clock, logger } = pikit;
    /** The handler of each message type, registered by the actors' components in their start. */
    const inboxHandlers = new Map<string, ActorInboxHandler>();
    /** The handler of each call type (`answer`). */
    const callHandlers = new Map<string, ActorCallHandler>();
    const handlers = new Map<string, WakeupHandler>();
    /** The runs in progress, by name: `at` or `cancel` for a name during its run decides what its outcome does. */
    const inProgress = new Map<string, { touched: boolean }>();
    /** Wakes the slice in progress: a request, a handler or a run's end may change what it runs. */
    let nudge = () => {};
    /** The alarm time this App last set (`null`: deleted); `undefined` when it does not know. */
    let armed: number | null | undefined;
    /** Alarm changes, one after the other, so the last one set is the one `armed` says. */
    let line: Promise<void> = Promise.resolve();
    let running: Running | undefined;

    const opened = (): Running => {
      if (running === undefined) throw new Error("platform-cloudflare: used while the app is not running; use it from start or later");
      return running;
    };
    const objectOf = (r: Running): { id: string; storage: ObjectStorage } => {
      if (r.object === undefined) {
        throw new Error(
          "platform-cloudflare: wakeups exist only in a Durable Object's App, and this is the Worker's: a component that wakes belongs in the default export of pikit.config.ts.",
        );
      }
      return r.object;
    };
    const namespaceOf = (r: Running): ConversationNamespace => {
      const namespace = r.env[config.binding] as Partial<ConversationNamespace> | undefined;
      if (typeof namespace?.idFromName !== "function" || typeof namespace.get !== "function") {
        throw new Error(
          `platform-cloudflare: env.${config.binding} is not a Durable Object namespace: bind the conversation object's class under that name in wrangler.jsonc, or set "platform-cloudflare": { binding } in config.`,
        );
      }
      return namespace as ConversationNamespace;
    };

    // ---- wakeups: rows in the object's SQL, over its one alarm ----

    const rows = (storage: ObjectStorage): Row[] =>
      storage.sql.exec(`SELECT name, time, failures FROM ${WAKEUPS_TABLE} ORDER BY time, name`).toArray() as unknown as Row[];

    /**
     * Sets the object's alarm to the earliest request whose name has a handler (with `any`, the
     * earliest request at all), or deletes it when there is none. A request nobody handles yet does
     * not set it: it would fire for nothing, again and again. Skipped during an alarm, which sets it
     * when it ends.
     */
    const arm = (r: Running, any = false): Promise<void> => {
      const next = line.then(async () => {
        if (running !== r || r.alarm !== undefined) return;
        const storage = objectOf(r).storage;
        const earliest = rows(storage).find((row) => any || handlers.has(row.name));
        // An alarm fires on whole milliseconds: rounding up keeps it from firing before the time.
        const time = earliest === undefined ? null : Math.ceil(earliest.time);
        if (time === armed) return;
        armed = time;
        try {
          if (time === null) await storage.deleteAlarm();
          else await storage.setAlarm(time);
        } catch (error) {
          armed = undefined;
          throw error;
        }
      });
      line = next.catch(() => {});
      return next;
    };

    /** Records a run's outcome: done, or moved by the backoff, unless the run asked again itself. */
    const settle = (r: Running, row: Row, run: { touched: boolean }, error: unknown) => {
      const { storage } = objectOf(r);
      if (error === undefined) {
        if (!run.touched) storage.sql.exec(`DELETE FROM ${WAKEUPS_TABLE} WHERE name = ?`, row.name);
        else storage.sql.exec(`UPDATE ${WAKEUPS_TABLE} SET failures = 0 WHERE name = ?`, row.name);
        return;
      }
      // Cut by the app's stop: the row stays as it was, due, and runs again in the next App.
      if (running !== r) return;
      const failures = row.failures + 1;
      const retry = clock.now() + (BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] as number);
      // A request made during the run stands if sooner; a cancel during it deleted the row: no retry.
      const time = run.touched ? "MIN(time, ?)" : "?";
      storage.sql.exec(`UPDATE ${WAKEUPS_TABLE} SET time = ${time}, failures = ? WHERE name = ?`, retry, failures, row.name);
      const [next] = storage.sql.exec(`SELECT time FROM ${WAKEUPS_TABLE} WHERE name = ?`, row.name).toArray();
      logger.warn(`platform-cloudflare: the wakeup handler "${row.name}" failed; ${next === undefined ? "it was cancelled, so it does not run again" : "it runs again later"}`, {
        name: row.name,
        failures,
        ...(next !== undefined && { retryInMs: (next.time as number) - clock.now() }),
        error: error instanceof Error ? error.message : String(error),
      });
    };

    /**
     * One slice, a small event loop: it starts every due request whose handler is registered and
     * whose name is not running, then, while any runs, sleeps until the next request comes due, a run
     * ends or `at`, `cancel` or `handle` is called, and starts what is due again. It ends when nothing
     * runs, or at the slice's deadline, which cancels the running handlers' contexts (they ask again
     * and resolve) and starts nothing more; it resolves once every run it started settled. It rejects
     * when the storage failed, after cancelling and waiting for the runs.
     */
    const slice = async (r: Running): Promise<void> => {
      const { storage } = objectOf(r);
      const cut = new AbortController();
      const deadline = clock.now() + config.sliceMs;
      const ctx = r.wakeup.derive((inner) => withAbortSignal(cut.signal, inner));
      const settling = new Set<Promise<void>>();
      let failure: { error: unknown } | undefined;

      const begin = (row: Row, handler: WakeupHandler) => {
        const run = { touched: false };
        inProgress.set(row.name, run);
        const done = Promise.resolve()
          .then(() => handler(ctx))
          .then(
            () => undefined,
            (thrown: unknown) => thrown ?? new Error("rejected with nothing"),
          )
          .then((error) => settle(r, row, run, error))
          .catch((error: unknown) => void (failure ??= { error }))
          .finally(() => {
            inProgress.delete(row.name);
            settling.delete(done);
            nudge();
          });
        settling.add(done);
      };

      try {
        while (running === r && failure === undefined) {
          const woken = new Promise<void>((resolve) => (nudge = resolve));
          const now = clock.now();
          if (now >= deadline) {
            cut.abort(new Error(`platform-cloudflare: the slice deadline (${config.sliceMs} ms) passed; ask again for what remains`));
            break;
          }
          let next = deadline;
          for (const row of rows(storage)) {
            const handler = handlers.get(row.name);
            if (handler === undefined || inProgress.has(row.name)) continue;
            if (row.time <= now) begin(row, handler);
            else next = Math.min(next, row.time);
          }
          if (inProgress.size === 0) break;
          // A second at most: a clock's sleep cannot be cancelled, and a pending timer keeps the
          // object from being evicted, so a slice leaves none longer behind.
          await Promise.race([woken, clock.sleep(Math.min(next - now, LONGEST_SLEEP_MS))]);
        }
      } catch (error) {
        failure ??= { error };
      } finally {
        nudge = () => {};
      }
      if (failure !== undefined) cut.abort(failure.error);
      while (settling.size > 0) await Promise.all(settling);
      if (failure !== undefined) throw failure.error;
    };

    /** What the object's alarm calls. A stopped App's does nothing: the next App's start sets the alarm again. */
    const onAlarm = (r: Running) => async (): Promise<void> => {
      // The platform runs one alarm at a time; this guards against a caller that does not.
      if (running !== r || r.alarm !== undefined) return;
      armed = undefined; // the platform took the alarm that fired
      r.alarm = slice(r);
      try {
        await r.alarm;
      } finally {
        r.alarm = undefined;
      }
      // A rejection here (the storage failed) rejects the alarm: the platform retries it.
      await arm(r);
    };

    const nameOf = (name: string): string => {
      if (typeof name !== "string" || name === "") throw new TypeError("platform-cloudflare: a wakeup's name is a non-empty string, named after the component that owns it");
      return name;
    };

    const wakeups: Wakeups = {
      handle(name, handler) {
        if (handlers.has(nameOf(name))) {
          throw new Error(`platform-cloudflare: "${name}" already has a handler; a name has one owner, so give each handler its own (prefixed with your component's name)`);
        }
        const r = opened();
        objectOf(r);
        handlers.set(name, handler);
        nudge();
        // A request that waited for this handler sets the alarm now (or the slice in progress runs it).
        arm(r).catch((error: unknown) => logger.error("platform-cloudflare: could not set the object's alarm", { error: String(error) }));
      },
      async at(name, time) {
        nameOf(name);
        if (!Number.isFinite(time)) throw new TypeError(`platform-cloudflare: the time for "${name}" must be a finite number of epoch milliseconds, got ${time}`);
        const r = opened();
        objectOf(r).storage.sql.exec(
          `INSERT INTO ${WAKEUPS_TABLE} (name, time) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET time = excluded.time`,
          name,
          time,
        );
        const run = inProgress.get(name);
        if (run !== undefined) run.touched = true;
        nudge();
        await arm(r);
      },
      async cancel(name) {
        const r = opened();
        objectOf(r).storage.sql.exec(`DELETE FROM ${WAKEUPS_TABLE} WHERE name = ?`, name);
        const run = inProgress.get(name);
        if (run !== undefined) run.touched = true;
        nudge();
        await arm(r);
      },
    };
    pikit.provide("wakeups", wakeups);

    // ---- actor.mailbox and the RPC's other end ----

    /** Calls this App's `actor.inbox` handler for `type`; `stop` waits for it. */
    const deliver = (r: Running, type: string, key: string, message: JsonValue): Promise<void> => {
      const handler = inboxHandlers.get(type);
      if (handler === undefined) {
        const known = [...inboxHandlers.keys()];
        throw new Error(
          `platform-cloudflare: no actor.inbox handler for the type "${type}" in the conversation object's App (handled: ${known.length > 0 ? known.join(", ") : "none"}); ` +
            "install the component that handles it in the default export of pikit.config.ts, or check the type the sender names",
        );
      }
      const handled = Promise.resolve().then(() => handler(key, message, r.inbox));
      const settled = handled.catch(() => {});
      r.inFlight.add(settled);
      void settled.then(() => r.inFlight.delete(settled));
      return handled;
    };

    /** What the object's `deliver` RPC calls. */
    const onDeliver = (r: Running) => async (type: string, key: string, message: JsonValue): Promise<void> => {
      if (running !== r) throw new Error("platform-cloudflare: the conversation object's App is not running; the message was not delivered, and the sender's platform delivers it again");
      await deliver(r, type, key, message);
    };

    /** Runs this App's answer handler for `type`; never rejects: the outcome says what came of it. `stop` waits for it. */
    const answerHere = (r: Running, type: string, key: string, message: JsonValue): Promise<ActorCallOutcome> => {
      if (running !== r) return Promise.resolve({ ok: false, code: "unreachable", message: "platform-cloudflare: the conversation object's App is not running" });
      const handler = callHandlers.get(type);
      if (handler === undefined) {
        const known = [...callHandlers.keys()];
        return Promise.resolve({
          ok: false,
          code: "no_handler",
          message:
            `platform-cloudflare: no actor.inbox answer handler for the call type "${type}" in the conversation object's App (answered: ${known.length > 0 ? known.join(", ") : "none"}); ` +
            "install the component that answers it in the default export of pikit.config.ts, or check the type the caller names",
        });
      }
      const answered = answerCall(handler, key, message, r.inbox);
      const settled = answered.then(() => {});
      r.inFlight.add(settled);
      void settled.then(() => r.inFlight.delete(settled));
      return answered;
    };

    const actorInbox: ActorInbox = {
      handle(type, handler) {
        if (typeof type !== "string" || type === "") throw new TypeError("platform-cloudflare: a message type is a non-empty string, prefixed with the component that handles it");
        if (opened().object === undefined) {
          throw new Error(
            "platform-cloudflare: actor.inbox exists only in a Durable Object's App, and this is the Worker's: a component that handles messages (a channel's object half) belongs in the default export of pikit.config.ts.",
          );
        }
        if (inboxHandlers.has(type)) throw new Error(`platform-cloudflare: the message type "${type}" already has a handler; a type has one handler in an app`);
        inboxHandlers.set(type, handler);
      },
      answer(type, handler) {
        if (typeof type !== "string" || type === "") throw new TypeError("platform-cloudflare: a call type is a non-empty string, prefixed with the component that answers it");
        if (opened().object === undefined) {
          throw new Error(
            "platform-cloudflare: actor.inbox exists only in a Durable Object's App, and this is the Worker's: a component that answers calls belongs in the default export of pikit.config.ts.",
          );
        }
        if (callHandlers.has(type)) throw new Error(`platform-cloudflare: the call type "${type}" already has a handler; a type has one answer handler in an app`);
        callHandlers.set(type, handler);
      },
    };
    pikit.provide("actor.inbox", actorInbox);

    const mailbox: ActorMailbox = {
      async send(key, type, message, ctx) {
        const r = opened();
        if (typeof key !== "string" || key === "") throw new TypeError(`platform-cloudflare: the key of a "${type}" message must be a non-empty string`);
        const copy = copyOf(message, type);
        ctx.abortSignal?.throwIfAborted();
        const namespace = namespaceOf(r);
        const id = namespace.idFromName(key);
        if (r.object !== undefined && String(id) === r.object.id) {
          // This object's own conversation: no RPC to itself.
          return untilCancelled(deliver(r, type, key, copy), ctx.abortSignal);
        }
        // RPC: the object's `deliver` resolves once its handler did. `Promise.resolve` adopts the
        // RPC's thenable result.
        return untilCancelled(Promise.resolve(namespace.get(id as never).deliver(type, key, copy)), ctx.abortSignal);
      },
      async call(key, type, message, ctx) {
        const r = running;
        if (r === undefined) throw new ActorCallError("unreachable", "platform-cloudflare: used while the app is not running; call from start or later");
        if (typeof key !== "string" || key === "") throw new ActorCallError("invalid", `platform-cloudflare: the key of a "${type}" call must be a non-empty string`);
        const text = JSON.stringify(message) as string | undefined;
        if (text === undefined) throw new ActorCallError("invalid", `platform-cloudflare: a "${type}" call's message must be JSON (not undefined or a function)`);
        const copy = JSON.parse(text) as JsonValue;
        if (ctx.abortSignal?.aborted) throw new ActorCallError("cancelled", `platform-cloudflare: the "${type}" call was cancelled before it was made`, { cause: ctx.abortSignal.reason });
        const namespace = namespaceOf(r);
        const id = namespace.idFromName(key);
        const outcome =
          r.object !== undefined && String(id) === r.object.id
            ? answerHere(r, type, key, copy)
            : Promise.resolve()
                .then(() => namespace.get(id as never).call(type, key, copy))
                .catch((error: unknown): ActorCallOutcome => ({ ok: false, code: "unreachable", message: `platform-cloudflare: the conversation object of "${key}" could not be reached: ${error instanceof Error ? error.message : String(error)}` }));
        const answered = await untilCancelled(outcome, ctx.abortSignal).catch((reason: unknown) => {
          throw new ActorCallError("cancelled", `platform-cloudflare: the "${type}" call was cancelled before it was answered`, { cause: reason });
        });
        return callResult(answered);
      },
    };
    pikit.provide("actor.mailbox", mailbox);

    return {
      async start(ctx) {
        const host = ctx.value(WORKERS_HOST);
        if (host === undefined) {
          throw new Error(
            "platform-cloudflare: no WORKERS_HOST in the start context: it runs only on Cloudflare, in the Apps deployment-cloudflare starts. On a server, use mailbox-local and wakeups-timers.",
          );
        }
        const stop = new AbortController();
        // The start context's values, with the app's stop as the only cancellation: start's own
        // deadline must not cut a handler that runs later.
        const own = (name: string) => ctx.derive((inner) => ({ abortSignal: stop.signal, value: (key) => inner.value(key), toString: () => `${inner}.${name}` }));
        const r: Running = { env: host.env, stop, wakeup: own("Wakeup"), inbox: own("Inbox"), inFlight: new Set(), alarm: undefined };

        if (host.object === undefined) {
          // The Worker's App: only the mailbox, which needs the namespace.
          namespaceOf(r);
          running = r;
          return;
        }
        const storage = host.object.storage;
        if (!isObjectStorage(storage)) {
          throw new Error(
            "platform-cloudflare: the Durable Object's storage has no SQL API: declare its class in new_sqlite_classes (not new_classes) in the migrations of wrangler.jsonc.",
          );
        }
        storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${WAKEUPS_TABLE} (name TEXT PRIMARY KEY, time REAL NOT NULL, failures INTEGER NOT NULL DEFAULT 0)`);
        r.object = { id: host.object.id, storage };
        armed = undefined;
        running = r;
        host.object.onAlarm(onAlarm(r));
        host.object.onDeliver(onDeliver(r));
        host.object.onCall?.((type, key, message) => answerHere(r, type, key, message));
        // A deploy or a reset may have lost the alarm; the handlers are not registered yet, so any row sets it.
        if (rows(storage).length > 0) await arm(r, true);
      },
      async stop(ctx) {
        const stopping = running;
        running = undefined;
        if (stopping === undefined) return;
        // Running handlers see their context cancelled and finish at a consistent point. The wait is
        // bounded by the stop's own deadline; the rows stay, so what did not finish runs again.
        stopping.stop.abort(new Error("platform-cloudflare: the app is stopping"));
        const pending = Promise.all([stopping.alarm, ...stopping.inFlight]).then(() => {});
        await untilCancelled(pending, ctx.abortSignal).catch(() => {});
        handlers.clear();
        inboxHandlers.clear();
        callHandlers.clear();
      },
    };
  },
});

function isObjectStorage(storage: unknown): storage is ObjectStorage {
  const candidate = storage as Partial<ObjectStorage> | undefined;
  try {
    return typeof candidate?.sql?.exec === "function" && typeof candidate.setAlarm === "function";
  } catch {
    // An object without SQLite (declared in `new_classes`) throws when `sql` is read.
    return false;
  }
}

/** A JSON copy of `message`, or a TypeError naming the type when it is not JSON. */
function copyOf(message: JsonValue, type: string): JsonValue {
  const text = JSON.stringify(message) as string | undefined;
  if (text === undefined) throw new TypeError(`platform-cloudflare: a "${type}" message must be JSON (not undefined or a function)`);
  return JSON.parse(text) as JsonValue;
}

/** `work`, or a rejection with `signal`'s reason as soon as it is cancelled. `work` goes on either way. */
function untilCancelled<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
