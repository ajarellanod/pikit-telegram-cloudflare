/**
 * admin-api's Worker half, on Cloudflare (SPEC §4.1, C1): the same routes as a server's (`routes.ts`),
 * served by the Worker's App, over the remote backend (`remote.ts`): every read and action is an
 * `actor.mailbox.call` to the conversation's Durable Object, where the default export answers it
 * (`calls.ts`), and the list comes from the index (`conversation-index.ts`). It needs only `admin.auth`
 * (admin-auth-token, in both Apps) and `actor.mailbox` (platform-cloudflare); the dashboard's files are
 * bundled in (`dashboard-files.ts`).
 *
 * - **Ids** are qualified: `<conversation key>~<the object's id>` (`backend.ts`).
 * - **Live events** are a snapshot polled every second, sent when it changed, for a bounded number of
 *   polls; the dashboard reconnects when the stream ends (`remote.ts`).
 * - **Delivery** is not listed: each conversation's outbound queue is in its own object.
 *
 * `component.json`'s `apps.worker` names this export (`worker`): `pikit add` puts it in
 * `export const worker` of pikit.config.ts, under its own config key, `admin-api-worker`.
 */

import { defineComponent } from "@pikit/core";
import { createAssets } from "./assets.ts";
import { DASHBOARD_FILES } from "./dashboard-files.ts";
import { Config } from "./config.ts";
import { createRemoteBackend } from "./remote.ts";
import { provideRoutes } from "./routes.ts";

export const WORKER_NAME = "admin-api-worker";

export const worker = defineComponent({
  name: WORKER_NAME,
  config: Config,
  setup(pikit, config) {
    const auth = pikit.use("admin.auth");
    const mailbox = pikit.use("actor.mailbox");
    const assets = createAssets(DASHBOARD_FILES);
    const backend = createRemoteBackend(() => mailbox.get());

    provideRoutes(pikit, {
      auth,
      backend: () => backend,
      queue: () => undefined,
      noQueue: "on Cloudflare each conversation's outbound queue is in its own Durable Object: the Worker does not list them",
      heartbeatMs: config.heartbeatMs,
      assets,
    });

    return {
      start(ctx) {
        if (assets.built()) ctx.logger.info("admin-api: the dashboard is served at /admin/", { files: assets.size() });
        else ctx.logger.info("admin-api: no dashboard is built; the API alone is served at /admin/api/");
      },
    };
  },
});
