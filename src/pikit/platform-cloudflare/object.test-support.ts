/**
 * For the tests only: Durable Objects as the platform and `deployment-cloudflare` run them, around a
 * real or a double SQL storage.
 *
 * - `simulatedObject` is one object: its `WORKERS_HOST`, its one alarm and its `deliver` RPC. The
 *   alarm runs on the app's clock, as the platform's runs on the real one: it fires at or after its
 *   time, one at a time, once (a new `setAlarm` during it stands after it), and again a second later
 *   when the handler rejects. So the conformance suite's manual clock drives it to the millisecond.
 *   (The suite owns its clock; the object reads it through `component`, which goes in the App.)
 * - `simulatedNamespace` is a namespace binding of such objects, each running an App of its own, the
 *   way the Worker's `actor.mailbox` reaches them.
 *
 * The proof on a real object, with its real alarm and RPC, is pikit's workerd lane (`tests/workerd`).
 */

import { type App, BACKGROUND_CONTEXT, type Clock, type ComponentDefinition, defineApp, defineComponent, silentLogger, withContextValue } from "@pikit/core";
import { type JsonValue, WORKERS_HOST, type WorkersHost } from "@pikit/contracts";
import type { ConversationNamespace, ObjectStorage } from "./index.ts";

/** How long the simulated platform waits before retrying an alarm whose handler rejected. */
const ALARM_RETRY_MS = 1_000;

export interface SimulatedObject {
  /** What deployment-cloudflare puts in WORKERS_HOST for this object. */
  host: WorkersHost;
  /** Goes in the object's App: it gives the alarm the app's clock. */
  component: ComponentDefinition;
  /** The alarm's time, or `null`, as `getAlarm()` answers. */
  alarm(): number | null;
  /** How many times the alarm fired. */
  fired(): number;
  /** The `deliver` RPC: the message arrives as a structured clone, as over an RPC. */
  deliver(type: string, key: string, message: JsonValue): Promise<void>;
}

export function simulatedObject(sql: ObjectStorage["sql"], options: { id?: string; env?: Record<string, unknown> } = {}): SimulatedObject {
  let clock: Clock | undefined;
  let alarm: number | null = null;
  let firing = false;
  let fired = 0;
  /** Bumped by every change, so a sleep for an alarm that changed since does nothing. */
  let generation = 0;
  let onAlarm: (() => Promise<void>) | undefined;
  let onDeliver: ((type: string, key: string, message: JsonValue) => Promise<void>) | undefined;

  const schedule = () => {
    const mine = ++generation;
    if (alarm === null || firing || clock === undefined) return;
    void clock.sleep(Math.max(0, alarm - clock.now())).then(() => {
      if (mine === generation) void fire();
    });
  };
  const fire = async () => {
    firing = true;
    fired++;
    alarm = null; // the platform takes the alarm that fires
    try {
      await onAlarm?.();
    } catch {
      if (alarm === null && clock !== undefined) alarm = clock.now() + ALARM_RETRY_MS;
    } finally {
      firing = false;
      schedule();
    }
  };

  const storage: ObjectStorage = {
    sql,
    getAlarm: async () => alarm,
    async setAlarm(time) {
      alarm = time;
      schedule();
    },
    async deleteAlarm() {
      alarm = null;
      schedule();
    },
  };
  return {
    host: {
      env: options.env ?? {},
      object: {
        id: options.id ?? "simulated-object",
        storage,
        onAlarm: (handler) => void (onAlarm = handler),
        onDeliver: (handler) => void (onDeliver = handler),
      },
    },
    component: defineComponent({
      name: "platform-cloudflare-simulated-alarm",
      setup(pikit) {
        clock = pikit.clock;
        schedule();
      },
    }),
    alarm: () => alarm,
    fired: () => fired,
    async deliver(type, key, message) {
      if (onDeliver === undefined) throw new Error("simulated object: nothing registered onDeliver");
      await onDeliver(type, key, structuredClone(message));
    },
  };
}

export interface SimulatedNamespace {
  /** The Worker's env, with the namespace under `binding`. */
  env: Record<string, unknown>;
  /** The objects' Apps, by name, once a message reached them. */
  apps: Map<string, App>;
  /** Stops every object's App. */
  stop(): Promise<void>;
}

/**
 * A namespace binding (`binding`, `CONVERSATION` by default) whose objects each run an App of
 * `components()` with the object in `WORKERS_HOST`, started on the first message, as
 * deployment-cloudflare's object class does. `sql()` gives each object its storage.
 */
export function simulatedNamespace(
  components: () => ComponentDefinition[],
  sql: () => ObjectStorage["sql"],
  { binding = "CONVERSATION" }: { binding?: string } = {},
): SimulatedNamespace {
  const env: Record<string, unknown> = {};
  const apps = new Map<string, App>();
  const objects = new Map<string, Promise<SimulatedObject>>();
  const open = (name: string): Promise<SimulatedObject> => {
    let object = objects.get(name);
    if (object === undefined) {
      object = (async () => {
        const simulated = simulatedObject(sql(), { id: `id:${name}`, env });
        const app = await defineApp({ components: [...components(), simulated.component], logger: silentLogger }).create();
        apps.set(name, app);
        await app.start(withContextValue(WORKERS_HOST, simulated.host, BACKGROUND_CONTEXT));
        return simulated;
      })();
      objects.set(name, object);
    }
    return object;
  };
  const namespace: ConversationNamespace = {
    idFromName: (name) => ({ name, toString: () => `id:${name}` }),
    get: (id: never) => ({
      deliver: async (type, key, message) => (await open((id as { name: string }).name)).deliver(type, key, message),
    }),
  };
  env[binding] = namespace;
  return {
    env,
    apps,
    async stop() {
      await Promise.all([...apps.values()].map((app) => app.stop().catch(() => {})));
    },
  };
}
