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
 * Targets: `server` and `durable`. It never reads the target: in `start`, `actor.inbox`'s `scope` says
 * where the values live.
 * - **Every key's actor** (`"all"`, a server; or no `actor.inbox`): this export is everything, the
 *   App's own table, read at every `get` (one query), and the routes.
 * - **One key's actor** (`"one"`: on Cloudflare, each conversation's Durable Object, the default
 *   App). The values are
 *   one object's, `settings-store:settings` (`SETTINGS_KEY`, `calls.ts`), of the conversations' class,
 *   never a conversation, which answers the calls every object can answer. A conversation's object
 *   reads it when used, keeping what it read with its version, asked again at most every second: one
 *   call per admission at most. The routes are the Worker's half's (`worker.ts`, `export const
 *   worker`), calls to that object; they are registered in the object's App too, where no server
 *   serves them. The Worker's half provides `settings` too, read the same way, for the components of
 *   the Worker's App (admin-proposals, whose routes the Worker serves).
 */

import { defineComponent } from "@pikit/core";
import type { Settings } from "@pikit/contracts";
import Type from "typebox";
import { answerCalls, createRemoteSettings, FRESH_MS } from "./calls.ts";
import { provideRoutes } from "./routes.ts";
import { createDeclarations, createSettings, type SettingsStore } from "./settings.ts";
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
    // Whose actor this App is (`scope`); where it is one key's: the settings object's calls, and reading it.
    const inbox = pikit.useOptional("actor.inbox");
    const mailbox = pikit.useOptional("actor.mailbox");

    const declarations = createDeclarations();
    const table = createSettingsTable(() => sql.get(), () => pikit.clock.now());
    // The App's settings over its own table: a server's, and what the settings object answers with.
    const local = createSettings(declarations, table);
    const remote = createRemoteSettings(declarations, () => mailbox.get(), pikit.clock, config.freshMs);
    // Chosen in start, by the inbox's scope; the components that use `settings` start after.
    let chosen: (Settings & SettingsStore) | undefined;
    const current = (): Settings & SettingsStore => {
      if (chosen === undefined) throw new Error("settings-store: settings used before the App started; use it from start or later");
      return chosen;
    };
    const provided: Settings = {
      declare: (component, schema, defaults) => current().declare(component, schema, defaults),
      get: (component, ctx) => current().get(component, ctx),
    };
    pikit.provide("settings", provided);
    // The operator side is the routes' only: components declare and read.
    provideRoutes(pikit, { auth, store: current });

    return {
      start() {
        const calls = inbox.get();
        // Every key's actor (a server, or no actors at all): the values are its own table's.
        if (calls === undefined || calls.scope === "all") {
          chosen = local;
          return;
        }
        // One key's (a Durable Object): the settings object's, which may be this one.
        if (mailbox.get() === undefined) throw new Error("settings-store: in an App that is one key's actor it reads the settings object, which needs actor.mailbox");
        chosen = remote;
        answerCalls(calls, table, local);
      },
    };
  },
});
