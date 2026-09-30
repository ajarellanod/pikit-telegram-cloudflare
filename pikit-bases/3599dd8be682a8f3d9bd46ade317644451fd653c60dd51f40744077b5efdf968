/**
 * What the Worker and each `Conversation` Durable Object do with the project's two Apps (SPEC §4.1,
 * C1, C4, C5), with no `cloudflare:*` import: `entrypoint.ts` hands them the platform's objects, typed
 * here by what is used of them, so this file runs under `bun test` as well as in workerd.
 *
 * - **The object** (`createObjectHost`) composes `pikit.config.ts`'s default export once per object,
 *   on its first event (an RPC or an alarm), inside `blockConcurrencyWhile`: no other event reaches the
 *   object before its App has started. Its start context carries `WORKERS_HOST` with the object: its
 *   id, its storage, and the hooks its alarm and its `deliver` RPC call. A start that fails or passes
 *   its deadline is rolled back within a deadline of its own and rethrown, so Cloudflare resets the
 *   object and the next event starts over (K2, K6). The App is never stopped otherwise: an object is
 *   evicted without warning, and whatever must survive is already committed.
 * - **The Worker** (`createWorkerHost`) composes `export const worker` once per isolate, on its first
 *   request, with `WORKERS_HOST` `{ env, origin }` on its start context (`origin`: that request's, where
 *   the Worker is reached), and serves its `http.route`s, as
 *   `server-bun` does on a server. `GET /health` is its own: public, it starts the Worker's App and
 *   one object's App, and answers `{ ok, version }` with the version Cloudflare is running, which is
 *   how `up` knows a deploy has reached every request (C8).
 */

import {
  type App,
  type AppContext,
  type AppDefinition,
  BACKGROUND_CONTEXT,
  type Context,
  consoleLogger,
  defineApp,
  defineComponent,
  type Logger,
  withAbortSignal,
  withContextValue,
} from "@pikit/core";
import { type HttpRoute, type JsonValue, WORKERS_HOST, type WorkersHost } from "@pikit/contracts";

/**
 * Longest an App's start may take. An object's start runs inside `blockConcurrencyWhile`, which
 * Cloudflare cuts at 30 s by resetting the object: the start and its rollback end well before.
 */
export const START_DEADLINE_MS = 20_000;
/** Longest the rollback of a failed start may take, after which the error is rethrown anyway. */
export const ROLLBACK_DEADLINE_MS = 5_000;
/** The Durable Object binding in `wrangler.jsonc`: the `Conversation` class. */
export const OBJECT_BINDING = "CONVERSATION";
/** The object `GET /health` starts: one of its own, never a conversation's. */
export const HEALTH_OBJECT = "pikit:health";
/** The `version_metadata` binding in `wrangler.jsonc`: the version `GET /health` reports. */
export const VERSION_BINDING = "CF_VERSION_METADATA";

export interface HostOptions {
  /** Default: the core's `consoleLogger`: Workers Logs and `wrangler tail` show it. */
  logger?: Logger;
  /** Default: `START_DEADLINE_MS`. */
  startDeadlineMs?: number;
  /** Default: `ROLLBACK_DEADLINE_MS`. */
  rollbackDeadlineMs?: number;
}

/** What the entrypoint uses of a `DurableObjectState` (Cloudflare's type, written structurally). */
export interface ObjectState {
  id: { toString(): string };
  /** The object's `DurableObjectStorage`, passed on untouched in `WORKERS_HOST`. */
  storage: unknown;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/** What the `Conversation` class forwards to: one per object instance. */
export interface ObjectHost {
  /** Starts the App if it has not started; rejects as the start did. */
  health(): Promise<{ ok: true }>;
  /** The object's alarm: the handler a component registered with `onAlarm`. A rejection makes Cloudflare retry it. */
  alarm(): Promise<void>;
  /** A message for this object (`actor.mailbox`'s RPC): the handler a component registered with `onDeliver`. */
  deliver(type: string, key: string, message: JsonValue): Promise<void>;
}

type AlarmHandler = () => Promise<void>;
type DeliverHandler = (type: string, key: string, message: JsonValue) => Promise<void>;

export function createObjectHost(definition: AppDefinition, state: ObjectState, env: WorkersHost["env"], options: HostOptions = {}): ObjectHost {
  const logger = options.logger ?? consoleLogger;
  let onAlarm: AlarmHandler | undefined;
  let onDeliver: DeliverHandler | undefined;
  const host: WorkersHost = {
    env,
    object: {
      id: state.id.toString(),
      storage: state.storage,
      // One of each: the object has one alarm and one RPC entry, and one component multiplexes each
      // (platform-cloudflare's wakeups and mailbox). A second one is a composition mistake, said loudly.
      onAlarm(handler) {
        if (onAlarm !== undefined) throw new Error("deployment-cloudflare: the object's alarm already has a handler; one component multiplexes the alarm (wakeups)");
        onAlarm = handler;
      },
      onDeliver(handler) {
        if (onDeliver !== undefined) throw new Error("deployment-cloudflare: the object's deliveries already have a handler; one component receives them (actor.inbox)");
        onDeliver = handler;
      },
    },
  };

  let started: Promise<void> | undefined;
  const start = (): Promise<void> =>
    (started ??= state
      .blockConcurrencyWhile(async () => {
        // A new App registers its own handlers; a failed one's are gone with it.
        onAlarm = undefined;
        onDeliver = undefined;
        const app = await compose(definition, [], logger);
        await startWithin(app, withContextValue(WORKERS_HOST, host, BACKGROUND_CONTEXT), options, logger);
        logger.info("pikit: object started", { object: host.object?.id });
      })
      .catch((error: unknown) => {
        // Rethrown from inside blockConcurrencyWhile, the error resets the object; should the instance
        // live on anyway, its next event starts a new App.
        started = undefined;
        logger.error("pikit: the object's App failed to start", { object: host.object?.id, error });
        throw error;
      }));

  return {
    async health() {
      await start();
      return { ok: true };
    },
    async alarm() {
      await start();
      if (onAlarm === undefined) {
        logger.warn("pikit: the object's alarm fired, but no component handles it", { object: host.object?.id });
        return;
      }
      await onAlarm();
    },
    async deliver(type, key, message) {
      await start();
      // Rejected, so the sender (`actor.mailbox.send`) rejects and its platform retries (C2).
      if (onDeliver === undefined) throw new Error(`deployment-cloudflare: a "${type}" message was delivered, but no component in the object's App handles deliveries (onDeliver)`);
      await onDeliver(type, key, message);
    },
  };
}

/** What the Worker's fetch uses of a Durable Object namespace binding. */
export interface ObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { health(): Promise<unknown> };
}

export interface WorkerHost {
  fetch(request: Request, env: WorkersHost["env"]): Promise<Response>;
}

/**
 * The Worker's fetch. `definition` is `export const worker` in `pikit.config.ts`; without one the
 * Worker serves only `GET /health`.
 */
export function createWorkerHost(definition: AppDefinition | undefined, options: HostOptions = {}): WorkerHost {
  const logger = options.logger ?? consoleLogger;
  let serving: Promise<Router> | undefined;
  /** Once per isolate, from its first request (`/health` too); a failed start is retried by the next request. */
  const boot = (env: WorkersHost["env"], origin: string): Promise<Router> =>
    (serving ??= (async () => {
      let router: Router | undefined;
      // The Worker's server: the entrypoint's own component, so the routes are the App's `http.route`s as
      // its capability graph resolves them. It shows in `describe()` as `deployment-cloudflare`.
      const server = defineComponent({
        name: "deployment-cloudflare",
        setup(pikit) {
          const routes = pikit.useKeyed("http.route");
          return {
            start(ctx) {
              // Requests must not inherit the start's deadline; each derives its own context.
              router = createRouter(routes, ctx.derive(() => BACKGROUND_CONTEXT));
            },
          };
        },
      });
      const app = await compose(definition, [server], logger);
      await startWithin(app, withContextValue(WORKERS_HOST, { env, origin }, BACKGROUND_CONTEXT), options, logger);
      if (router === undefined) throw new Error("deployment-cloudflare: the Worker's App started without its server");
      logger.info("pikit: Worker started", { routes: router.keys });
      return router;
    })().catch((error: unknown) => {
      serving = undefined;
      logger.error("pikit: the Worker's App failed to start", { error });
      throw error;
    }));

  const health = async (env: WorkersHost["env"], origin: string): Promise<Response> => {
    const version = (env[VERSION_BINDING] as { id?: unknown } | undefined)?.id;
    const answer = (ok: boolean, error?: string) =>
      Response.json({ ok, version: typeof version === "string" ? version : null, ...(error !== undefined && { error }) }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
    // Public: it says which half failed, never why. The why is in the logs (`pikit logs`).
    try {
      await boot(env, origin);
    } catch {
      return answer(false, "the Worker's App did not start");
    }
    const objects = env[OBJECT_BINDING] as ObjectNamespace | undefined;
    if (objects === undefined) return answer(false, `no ${OBJECT_BINDING} binding: see wrangler.jsonc`);
    try {
      await objects.get(objects.idFromName(HEALTH_OBJECT)).health();
    } catch (error) {
      logger.error("pikit: /health: the object's App did not start", { error });
      return answer(false, "the object's App did not start");
    }
    return answer(true);
  };

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return await health(env, url.origin);
      let router: Router;
      try {
        router = await boot(env, url.origin);
      } catch {
        return Response.json({ error: "unavailable" }, { status: 503 });
      }
      return await router.serve(request, url, logger);
    },
  };
}

/**
 * Starts `app` with `parent`'s values and a deadline. At the deadline, and after a failed start, the
 * app is stopped with a deadline of its own, which bounds the rollback of whatever had started (K2).
 * Rejects as the start did.
 */
async function startWithin(app: App, parent: Context, options: HostOptions, logger: Logger): Promise<void> {
  const startDeadlineMs = options.startDeadlineMs ?? START_DEADLINE_MS;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopping ??= app
      .stop(withAbortSignal(AbortSignal.timeout(options.rollbackDeadlineMs ?? ROLLBACK_DEADLINE_MS), BACKGROUND_CONTEXT))
      .catch((error: unknown) => logger.error("pikit: the failed start did not roll back cleanly", { error })));
  // A timer cleared once the start settles, not `AbortSignal.timeout`: a pending timer is work in
  // flight, and an object waits for it before it can be evicted.
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(new Error(`deployment-cloudflare: the App did not start within ${startDeadlineMs} ms`));
    void stop();
  }, startDeadlineMs);
  try {
    await app.start(withAbortSignal(deadline.signal, parent));
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The App as `pikit.config.ts` composes it, recomposed with this deployment's target and logger (as
 * `deployment-docker`'s entrypoint does), plus the entrypoint's own components.
 */
function compose(definition: AppDefinition | undefined, own: AppDefinition["components"], logger: Logger): Promise<App> {
  return defineApp({
    components: [...(definition?.components ?? []), ...own],
    config: { ...(definition?.config ?? {}) },
    target: "cloudflare",
    logger,
  }).create();
}

/** `"METHOD /path"` as the `http.route` contract defines it. */
const ROUTE_KEY = /^(GET|POST|PUT|PATCH|DELETE) (\/|(\/([A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9]*))+)$/;

interface Router {
  keys: string[];
  serve(request: Request, url: URL, logger: Logger): Promise<Response>;
}

/**
 * The routes by key, as `server-bun` serves them: a literal path wins over one with parameters, a
 * request no route matches is a 404, and a route that throws is a 500 that does not reveal why.
 */
function createRouter(routes: { keys(): string[]; get(key: string): HttpRoute | undefined }, base: AppContext): Router {
  const table: { method: string; segments: string[]; route: HttpRoute; key: string }[] = [];
  for (const key of routes.keys()) {
    if (!ROUTE_KEY.test(key)) throw new Error(`deployment-cloudflare: cannot serve the http.route key "${key}" (expected "METHOD /path")`);
    if (key === "GET /health") throw new Error(`deployment-cloudflare: "${key}" is the Worker's own route`);
    const route = routes.get(key);
    if (route === undefined) continue;
    const [method = "", path = ""] = key.split(" ");
    table.push({ method, segments: path.split("/").slice(1), route, key });
  }
  const literal = (segments: string[]) => segments.every((s) => !s.startsWith(":"));
  table.sort((a, b) => Number(literal(b.segments)) - Number(literal(a.segments)));

  return {
    keys: table.map((entry) => entry.key),
    async serve(request, url, logger) {
      const segments = url.pathname.split("/").slice(1);
      const entry = table.find(
        (e) => e.method === request.method && e.segments.length === segments.length && e.segments.every((s, i) => s.startsWith(":") || s === segments[i]),
      );
      if (entry === undefined) return Response.json({ error: "not_found" }, { status: 404 });
      try {
        return await entry.route(request, base.derive(() => withAbortSignal(request.signal, BACKGROUND_CONTEXT)));
      } catch (error) {
        logger.error("pikit: a route failed", { route: entry.key, error: String(error) });
        return Response.json({ error: "internal" }, { status: 500 });
      }
    },
  };
}
