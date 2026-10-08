/**
 * settings-store's Worker half, on Cloudflare (SPEC §4.1, C1): the same routes as a server's
 * (`routes.ts`), served by the Worker's App, each a call to the settings object (`SETTINGS_KEY`,
 * `calls.ts`), which validates against its App's declarations, stores and logs.
 *
 * It also provides `settings` to the Worker's App, read as a conversation's object reads it: the
 * components of the Worker's App declare theirs in `start` (admin-proposals, whose routes the Worker
 * serves, declares the same as its copy in the objects), and `get` reads the settings object's values,
 * kept for a second (`FRESH_MS`). A change made in the dashboard applies to the Worker's next request
 * past that second.
 *
 * `component.json`'s `apps.worker` names this export (`worker`): `pikit add` puts it in
 * `export const worker` of pikit.config.ts, under its own name, `settings-store-worker`.
 */

import { defineComponent } from "@pikit/core";
import { createRemoteAdmin, createRemoteSettings } from "./calls.ts";
import { provideRoutes } from "./routes.ts";
import { createDeclarations } from "./settings.ts";

export const WORKER_NAME = "settings-store-worker";

export const worker = defineComponent({
  name: WORKER_NAME,
  setup(pikit) {
    const auth = pikit.useOptional("admin.auth");
    const mailbox = pikit.use("actor.mailbox");
    pikit.provide("settings", createRemoteSettings(createDeclarations(), () => mailbox.get(), pikit.clock));
    // The routes show and set what the settings object's App declares: every object's components.
    const admin = createRemoteAdmin(() => mailbox.get());
    provideRoutes(pikit, { auth, settings: () => admin });
  },
});
