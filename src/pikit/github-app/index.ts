/**
 * github-app: the project's GitHub access on Cloudflare (`github`, @pikit/contracts' github.ts), as a
 * GitHub App the operator creates in their own account and installs on the bot's repository from the
 * dashboard, in two clicks (GitHub's App Manifest flow). The app then mints its own short-lived
 * installation tokens: no token is pasted anywhere, and none is ever the agent's to hold.
 *
 * 1. **Connect** (Settings → GitHub, `settings/`): the dashboard posts a manifest to GitHub
 *    (`POST …/start` gives it; `store.ts`'s `manifestOf`): a private App named after the Worker, no
 *    webhook, permissions to push branches, open, merge and close pull requests, read their checks.
 * 2. **Callback** (`GET …/callback`): the `state` checked (single-use, 15 minutes, the operator and
 *    the browser that started it), GitHub's code converted (`POST /app-manifests/{code}/conversions`),
 *    the App's private key and secrets stored sealed with a key derived from `PIKIT_ADMIN_TOKEN`
 *    (`keySecret`; changing it means connecting again), then on to installing it.
 * 3. **Setup** (`GET …/setup`, after the install): the installation (checked to be this App's), and
 *    the repositories it reaches; one is the repository, several are the operator's to choose.
 * 4. **Tokens** (`github.token`): an RS256 JWT signed with Web Crypto, then an installation token for
 *    that repository alone, kept until a few minutes before it expires.
 * 5. **Disconnect**: forgotten here; the App stays on GitHub until the operator deletes it there.
 *
 * Target: `durable`. The connection is one object's (`GITHUB_APP_KEY`, an object of the conversations'
 * class that is never a conversation, as settings-store's is), in its `storage.sql`; every App reaches
 * it through `actor.mailbox` (`calls.ts`). This default export goes in each conversation's object: it
 * answers the calls there (only the github-app object is called) and provides `github` to the objects'
 * App (execution-do's git, extension-pikit-self). The Worker's half (`worker.ts`, `export const worker`)
 * serves the routes and provides `github` to the Worker's App (admin-proposals).
 */

import { defineComponent } from "@pikit/core";
import Type from "typebox";
import { answerCalls, createRemoteGitHub, FRESH_MS } from "./calls.ts";
import { createAppStore } from "./store.ts";

export * from "./api.ts";
export { worker, WORKER_NAME } from "./worker.ts";

const Config = Type.Object({
  /** The secret the App's credentials are sealed with (a key derived from it): the operators' token. */
  keySecret: Type.String({ pattern: "^[A-Z][A-Z0-9_]*$", default: "PIKIT_ADMIN_TOKEN" }),
  /** How long, in ms, a conversation's object answers `github` from what it read last before it asks the github-app object again. */
  freshMs: Type.Integer({ minimum: 0, default: FRESH_MS }),
});

export default defineComponent({
  name: "github-app",
  config: Config,
  setup(pikit, config) {
    const sql = pikit.use("storage.sql");
    const secrets = pikit.use("secrets");
    const inbox = pikit.use("actor.inbox");
    const mailbox = pikit.use("actor.mailbox");
    const store = createAppStore({ sql: () => sql.get(), secrets: () => secrets.get(), keySecret: config.keySecret, clock: pikit.clock });
    pikit.provide("github", createRemoteGitHub(() => mailbox.get(), pikit.clock, config.freshMs));
    return {
      start() {
        answerCalls(inbox.get(), store);
      },
    };
  },
});
