/**
 * The Cloudflare entrypoint (SPEC §4.1, C1, C5): the `Conversation` Durable Object class and the
 * Worker's `fetch`, built from the project's two Apps. `worker.ts` builds them from `pikit.config.ts`;
 * the workerd lane builds them from small test Apps.
 *
 * This is the only file of a project that imports `cloudflare:workers`. Everything it does is in
 * `host.ts`, which types the platform by what it uses: components see Cloudflare only through
 * `WORKERS_HOST` on their start context.
 */

import type { AppDefinition } from "@pikit/core";
import type { ActorCallOutcome, JsonValue } from "@pikit/contracts";
import type { WorkersHost } from "@pikit/contracts/cloudflare";
// @ts-ignore: typed by Workers' runtime types (`wrangler types`) where they are installed; under Bun's
// types the class below extends an untyped base, and host.ts types what is used of it.
import { DurableObject } from "cloudflare:workers";
import { type AlarmInfo, createObjectHost, createWorkerHost, type HostOptions, type ObjectHost, type ObjectState } from "./host.ts";

export interface Entrypoint {
  /** The Durable Object class: `wrangler.jsonc` binds it as `CONVERSATION`, with a SQLite migration. */
  Conversation: new (...args: never[]) => unknown;
  /** The Worker's default export. */
  handler: { fetch(request: Request, env: unknown): Promise<Response> };
}

/**
 * `object` is `pikit.config.ts`'s default export, run once per object; `worker`, its
 * `export const worker`, run once per Worker isolate.
 */
export function createEntrypoint(object: AppDefinition, worker: AppDefinition | undefined, options: HostOptions = {}): Entrypoint {
  class Conversation extends DurableObject {
    #host: ObjectHost | undefined;

    /**
     * Built on the first event, not in the constructor: an object that is never asked starts nothing.
     * `#`-private, so RPC does not expose it: only the methods below are the object's interface.
     */
    #objectHost(): ObjectHost {
      // `ctx` and `env` are DurableObject's; read structurally, so this compiles with or without Workers' types.
      const { ctx, env } = this as unknown as { ctx: ObjectState; env: WorkersHost["env"] };
      return (this.#host ??= createObjectHost(object, ctx, env, options));
    }

    /** RPC from the Worker's `GET /health`: this version can start the object's App. */
    async health(): Promise<{ ok: true }> {
      return await this.#objectHost().health();
    }

    /** RPC from `actor.mailbox` on the Worker: resolves once the object's handler holds the message. */
    async deliver(type: string, key: string, message: JsonValue): Promise<void> {
      await this.#objectHost().deliver(type, key, message);
    }

    /** RPC from `actor.mailbox.call`: the object's answer, or why it has none. */
    async call(type: string, key: string, message: JsonValue): Promise<ActorCallOutcome> {
      return await this.#objectHost().call(type, key, message);
    }

    async alarm(info?: AlarmInfo): Promise<void> {
      await this.#objectHost().alarm(info);
    }
  }

  const host = createWorkerHost(worker, options);
  return {
    Conversation,
    handler: { fetch: (request, env) => host.fetch(request, env as WorkersHost["env"]) },
  };
}
