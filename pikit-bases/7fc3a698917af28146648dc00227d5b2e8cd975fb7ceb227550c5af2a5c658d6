/**
 * secrets-cloudflare: secrets from the Worker's `env` (SPEC §4.1, C5).
 *
 * On Cloudflare a secret (`wrangler secret put`, `.dev.vars` locally) or a variable (`vars` in
 * `wrangler.jsonc`) reaches the Worker as a property of its `env`, which `deployment-cloudflare`'s
 * entrypoint puts in `WORKERS_HOST`, in the Worker's App and in each Durable Object's App alike. This
 * component provides `secrets` over it.
 *
 * - Only strings are secrets. A binding (a Durable Object namespace, a KV namespace) is not, and reads
 *   `undefined`, as does an empty string: a token that is `""` is as missing as no token.
 * - It never writes or logs a value.
 *
 * Target: `durable` (on a server, `secrets-env` reads the process environment).
 */

import { defineComponent } from "@pikit/core";
import type { SecretStore } from "@pikit/contracts";
import { WORKERS_HOST } from "@pikit/contracts/cloudflare";

export default defineComponent({
  name: "secrets-cloudflare",
  setup(pikit) {
    let env: Readonly<Record<string, unknown>> | undefined;
    const secrets: SecretStore = {
      async get(name) {
        if (env === undefined) throw new Error("secrets-cloudflare: secrets read before the app started");
        const value = env[name];
        return typeof value === "string" && value !== "" ? value : undefined;
      },
    };
    pikit.provide("secrets", secrets);

    return {
      start(ctx) {
        const host = ctx.value(WORKERS_HOST);
        if (host === undefined) {
          throw new Error(
            "secrets-cloudflare: no WORKERS_HOST in the start context: it runs only on Cloudflare, in an App started by deployment-cloudflare. On a server, use secrets-env.",
          );
        }
        env = host.env;
      },
    };
  },
});
