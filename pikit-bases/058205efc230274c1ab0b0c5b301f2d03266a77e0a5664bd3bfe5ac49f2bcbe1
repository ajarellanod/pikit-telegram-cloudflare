# deployment-cloudflare

Runs a pikit project on Cloudflare Workers and Durable Objects: the Worker and its `Conversation`
objects running the project's two Apps, `wrangler.jsonc`, and the commands
`pikit up | down | logs | status | dev` delegate to (SPEC §4.1: C1, C4, C5, C8).

- **Provides:** nothing. It is not an app component and is not listed in `pikit.config.ts`: it runs
  the Apps rather than running inside them.
- **Requires:** nothing. It runs whatever `pikit.config.ts` composes: its default export in each
  Durable Object, and `export const worker` in the Worker.
- **Target:** `durable`. Only `entrypoint.ts` imports `cloudflare:workers`; only what runs where
  the deploy runs imports `node:*`: `commands.ts` on your machine, and `rollout.mjs` and `deploy.mjs`,
  plain JavaScript for Node, there and in a build without pikit (Workers Builds).
- **Installs to:** `src/pikit/deployment-cloudflare/`, plus `wrangler.jsonc` at the project's root.
- **npm dependencies:** `@pikit/contracts`; and `wrangler` 4.143.0 as a dev dependency
  (`component.json`'s `devDependencies`): `pikit add` puts it in the project's `package.json`
  devDependencies and `pikit remove` takes it out, like any dependency. Its commands and tests run
  that project's own wrangler, which runs on Node ≥ 22.
- **Environment:** none of its own. `.env` holds the app's secrets: `pikit up` uploads them with each
  version, and `pikit dev` gives them to the local Worker.

## Cloudflare in one line

On a Mac or Linux machine with nothing of pikit yet:

```sh
curl -fsSL https://raw.githubusercontent.com/ajarellanod/pikit/main/installer/install.sh | sh -s -- --durable
```

The installer puts `pikit` on the machine (git, curl, Bun, as for a server), skips Docker, which
Cloudflare does not need, and checks Node.js >= 22, which wrangler runs on (it says how to install
it if it is missing). Then, at the terminal, it runs
`pikit new --target durable --preset telegram-cloudflare`, which asks, in order:

1. **the bot's name**, its folder (`my-agent` on Enter); then it writes the project and runs `bun install`;
2. **"Configure it now?"**: `pikit configure`'s questions, below: the bot's token from @BotFather,
   who may talk to it (you send it a message), the webhook's secret (generated), a Brave Search key
   (optional) and the OpenRouter key;
3. **"Start it?"**, "On Cloudflare": `pikit up`. If wrangler is not logged in to Cloudflare, it asks
   "Log in now? It opens your browser" and runs `wrangler login` (create a free account there if you
   have none). On an account's first deploy, wrangler asks for its `workers.dev` subdomain, the
   `<subdomain>.workers.dev` every Worker of the account answers at: choose one. Then it deploys,
   waits for `/health`, and sets the Telegram webhook. Write to the bot: it answers.

Without the installer, the same is `pikit new` (answer "durable — on Cloudflare" to "Where should it run?"), or
the three commands below. Ctrl-C stops at any question; `pikit new` again, with the same name,
continues where you left off.

**What it costs.** Cloudflare's **Workers Free plan is enough**: pikit's Cloudflare decisions were
proven on it (SPEC §4.1). It allows 100,000 requests a day (Telegram's updates, the objects' RPCs and
alarms count) and 5 GB of Durable Object storage per account; the Workers Paid plan ($5 a month)
raises both. What you pay for is the **model's tokens**, to OpenRouter, per message.

## Your Telegram bot on Cloudflare

```sh
pikit new my-bot --target durable --preset telegram-cloudflare
cd my-bot
pikit configure
pikit up
```

- **`new`** writes the bot: a Worker that receives Telegram's updates, and one Durable Object per chat
  running the agent (`channel-telegram-webhook`, `runtime-pi`, OpenRouter's models, a workspace and a
  shell in the object with `execution-do`, web fetch and search), each half in its App of
  `pikit.config.ts`. The agent, `src/agents/assistant/agent.ts`, uses `openrouter/z-ai/glm-5.3-flash`
  and names every installed tool.
- **`configure`** asks, in order: the bot's token (from @BotFather, checked with Telegram), who may
  talk to it (send the bot a message; it reads it and asks you to allow the sender), the webhook's
  secret (generated), the Brave Search key (optional: Enter skips, and only web search needs it) and
  the OpenRouter key. Everything goes to `.env` (mode 0600). Without a terminal, export them instead:
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`, `OPENROUTER_API_KEY`, `BRAVE_API_KEY`.
- **`up`** logs in to Cloudflare if wrangler is not (below), deploys the Worker with `.env`'s variables
  as its secrets (`wrangler deploy`), waits until `/health` answers from the
  version it deployed, then tells Telegram where to post (`setWebhook` at `<workers.dev URL>/telegram`,
  with the secret). Write to the bot: it answers.

**Logging in to Cloudflare.** `up`, `down`, `logs` and `status` reach your account, so each first
checks that wrangler can: a `CLOUDFLARE_API_TOKEN` (exported, or in `.env`, which wrangler reads and
`up` never uploads) is used as it is; otherwise `wrangler whoami` says whether wrangler's own login
holds. If not, at a terminal they offer `wrangler login`, which opens your browser, and continue.
Without a terminal (a server over SSH without a browser, CI) they stop and say what to do: `bunx wrangler
login` at a terminal, or an API token from the **"Edit Cloudflare Workers"** template at
https://dash.cloudflare.com/profile/api-tokens as `CLOUDFLARE_API_TOKEN` (with `CLOUDFLARE_ACCOUNT_ID`
when it reaches several accounts).

**The first deploy of an account.** Workers are published at `<worker>.<subdomain>.workers.dev`, and a
new account has no subdomain yet. At a terminal, wrangler asks for one during `up`; without a
terminal it cannot, and `up` fails saying so, with the dashboard's link to register it (free, once
per account). Then `pikit up` again.

`pikit dev` runs the same Worker and objects on your machine (`wrangler dev`); Telegram cannot reach it
there, so a webhook needs a deploy. `pikit logs` streams the deployed bot's logs, `pikit status` shows
what serves. pikit's own end-to-end test (`packages/cli/src/e2e-telegram-cloudflare.test.ts`) runs this
whole path in workerd against a fake Telegram and a fake OpenRouter.

The same project can also be a "Deploy to Cloudflare" button's template, with no CLI at all: the
Worker registers its own webhook, and the owner logs in with `/login <password>`
(`channel-telegram-webhook`'s README, "With a Deploy to Cloudflare button").

## What it does

### Two Apps (`worker.ts`, `entrypoint.ts`, `host.ts`)

`wrangler.jsonc` deploys `src/pikit/deployment-cloudflare/worker.ts`, which reads `pikit.config.ts`:

```ts
export default defineApp({ components: [...], config });          // each conversation's object
export const worker = defineApp({ components: [...], config: workerConfig }); // the Worker
```

**The `Conversation` Durable Object** (one per conversation, SQLite-backed) composes the default
export on its first event, never in its constructor:
- Its start runs inside `blockConcurrencyWhile`, so no request, RPC or alarm reaches the object
  before its App has started, with a 20 s deadline, and a 5 s one for the rollback of a failed start.
  Both end before Cloudflare's own 30 s limit.
- A start that fails or passes its deadline is rolled back and rethrown from inside
  `blockConcurrencyWhile`: Cloudflare resets the object, the event that started it fails, and the
  next event starts a new App (SPEC K2). The App is never stopped otherwise: an object is evicted
  without warning (K6), and an evicted object starts its App again on its next event.
- **The guard alarm.** Cloudflare retries an alarm that throws 6 times, from 2 s apart and doubling
  (about 2 minutes), then drops it: a start that kept failing (a bad deploy, a secret missing) would
  leave the object's pending runs and answers until its chat's next message. So an alarm whose start
  failed before (Cloudflare's retry, or failed starts counted in the object's storage under
  `pikit:start-failures`) sets the alarm again before it starts the App: 30 s ahead, twice as far at
  each failed start in a row, up to an hour, unless a sooner alarm is set. An alarm set during a failed
  one replaces Cloudflare's retry, so the guard is the retry, and it never runs out. Once the App
  starts, the count is deleted and `platform-cloudflare`'s `wakeups`, the alarm's one owner, sets the
  alarm as its rows say.
- The start context carries `WORKERS_HOST` (`@pikit/contracts/cloudflare`): `env`, and `object` with the
  object's `id`, its `storage` (for `storage-do`), and three hooks:
  - `onAlarm(handler)`: `alarm()` calls it. A rejection makes Cloudflare retry the alarm (6 times at
    most; a failed start leaves the guard alarm). An alarm with no handler is logged and dropped.
  - `onDeliver(handler)`: the RPC `deliver(type, key, message)` calls it and resolves once it
    has. With no handler, `deliver` rejects, so the sender (`actor.mailbox`) rejects and its
    platform retries.
  - `onCall(handler)`: the RPC `call(type, key, message)` calls it and resolves with its answer
    (`actor.mailbox.call`). With no handler, `call` answers `{ ok: false, code: "no_handler" }`.
  
  One handler of each per object. A second registration fails the start: one component (the
  platform's wakeups and mailbox) multiplexes them.
- Its RPC interface is `health()`, `deliver()`, `call()` and `alarm()`, nothing else.
- With `runtime-pi`, the object is one chat: pi-durable keeps its conversations in the object's SQL
  (`storage-do`), the first one being pi-durable's root, on the App's clock. Its runs are driven inside
  the alarm (`runtime-pi.drive`, through `platform-cloudflare`'s `wakeups`); when what is left only
  waits for a time (a model retry's backoff), the handler closes pi-durable inside that event, so the
  object can be evicted until the alarm at that time opens it again.

**The Worker** composes `export const worker` on its first request, once per isolate, with
`WORKERS_HOST` `{ env, origin }` on its start context (`origin`: that of the request that started it,
`/health` included, which is where the Worker is reached; a Worker is never told its own URL
otherwise) and the same deadlines. A failed start answers 503 and
the next request tries again. It serves the App's `http.route`s as `server-bun` does on a server: a
context of their own per request (never the start's, and without `WORKERS_HOST`), a literal path
before one with parameters, which comes before a prefix (`"GET /admin/*"`, the longest first),
404 for no match, and a 500 that does not reveal the error. The routes are resolved by a component
of the entrypoint's own, named `deployment-cloudflare` in `describe()` (`createWorkerServer`, which
passes the `http.route` suite under Bun and in workerd).
Without `export const worker`, the Worker serves only `/health`.

**`GET /health`** is the Worker's own and public. It starts the Worker's App and the App of one
object of its own (`idFromName("pikit:health")`, never a conversation's), then answers
`{ "ok": true, "version": "<version id>" }` (200) or `{ "ok": false, "version": …, "error": "the
object's App did not start" }` (503). It says which half failed, never why: the logs say why.

Change the deadlines or the logger in `worker.ts`, in `createEntrypoint`'s options. Logs go to
`console` (the core's `consoleLogger`): Workers Logs keeps them (`observability` in `wrangler.jsonc`)
and `pikit logs` streams them.

### `wrangler.jsonc`

One Durable Object class, `Conversation`, bound as `CONVERSATION`, created SQLite-backed by migration
`v1`. `nodejs_compat`, `version_metadata` (the version `/health` reports), Workers Logs on, and rules
that import `.md` files as text and bundle `.wasm` files compiled. A rule matches an import as it is
written, so `execution-do`'s QuickJS, imported by a package export without `.wasm`
(`@jitl/quickjs-wasmfile-release-sync/wasm`), is named in it. It has no `name`: the commands name
the Worker after `package.json`'s `name`. Running wrangler by hand, pass `--name`. A Deploy to
Cloudflare template adds a `name` (Workers Builds runs wrangler without `--name`); the commands then
use that one, so `pikit up` and the builds deploy the same Worker.

Its `build.command` builds the dashboard of a project with a UI (`src/dashboard/`: `bun install
--frozen-lockfile`, then `bun run build`, which writes `src/pikit/admin-api/dashboard-files.ts`)
before wrangler bundles; without `src/dashboard/` it does nothing. Wrangler runs it whoever runs
wrangler: `pikit up`, `pikit dev` (again when `src/dashboard/src/` changes), a `wrangler deploy` by
hand, Workers Builds from Git. So no deploy ships an old or empty dashboard, and a build that fails
stops the deploy (`Running custom build … failed`). It needs Bun where wrangler runs.

This file is yours: add bindings, routes, a custom domain. Keep the migration: a migration is
forever; add new ones after it. `files.test.ts` checks what the entrypoint relies on.

### The commands (`commands.ts`)

The CLI delegates to these functions; you can call them from a script too. Each one runs the
project's `node_modules/.bin/wrangler` in the project's directory, without a shell, with
`--name <package.json name>` (`my_bot.v2` → `my-bot-v2`), or `wrangler.jsonc`'s `name` when it has one.

| Function | Runs |
|---|---|
| `login()` | Nothing with a `CLOUDFLARE_API_TOKEN`; else `wrangler whoami --json`, and at a terminal `wrangler login` if it is not logged in. `up`, `down`, `logs` and `status` run it first |
| `up({ url })` | The components' `beforeDeploy` hooks, then `wrangler deploy --tag migrations:<last tag> --secrets-file <.env's secrets>`, then `GET /health` every 2 s until it answers ok from the version it deployed (3 min at most), then the components' `afterDeploy` hooks; or the rollback below. Resolves with `{ version, url }` |
| `down()` | `wrangler delete`, only at a terminal (see below) |
| `logs()` | `wrangler tail`: live, until Ctrl-C |
| `status({ url })` | `wrangler deployments list --json`, plus `GET /health` |
| `dev()` | `wrangler dev`: the Worker and its objects locally, in workerd, reloading on change |

**`up` and secrets.** `.env`'s variables go up with the version (`wrangler deploy --secrets-file`),
not before it (`wrangler secret put`): the version `/health` checks is the code and its secrets
together, no request ever sees new secrets with old code, and no extra version is created. Wrangler
adds them to the secrets already set and deletes none: remove one with `wrangler secret delete`.
Empty variables and wrangler's own `CLOUDFLARE_*` credentials stay on your machine. The file is
written in a private temporary directory and deleted after.

**`up` waits for the new version (C8).** A new version takes seconds to reach every request. `up`
resolves only once `/health` answers ok from the version it deployed, so whatever registers against
the Worker next (a Telegram webhook) reaches it. If that version answers that its App does not start,
or never answers in time, `up` rolls it back and fails, pointing at the logs ("Rolling back" below;
`rollback: false` keeps it). `/health` is asked at the `workers.dev` URL wrangler reports; pass `url`
for a custom domain. `up` notes the version and URL in `.pikit/deployment-cloudflare.json` for `status`.

### Rolling back (`rollout.mjs`)

Every deploy, `pikit up`'s and a build's (`deploy.mjs`, below), follows the same rules, from one
file, `rollout.mjs`: plain JavaScript, so Node runs it where pikit is not installed (its types are
in `rollout.d.mts`).

- A new version that answers `/health` that its App does not start, or does not answer it within
  3 minutes, is rolled back to the version deployed before it: `wrangler deployments list`, then
  `wrangler rollback <that version> --message "pikit: <version> failed /health" --yes`. The log
  says so in one line: `pikit: v2 failed /health: rolled back to v1`. The deploy fails all the same.
- **Not reversible: a Durable Object migration.** Cloudflare cannot roll back across a change of
  Durable Object classes (a new tag in `wrangler.jsonc`'s `migrations`), and the change stays
  applied. So each version is tagged with the last migration tag it was deployed with
  (`wrangler deploy --tag migrations:v1`, shown as its Tag in the dashboard), and before rolling
  back, the previous version's tag is read (`wrangler versions view --json`). When they differ, this
  deploy migrated: nothing is rolled back, and the deploy fails saying so (`pikit: v2 failed /health
  and was NOT rolled back: this deploy changed the Durable Object classes …`). Fix it forward: a
  version that keeps the migration and starts. Its logs say why it does not (`pikit logs`, Workers
  Logs).
- A previous version without such a tag (deployed another way, or before pikit tagged) is rolled
  back to: if a migration lies between, Cloudflare refuses, and the deploy fails saying that rolling
  back failed. A first deploy has nothing to go back to.
- A version that answers, but whose after-deploy hooks fail, is never rolled back: what failed is
  outside it.

### Deploying without pikit (`deploy.mjs`)

Where `pikit up` does not run (a "Deploy to Cloudflare" template's Workers Builds, which deploys
every merge to the main branch, an approved self-improvement proposal included), the deploy command
is this script, with only Node:

```sh
node src/pikit/deployment-cloudflare/deploy.mjs [<after-deploy script>…]
```

It runs `wrangler deploy --tag migrations:<last tag>` (wrangler from the PATH, else the project's;
where the build wants wrangler's output file, `WRANGLER_OUTPUT_FILE_PATH` or
`WRANGLER_OUTPUT_FILE_DIRECTORY`, it stays there), waits for `/health` from the version deployed,
and rolls back by the rules above, with the credentials wrangler deployed with; a failure exits 1,
so the build is marked failed. Once the version answers, it runs each after-deploy script given, in
order, with Node: `node <script> <url> <version>` (`channel-telegram-webhook`'s `setup-webhook.mjs`
registers the bot's webhook). One that fails fails the build; the version stays.
`PIKIT_HEALTH_WAIT_MS` and `PIKIT_HEALTH_INTERVAL_MS` change how long it waits and how often it asks.
The template's `package.json` names it as its `deploy` script (`templates/README.md`).

A deploy cuts the alarms in progress; Cloudflare retries them, and runs resume (C4).

**Before the deploy: the components' `beforeDeploy` hooks.** Some components write what the bundle
must carry (`tool-mcp` writes `seed.ts`, its MCP servers' tools, so that a new conversation's object
starts without reaching them). So, once logged in and before wrangler bundles anything, `up` runs each
installed component's `beforeDeploy`, declared and recorded as `afterDeploy` below
(`"hooks": { "beforeDeploy": "deploy.ts" }`, `deployHooks(cwd, "beforeDeploy")`). Its `io` has
`config`, `get` and `say` as below, and `write(file, text)`, which writes a file of the component's own
`src/pikit/<name>/` (nothing else) only when its text changes, and says whether it did
(`BeforeDeployIO` in `commands.ts`). A problem, or a hook that throws, fails `up` with every hook's
problems, and nothing is deployed. `dev` runs none: it is not a deploy.

**After the deploy: the components' hooks (C8).** Some components register the Worker with
something outside it (`channel-telegram-webhook` tells Telegram where to post), and that must reach
the new version. So, once `/health` answers ok from it, `up` runs each installed component's
`afterDeploy`. The convention, explicit on both sides:

- The component names the file in its `component.json`, relative to its own directory:
  `"hooks": { "afterDeploy": "deploy.ts" }`. `pikit add` records it in `pikit.json`, by project path
  (`"hooks": { "afterDeploy": "src/pikit/channel-telegram-webhook/deploy.ts" }`); `up` reads only that
  (`deployHooks(cwd)`). No file is found by its name.
- That file exports `afterDeploy(io)`, and resolves with its problems, one line each (empty when done):

  ```ts
  export async function afterDeploy(io: {
    url: string;                               // the deployed Worker's public base URL (`url`, or workers.dev)
    config: Readonly<Record<string, unknown>>; // its config in pikit.config.ts (the default export's, defaults applied)
    get(name: string): string | undefined;     // an exported variable, or else .env: the secrets just uploaded
    say(line: string): void;                   // printed by `pikit up`
  }): Promise<string[]>;
  ```

  The shape is structural (`AfterDeployIO` in `commands.ts`): a component imports nothing from this one.

The hooks run in `pikit.json`'s order, every one of them, and a hook that throws counts as a problem.
Then `up` fails with all their problems, each named by its component. The version stays deployed and
is not rolled back: it answers, and what failed is outside it. Fix what they say (often `pikit
configure`), then `pikit up` again: a hook runs at every deploy, so it must be harmless to repeat. A
version that never answers, or answers that its App does not start, runs no hook.

**`down` deletes.** Cloudflare cannot stop a Worker without deleting it, and deleting it deletes every
conversation's Durable Object with its data. `down` runs `wrangler delete`, which asks at the
terminal. Without a terminal, or in CI, wrangler would answer yes by itself, so `down` refuses.

**`logs`** always follows: `--tail` is refused, since `wrangler tail` replays nothing. Past logs are in
the dashboard (Workers Logs).

**`dev`** reads `.env` as the local Worker's secrets (wrangler does, when there is no `.dev.vars`) and
keeps the objects' state in `.wrangler/`.

There is no `restart` (a new version is `up`) and no `exec`: nothing runs a command where the app
runs, so `pikit configure` logs in on your machine and model keys go in `.env`.

## Removing it

`pikit remove deployment-cloudflare` deletes `src/pikit/deployment-cloudflare/` and `wrangler.jsonc`.
It never touches the deployed Worker: `pikit down` first if you want it gone.

## Tests

The tests are copied with the component and run in your project:
- `host.test.ts`: the entrypoint's logic under Bun with a fake object and namespace: when the object's
  App starts, what `WORKERS_HOST` carries, alarms and deliveries, a failed start and a late one with a
  rollback that hangs (both deadlines hold), the Worker's routes and `/health`.
- `commands.test.ts`: the exact `wrangler` argv of every command, the secrets file, the wait for the
  new version, the components' hooks run before it (writing only their own files, once; a problem
  deploying nothing) and after it (with their URL, config and secrets, their problems failing `up`,
  none for a version that does not answer), the rollback (a failing version, one that never answers,
  one whose deploy migrated, a first deploy) and `status`, the login each
  command checks first (a token, `whoami`, `wrangler login` offered at a terminal, what to do without
  one, no Node.js), and a first deploy without a `workers.dev` subdomain, with a fake runner and a
  fake `fetch`. No wrangler, no account.
- `deploy.test.ts`: `deploy.mjs` run by Node against a fake `wrangler` and a fake `/health`: a
  version that answers (tagged, waited for, then the after-deploy scripts), one that fails or never
  answers (rolled back), one whose deploy migrated (not rolled back), a failed deploy, a failed
  after-deploy script, and a build's own output directory.
- `bundle.test.ts`: `wrangler deploy --dry-run` bundles `worker.ts` with a two-App `pikit.config.ts`
  and exports `Conversation`, and the commands never reach the bundle. Uploads nothing.
- `files.test.ts`: `wrangler.jsonc` keeps its promises, and only `entrypoint.ts` imports `cloudflare:*`.

In the pikit repository, the workerd lane (`tests/workerd/test/deployment-cloudflare.workerd.ts`) runs
the entrypoint on real SQLite-backed Durable Objects: `/health`, `WORKERS_HOST`, `deliver` and the
alarm reaching their handlers, an evicted object starting again, and a failed start resetting it. And
`packages/cli/src/deploy-hooks.test.ts` runs `up` with a fake wrangler against
`channel-telegram-webhook`'s fake Telegram: its webhook registered only once the new version answers;
and against a fake MCP server, `tool-mcp`'s seed written before wrangler bundles, and a server that is
down stopping `up` before it.

`component.json` is generated, not written by hand. With no `setup`, it provides and requires
nothing. Its `files` maps `files/src` to `src` and names `wrangler.jsonc`; its `devDependencies`,
written by hand, name `wrangler`.
