/**
 * github-app's Worker half, on Cloudflare (SPEC §4.1, C1): its routes (`routes.ts`), which the Worker
 * serves, each a call to the github-app object; and `github` for the components of the Worker's App
 * (admin-proposals' routes), read through calls as an object reads it (`createRemoteGitHub`).
 *
 * `component.json`'s `apps.worker` names this export (`worker`): `pikit add` puts it in
 * `export const worker` of pikit.config.ts, under its own name, `github-app-worker`.
 */

import { defineComponent } from "@pikit/core";
import { createRemoteAdmin, createRemoteGitHub } from "./calls.ts";
import { provideRoutes } from "./routes.ts";

export const WORKER_NAME = "github-app-worker";

export const worker = defineComponent({
  name: WORKER_NAME,
  setup(pikit) {
    const auth = pikit.useOptional("admin.auth");
    const mailbox = pikit.use("actor.mailbox");
    pikit.provide("github", createRemoteGitHub(() => mailbox.get(), pikit.clock));
    provideRoutes(pikit, { auth, admin: createRemoteAdmin(() => mailbox.get()) });
  },
});
