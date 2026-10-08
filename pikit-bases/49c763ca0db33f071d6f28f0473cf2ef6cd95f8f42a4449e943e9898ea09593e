/**
 * settings-store: the values an operator changes live from the dashboard (`settings`, @pikit/contracts'
 * settings.ts; features/settings.md). Components declare theirs in `start`; the dashboard's Settings
 * dialog reads and writes them through this component's routes (`routes.ts`); each component reads
 * its own when it uses them.
 *
 * - **Stored** in a table of `storage.sql`, `settings_store` (`table.ts`): one row per component, its
 *   value as the operator set it, who and when, and a version.
 * - **Validated** against each component's declared schema, when set and when read (`settings.ts`): a
 *   stored key a deploy made invalid takes its default, logged.
 * - **Logged** with the operator and the component, never the value.
 *
 * Targets: `server` and `durable`.
 * - **On a server** this export is everything: the App's own table, read at every `get` (one query),
 *   and the routes.
 * - **On Cloudflare** it goes in each conversation's Durable Object (the default App). The values are
 *   one object's, `settings-store:settings` (`SETTINGS_KEY`, `calls.ts`), of the conversations' class,
 *   never a conversation, which answers the calls every object can answer. A conversation's object
 *   reads it when used, keeping what it read with its version, asked again at most every second: one
 *   call per admission at most. The routes are the Worker's half's (`worker.ts`, `export const
 *   worker`), calls to that object; they are registered in the object's App too, where no server
 *   serves them.
 */

import { defineComponent } from "@pikit/core";
import { type Settings, SettingsError } from "@pikit/contracts";
import Type from "typebox";
import { answerCalls, createRemoteAdmin, createRemoteSource, FRESH_MS } from "./calls.ts";
import { provideRoutes } from "./routes.ts";
import { createDeclarations, createSettings } from "./settings.ts";
import { createSettingsTable } from "./table.ts";

export { worker, WORKER_NAME } from "./worker.ts";

const Config = Type.Object({
  /**
   * On Cloudflare: how long, in ms, a conversation's object answers from the values it read last before
   * it asks the settings object again. 0 asks at every read.
   */
  freshMs: Type.Integer({ minimum: 0, default: FRESH_MS }),
});

export default defineComponent({
  name: "settings-store",
  config: Config,
  setup(pikit, config) {
    const sql = pikit.use("storage.sql");
    // Its routes answer operators only; without a provider, nobody.
    const auth = pikit.useOptional("admin.auth");
    // On Cloudflare (`durable`): the settings object's calls, and reading it.
    const inbox = pikit.useOptional("actor.inbox");
    const mailbox = pikit.useOptional("actor.mailbox");
    const durable = pikit.target === "durable";

    const declarations = createDeclarations();
    const table = createSettingsTable(() => sql.get(), () => pikit.clock.now());
    // The App's settings over its own table: a server's, and what the settings object answers with.
    const local = createSettings(declarations, table);
    let provided: Settings = local;
    if (durable) {
      const source = createRemoteSource(() => mailbox.get(), pikit.clock, config.freshMs);
      const remote = createSettings(declarations, source);
      const admin = createRemoteAdmin(() => mailbox.get());
      provided = {
        ...remote,
        // Validated, stored and logged in the settings object; this App's next get asks it again.
        async set(component, value, operator, ctx) {
          if (declarations.get(component) === undefined) throw new SettingsError("unknown_component", `"${component}" declared no settings`);
          const stored = await admin.set(component, value, operator, ctx);
          source.forget();
          return stored;
        },
      };
    }
    pikit.provide("settings", provided);
    provideRoutes(pikit, { auth, settings: () => provided });

    return {
      start() {
        if (!durable) return;
        const calls = inbox.get();
        const missing = [calls === undefined && "actor.inbox", mailbox.get() === undefined && "actor.mailbox"].filter(Boolean);
        if (calls === undefined || missing.length > 0) {
          throw new Error(`settings-store: in a Durable Object's App it reads and answers the settings object, which needs ${missing.join(", ")}: install platform-cloudflare`);
        }
        answerCalls(calls, table, local);
      },
    };
  },
});
