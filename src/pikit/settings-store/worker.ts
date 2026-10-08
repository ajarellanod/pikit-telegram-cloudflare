/**
 * settings-store's Worker half, on Cloudflare (SPEC §4.1, C1): the same routes as a server's
 * (`routes.ts`), served by the Worker's App, each a call to the settings object (`SETTINGS_KEY`,
 * `calls.ts`), which validates against its App's declarations, stores and logs. The Worker declares
 * nothing: the components that declare run in the objects.
 *
 * `component.json`'s `apps.worker` names this export (`worker`): `pikit add` puts it in
 * `export const worker` of pikit.config.ts, under its own name, `settings-store-worker`.
 */

import { defineComponent } from "@pikit/core";
import { createRemoteAdmin } from "./calls.ts";
import { provideRoutes } from "./routes.ts";

export const WORKER_NAME = "settings-store-worker";

export const worker = defineComponent({
  name: WORKER_NAME,
  setup(pikit) {
    const auth = pikit.useOptional("admin.auth");
    const mailbox = pikit.use("actor.mailbox");
    const admin = createRemoteAdmin(() => mailbox.get());
    provideRoutes(pikit, { auth, settings: () => admin });
  },
});
