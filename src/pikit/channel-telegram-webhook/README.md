# channel-telegram-webhook

Talk to your agent in Telegram when it runs on Cloudflare: Telegram posts each message to your Worker.

- **Provides:** `http.route` (`POST /telegram`, and `POST /telegram/<name>` per extra bot, where
  Telegram posts; `GET /telegram/setup`, which registers the webhooks).
- **Requires:** in the Worker's half, `secrets` and `actor.mailbox`; in the object's half, `secrets`,
  `conversations.registry`, `agent.runtime`, `agent.submissions`, `storage.kv`, `wakeups` and
  `actor.inbox`, where it registers the handler of `telegram.update`. A router (such as
  `router-basic`) picks the agent.
- **Uses, if installed:** `outbound.queue` (durable sending).
- **Target:** `durable`. On a server, use `channel-telegram` (long polling, no public URL needed):
  absence, not flags (SPEC §4.1, C6).
- **Installs to:** `src/pikit/channel-telegram-webhook/`.
- **npm dependencies:** `typebox`.
- **Environment:**
  - `TELEGRAM_BOT_TOKEN` (secret, required): the bot's token from @BotFather.
  - `TELEGRAM_ALLOWED_USERS` (required by `pikit doctor`): the Telegram user ids allowed to talk to
    the bot, separated by commas. `pikit configure` fills it. Deployed without the CLI it may be
    empty: the owner logs in with the password instead.
  - `TELEGRAM_WEBHOOK_SECRET` (secret, required): what Telegram sends with every update, so only
    Telegram reaches your agent. `pikit configure` generates it.
  - `TELEGRAM_PASSWORD` (secret, optional): the bot's password, 8 characters at least. A private
    chat that sends `/login <password>` may talk to the bot from then on ("The password" below).

## Two halves, one per App

On Cloudflare a project has two Apps in `pikit.config.ts` (SPEC §4.1, C1): the Worker's, which checks
and routes, and the Durable Object's, which owns one conversation. This component has a half for each:

| | The Worker's half | The object's half |
|---|---|---|
| Export of `index.ts` | `worker` (named in `component.json`'s `apps.worker`) | the default export |
| Component name, and its config's key | `channel-telegram-webhook-worker` | `channel-telegram-webhook` |
| Does | the route, the secret, the allowed users, strangers, `actor.mailbox`, registering the webhook | commands, `admitInbound`, delivering answers, logins |

```ts
import channelTelegramWebhook, { worker as channelTelegramWebhookWorker } from "./src/pikit/channel-telegram-webhook/index.ts";

// The Worker's App: secrets, actor.mailbox (an RPC to the object), http.route's server…
export const worker = defineApp({ components: [/* … */ channelTelegramWebhookWorker], config: workerConfig });
// The Durable Object's App: the router, the runtime, the registry, storage, submissions, wakeups…
export default defineApp({ components: [/* … */ channelTelegramWebhook], config });
```

`pikit add channel-telegram-webhook` writes both lines, and the import, in a project on Cloudflare
(`component.json`'s `apps.worker` names the export); `pikit remove` takes both out, with their config
keys. Both halves take the same `apiBase` and `accounts` in their own config. Each App needs what its
half requires: `secrets` in both (`secrets-cloudflare` goes in both), `actor.mailbox` in the Worker's;
`pikit add` warns per App about what is missing, and `pikit doctor` composes both. The Worker's routes
are served by `deployment-cloudflare`'s entrypoint.

The object's half registers its `actor.inbox` handler in `actor-inbox.ts` only (`registerInbox`): it
uses `actor.inbox` and calls `handle("telegram.update", handler)` in its `start`. The mailbox's
provider depends on no handler, so the half uses `wakeups` and the runtime (which drives its runs with
the same `wakeups`) in one App with `platform-cloudflare`, which provides `actor.inbox` and `wakeups`
there, with no dependency cycle.

It also runs with both halves in one App on a server (with `mailbox-local`, `wakeups-timers`, and
`server-bun` behind HTTPS): its tests run it that way. Its target stays `durable`, since on a server
`channel-telegram` needs no public URL.

## Set it up

Two ways, the same component: with pikit's CLI, or with a "Deploy to Cloudflare" button, where
nobody runs pikit.

### With the CLI

```sh
pikit add channel-telegram-webhook
pikit configure
pikit up
```

`pikit configure` walks you through it:
1. If you have no bot yet, it explains @BotFather in three lines. Paste the token; it is checked
   at once, and it shows your bot's name and link.
2. It generates `TELEGRAM_WEBHOOK_SECRET` into `.env`, or keeps the one there if Telegram accepts it
   (16 to 256 of `A-Z a-z 0-9 _ -`). Nobody types it.
3. It asks you to open your bot and send it any message, shows who wrote ("Ada (@ada), id 1001"),
   and on "y" that person is allowed. It reads that message with `getUpdates`, which Telegram
   refuses while the bot has a webhook: if a deploy already set one, it offers to remove it (the
   Worker answers nobody while nobody is allowed, and the next `pikit up` sets it again).

Before step 3, on a first setup (nobody allowed yet, no password), it offers to choose the bot's
password: "Choose a password for your bot (8+ characters, or Enter for none): you'll send /login
<password> to it once deployed". Enter skips it: with the CLI, step 3 is how you are allowed. A
`TELEGRAM_PASSWORD` you set yourself is checked and saved to `.env`, so `pikit up` uploads it.

`pikit up` deploys, waits until the new version answers, then registers the webhook (`afterDeploy`):
see "Registering the webhook" below.

### With a "Deploy to Cloudflare" button

The button clones a template (a project made with `pikit new --target durable --preset
telegram-cloudflare`, published as a public repository) into the user's GitHub, asks for its secrets
in a form, and builds and deploys it with Workers Builds (`wrangler deploy`), again on every push.
There is no `pikit configure` and no `pikit up`, so the template does three things:

1. **The form.** Its `.dev.vars.example` lists the secrets, and `package.json`'s `cloudflare.bindings`
   describes them. `TELEGRAM_ALLOWED_USERS` is not asked: nobody knows their Telegram id. The owner
   logs in instead, with the password they choose here.

   ```ini
   TELEGRAM_BOT_TOKEN=
   TELEGRAM_WEBHOOK_SECRET=
   TELEGRAM_PASSWORD=
   OPENROUTER_API_KEY=
   ```

   ```json
   "cloudflare": {
     "bindings": {
       "TELEGRAM_BOT_TOKEN": { "description": "In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, and paste the token it answers." },
       "TELEGRAM_WEBHOOK_SECRET": { "description": "Any random string of 16 to 256 letters, digits, `_` or `-`. Telegram sends it with every message, so only Telegram reaches your bot. You never type it again." },
       "TELEGRAM_PASSWORD": { "description": "A password you choose for your bot, 8 characters or more. Once deployed, send `/login <password>` to your bot: that chat stays allowed. Change it to log everyone out." },
       "OPENROUTER_API_KEY": { "description": "Your [OpenRouter](https://openrouter.ai/keys) API key: the model your agent runs on." }
     }
   }
   ```

2. **The webhook registers itself.** The new version checks its webhook as it starts, on its first
   request ("Registering the webhook"). So that the first deploy needs no visit, the template's deploy
   command runs `setup-webhook.mjs` after `wrangler deploy`; the button pre-fills the deploy command
   from `package.json`'s `deploy` script:

   ```json
   "scripts": { "deploy": "wrangler deploy | node src/pikit/channel-telegram-webhook/setup-webhook.mjs" }
   ```

   It passes wrangler's output through, reads the Worker's URL and the version deployed from it,
   waits until `/health` answers that version (C8), then calls `GET /telegram/setup`, prints one line
   per bot and fails the build when a bot could not be registered (the version stays deployed). The
   build has no runtime secrets, and needs none: the Worker registers itself with its own. Given the
   URL instead (`node …/setup-webhook.mjs https://my-bot.acme.workers.dev`), it does the same by hand.

   The template's `wrangler.jsonc` also names the Worker (`"name"`): pikit's leaves it out, since its
   commands pass `--name`, and Workers Builds runs wrangler without them. With one, pikit's commands
   use it too, so `pikit up` from a clone deploys the same Worker.

   pikit makes this template itself: `bun scripts/template.ts telegram-cloudflare <dir>`
   (`templates/README.md`).

3. **The owner logs in.** Once deployed, they open the bot in Telegram. It answers that it is
   private, and that whoever has its password sends `/login <password>`. They send it, and the bot
   talks to them from then on ("The password").

## What it does

- **Receiving messages.** Telegram posts each update to `POST /telegram` with the secret in
  `X-Telegram-Bot-Api-Secret-Token`. A request without it, or with another, is `401` (compared in
  constant time, as SHA-256 digests).
- **What gets through:** messages with text from people in private chats. Group messages, bots and
  other updates are acknowledged (`200`) and dropped. A message without text gets "I can only read
  text messages for now."
- **Who may talk** is the list in `TELEGRAM_ALLOWED_USERS`, checked in the Worker, and the chats that
  logged in with the password, kept in their objects ("The password"). A stranger is told their user
  id, so you can add it, and nothing reaches the agent. When the bot takes no logins (no password,
  and users listed: the CLI's way), the Worker tells them itself and reaches no object; it keeps no state,
  so a stranger who keeps writing may be told again after its isolate is recycled.
- **The way to the conversation.** The Worker sends the update to the conversation's actor,
  `actor.mailbox.send("telegram:<chat>", "telegram.update", update)`: on Cloudflare, the Durable
  Object `idFromName("telegram:<chat>")`. It answers Telegram `200` once the conversation holds the
  message durably, and `500` when it could not, so Telegram delivers it again.
- **Acknowledged as soon as the message is durable, never after the run.** Telegram does not
  publish how long it waits for a webhook, and a run takes as long as the agent does.
- **A message delivered twice is answered once.** Its request id is `telegram:<chat>:<message>`, as
  in `channel-telegram`: the runtime answers the second one `duplicate`. A command Telegram delivers
  again is recognised by its message id and not run twice.
- **Conversations:** each private chat is one conversation, `telegram:<chat id>`, the keys
  `channel-telegram` makes.
- **Commands:** `/new` (or `/reset`) starts a new conversation; the old one is kept.
  `/start` and `/help` explain. `/login` in a chat that may talk already says so, and never reaches
  the agent (it may hold the password). Any other command goes to the agent as text.
- **The way to the agent** is the inbound path every channel takes (`admitInbound`). When the agent
  will not answer, the chat is told: "I can't take that message." when a stage stops it, "Sorry, I
  can't answer that here." when the router denies it, "This bot is not set up to answer yet." when no
  router is installed.
- **While the agent works**, the chat shows "typing…", renewed every 4 seconds for at most 10
  minutes per message.
- **Answers** are channel-telegram's: Markdown converted to Telegram's formatting (plain text if
  Telegram refuses it), split under 4096 characters, a failed run told with its error code, an
  abandoned message asked to be sent again.

### Delivering answers

Nothing waits for a run in memory: an object keeps running only while an event is in progress (C4).
Answers are delivered by `startAnswerDelivery` (`@pikit/contracts`), the one delivery every chat
channel shares, run by the wakeup `channel-telegram-webhook.answers`: at every start, whenever a
message arrives, and whenever a run of its conversations ends. The channel gives it only what is
Telegram's: its bots' transports, which bot a conversation is, its words (`replyText`) and its waits
(`DELIVERY` in `index.ts`).

- It reads every run's outcome from `agent.submissions`' `answers` feed, from a cursor it keeps in
  `storage.kv` (the key `answers-cursor` of its namespace, `channel-telegram-webhook`). The cursor
  moves only past answers delivered. An answer that ended while nothing ran (an eviction, a restart,
  a deploy), or whose event was lost, is delivered at the next run.
- Without `outbound.queue`, each piece is marked in `storage.kv`, `sending` before it goes and `sent`
  after. A piece found `sending` (the object died during the send, or it timed out) is sent again
  starting with `↻ `, since Telegram cannot tell a repeated send apart; one Telegram refused outright
  goes again unmarked. With `outbound-durable` installed, the answer is enqueued under its answer key
  instead: stored once, sent through the queue.
- A failure waits: Telegram's `retry_after` for a 429; 1 s, 5 s, 30 s, then every minute otherwise,
  logged as an error from the 3rd in a row. A permanent refusal (the user blocked the bot) is logged
  and the answer given up.
- Each conversation's answers go in the feed's order, so one that cannot be delivered holds up the
  ones after it in its chat only; other chats go on (with both halves in one App on a server, up to
  200 answers past a stuck one).
- One run stops at its slice's deadline or after 20 pieces, and asks to run again at once.
- "typing…" is its own wakeup, `channel-telegram-webhook.typing` (`typing.ts`): every 4 s while a
  message of one of its chats waits for its run (`agent.submissions`' `pending`), for at most 10
  minutes.

It refuses to start: the Worker's half without a token or a usable webhook secret, with an allowed
users list that is not ids, or with a password shorter than 8 characters; the object's half without
a token. With nobody listed and no password the Worker starts and logs that only chats that logged
in before can talk to it. The object's half never calls Telegram to start: on Cloudflare every
object runs the start, and each call is a subrequest. The Worker's half checks its webhook at start
on Cloudflare, once per isolate ("Registering the webhook").

## The password

With the button nobody reads the owner's first message, so nobody knows their user id and
`TELEGRAM_ALLOWED_USERS` stays empty. The bot's password lets its owner in instead:

1. you choose the password: in the button's form (`TELEGRAM_PASSWORD`), or with `pikit configure`;
2. you deploy;
3. you send `/login <password>` to your bot in Telegram;
4. that chat stays allowed, across restarts and deploys;
5. whoever knows the password can log in too, from their own chat;
6. change the password to log everyone out: every chat that logged in with the old one must send
   `/login` with the new one.

The details (`login.ts`):

- **Where logins live.** The Worker has no storage (C1); each chat's object has `storage.kv`. So when
  the bot takes logins (a password is set, or nobody is listed) the Worker lets the listed users
  through as before and hands everyone else's private messages to their chat's object
  (`actor.mailbox.send("telegram:<chat>", "telegram.stranger", update)`), which decides. A login is
  kept in the channel's namespace of `storage.kv` with the user's id and the password's fingerprint
  (its SHA-256): it survives restarts, evictions and deploys.
- **A logged-in chat** is handled as an allowed one: commands, the agent, answers.
- **`/login <password>`** is compared in constant time (SHA-256 digests). A wrong one is told "Wrong
  password."; after 5 in a row the chat waits 15 minutes, during which every `/login` is refused
  unchecked. Telegram delivering the same message again is not another guess. The password never
  reaches the agent nor a log line; the bot suggests deleting the message that contains it.
- **Strangers** are told their id once (remembered per chat), and `/login` only when a password is
  set. Without one, `/login` is a stranger's message like any other.
- **Logging everyone out, and closing logins.** A login holds while the password it was made with is
  set, or while none is:
  - change `TELEGRAM_PASSWORD` (the Worker's secret, in the dashboard or `wrangler secret put`) to log
    out every chat that logged in with the old one: each is told once how to log in, and sends
    `/login` with the new password, which you tell only to whom you choose. Going back to a former
    password lets back in the chats that logged in with it: choose a new one;
  - remove it to stop new logins: the chats that logged in keep talking while
    `TELEGRAM_ALLOWED_USERS` is empty. With ids listed, the Worker decides alone again, and only
    those ids talk.
- **`TELEGRAM_ALLOWED_USERS`** works as before and needs no password; both can be used together.

## Registering the webhook

Telegram must be told where to post (`setWebhook`), and only once the new version answers: right after
a deploy the previous version still answers for a few seconds, and would refuse the new secret (C8).
Three ways, all idempotent, all with `<origin>/telegram[/<name>]`, the bot's secret and
`allowed_updates: ["message"]`, keeping the updates Telegram holds:

| Who | When | Calls |
|---|---|---|
| `pikit up` (`afterDeploy`) | once `/health` answers the new version | `setWebhook`, `getWebhookInfo` |
| the Worker, as its App starts on Cloudflare | once per isolate: its first request, `/health` included | `getWebhookInfo`; `setWebhook` and `getWebhookInfo` only when Telegram has another URL or other updates |
| `GET /telegram/setup` (a person, a build's `setup-webhook.mjs`) | when asked | `setWebhook`, `getWebhookInfo` |

**The Worker registering itself** (`webhook.ts`) is what makes a deploy without `pikit up` work. Its
App starts on its first request, so a new version checks once in each isolate: one subrequest when all
is well (of the 50 an invocation has on the Free plan), three when it registers. "Done for this
version" is not stored anywhere (the Worker has no storage, C1): Telegram's `getWebhookInfo` is the
truth it compares with, and an isolate runs one version. The origin is the one its first request
reached (`WORKERS_HOST.origin`); only an `https:` one is registered, since Telegram posts nowhere else
(`wrangler dev` asks Telegram nothing). A failure is logged with the setup URL to open, and the Worker
starts anyway. Anything else that runs this Worker with the same token and serves an HTTPS request
takes the webhook the same way (another deployment, a tunnel to `wrangler dev`): give it another bot.

`getWebhookInfo` never shows the secret, so a new `TELEGRAM_WEBHOOK_SECRET` alone is not noticed: open
`/telegram/setup` once after changing it (or `pikit up`).

**`GET /telegram/setup`** always sets every bot's webhook at the origin it was called at, then checks
it, and answers `{ "ok": true, "version": "<version id>", "bots": [{ "bot": "telegram", "webhook":
"https://…/telegram", "ok": true }] }` (`502` with each bot's `problem` when Telegram refused). It needs
no auth: it can only point the bot at the Worker that answers, with that Worker's own secret; it
names no token and no secret; and a stranger calling it costs three subrequests. Asking for a secret
would also break the build step, which has none. A Worker with Durable Objects has no preview URLs, so
the only origins that reach it serve the deployed version.

**`pikit up`**: `deploy.ts` exports `afterDeploy`, and `component.json` names it (`"hooks": { "afterDeploy": "deploy.ts" }`):
`pikit add` records it in `pikit.json`, and `deployment-cloudflare`'s `up` calls it once `/health`
answers with the version it deployed (its README, "After the deploy"). `pikit up` prints what it says,
and fails with its problems. Called by hand:

```ts
import { afterDeploy } from "./src/pikit/channel-telegram-webhook/deploy.ts";

const problems = await afterDeploy({
  url: "https://my-agent.example.workers.dev", // the deployed Worker's public base URL
  config,                                      // this component's config in pikit.config.ts
  get: (name) => env[name],                    // .env or the environment: tokens and webhook secrets
  say: (line) => console.log(line),
});
```

For each bot it calls `setWebhook` with `<url>/telegram[/<name>]`, its secret and
`allowed_updates: ["message"]`, then checks the URL with `getWebhookInfo`. It resolves with one line
per bot that failed (empty when done), and throws only when Telegram cannot be reached. Updates Telegram
holds are kept, not dropped. Setting the same webhook again is harmless, so every deploy calls it.

The secrets reach the Worker as Worker secrets (`deployment-cloudflare` puts the `.env` ones there):
`secrets-cloudflare` reads them in both Apps.

## Config

```ts
"channel-telegram-webhook": {
  apiBase: "https://api.telegram.org", // default; a local Bot API server, or a test double
  accounts: [],                        // more bots besides the default one, by name
},
"channel-telegram-webhook-worker": {   // in the Worker's App: the same values
  apiBase: "https://api.telegram.org",
  accounts: [],
},
```

## Several bots

As in `channel-telegram`, the default bot is `TELEGRAM_BOT_TOKEN` and its conversations are
`telegram:<chat>`. Each name in `accounts` adds a bot of its own, in both halves:

| `accounts: ["ops"]` | |
|---|---|
| instance | `telegram:ops` (what routers match and the outbox delivers by) |
| token | `TELEGRAM_OPS_BOT_TOKEN` |
| allowed users | `TELEGRAM_OPS_ALLOWED_USERS` |
| webhook secret | `TELEGRAM_OPS_WEBHOOK_SECRET` |
| password | `TELEGRAM_OPS_PASSWORD` |
| webhook | `POST /telegram/ops` (registered by the same `GET /telegram/setup`) |
| conversations | `telegram:ops:<chat>` |

An update for a bot the object's half does not run is refused (`500`, and an error in the log): keep
`accounts` equal in both halves.

## Where its code comes from

Components never import each other, so what both Telegram channels need is copied. `format.ts`,
`format.test.ts` and `transport.ts` are the same files as `channel-telegram`'s, and a repository
test (`twins.test.ts`, beside `files/`) keeps them identical. `api.ts` and `account.ts` are copies
extended: `api.ts` adds `setWebhook`, `deleteWebhook` and the rest of `getWebhookInfo`;
`account.ts` adds each bot's webhook secret, password and path. `configure.ts` is
`channel-telegram`'s step with the webhook's secret and an existing webhook added. The delivery follows
the Cloudflare spike that ran in production (September 2026).

## Tests

The tests are copied with the component and run in your project against
`fake-telegram.test-support.ts`, a local stand-in of the Bot API extended with `setWebhook`,
`getWebhookInfo` and `deleteWebhook` (counting both), which posts each update to the webhook with its
secret: no bot, token or network needed. Only tests import it.
- `channel-telegram-webhook.test.ts` covers the whole conversation, with the in-memory doubles of
  `actor.mailbox`, `wakeups`, `storage.kv` and `agent.submissions`: a bad secret (`401`), strangers,
  groups and messages without text, a message reaching the runtime and its answer delivered,
  "typing…", a redelivered update answered once, a conversation that cannot take a message (`500`),
  commands, failed runs, long answers split, an answer that ended while no wakeup ran delivered at the
  next one, a piece found `sending` sent again with `↻ `, a refused send tried again, the outbox,
  several bots, the halves in two Apps as on Cloudflare, the start failures, the lifecycle suite
  for each half, and `registerInbox` reached through the mailbox. The webhook registering itself:
  `GET /telegram/setup` (every bot, again, refused), the start on Cloudflare (once per isolate, not
  again when Telegram has it, back when it was moved, nothing over HTTP or off Cloudflare, a refusal
  logged), and `setup-webhook.mjs` run as a build runs it. The password: strangers told `/login` only
  with a password, a login and its redelivery, an allowed chat's `/login`, wrong passwords and the
  cool-down, a login kept across restarts and after the password is removed, and logged out by a new
  password.
- `conformance.test.ts` runs the channel conformance suite from `@pikit/contracts/testing`: what every
  channel does with a message (a transient failure of admission answered `500` and posted again
  until taken, `/new` delivered again run once included), and what comes with durability (an answer that ended while stopped or
  whose event was lost, delivered once; a failed send tried again in order; a send cut mid-flight
  resent once, marked; one chat's failures holding up no other).
- `configure.test.ts` covers the setup: a checked token, the generated secret, allowing whoever
  messages the bot, a bot that already has a webhook, the same without a terminal, and the password:
  offered on a first setup, checked and saved.
- `deploy.test.ts` covers `afterDeploy`: every bot's webhook set and checked, and what it reports.
- `format.test.ts` is `channel-telegram`'s, for the shared `format.ts`.

`component.json` is generated from `setup` by `pikit registry generate`, from both halves; "what
setup declares" pins them in the tests.
