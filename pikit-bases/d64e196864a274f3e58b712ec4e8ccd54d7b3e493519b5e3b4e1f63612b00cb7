# admin-api

The operator's HTTP API (SPEC §5): what the dashboard reads and does, under `/admin/api/*`, and the
dashboard's built files under `/admin/`. A project with a UI (`pikit new --ui`, `pikit ui on`) has it
installed; it also stands on its own, for a script or an agent that reads the service.

- **Provides:** `http.route`: the routes below, and `GET /admin/*` for the dashboard's files; and two
  slash commands, `agent.command` `new` and `name` ("Slash commands" below).
- **Requires:** `admin.auth` (who is an operator; `admin-auth-token`), `agent.observe` (runtime-pi),
  `agent.runtime`, `conversations.registry`, `storage.sql` (the conversation index); optionally
  `agent.definition` (the agents it lists), `agent.directory` (the live ones, agents-live's: listed
  after them), `agent.command` (the commands it lists and runs: its own,
  runtime-pi's `/compact`, yours) and `model.complete` (runtime-pi's: the model that titles
  conversations; without it, none is titled). A server (such as `server-bun`) serves the routes. On Cloudflare, also `actor.inbox` and `actor.mailbox`
  (platform-cloudflare).
- **Targets:** `server` and `durable` (Cloudflare): below, how it works on each.
- **Installs to:** `src/pikit/admin-api/`. `dashboard-files.ts` there is the dashboard's build's, never
  yours (`generated`).
- **npm dependencies:** `typebox`.

## The API

Every route under `/admin/api/` asks `admin.auth` first: without an operator's credential the answer
is `401`. The credential is `Authorization: Bearer <PIKIT_ADMIN_TOKEN>` with admin-auth-token, or a
browser's session cookie (below). The JSON of every answer is typed in `api.ts`, of which the
dashboard keeps an identical copy (`src/dashboard/src/lib/admin-api.ts`); an error is
`{ error, message? }`.

| Route | Answer |
|---|---|
| `GET /admin/api/app` | the composition: components, capabilities and providers, pipelines, config (`APP_DESCRIPTION`; a value that looks like a secret is `[redacted]`) |
| `GET /admin/api/agents` | `{ items: [{ name, live?, description?, model, tools, steward }] }`: the App's agents (`agent.definition`), then the live ones (`agent.directory`, `live: true`, never the steward), the names of the tools each is defined with, and whether it is the steward |
| `POST /admin/api/session` | the credential once → `200 { operator }` and a session cookie |
| `DELETE /admin/api/session` | `204`, the session cookie cleared |
| `GET /admin/api/conversations?limit&cursor` | a page of conversations, the most recently active first: key, agent, busy, last activity, cost, and `current` (whether its key points to it now) |
| `POST /admin/api/conversations` | `{ agent, text, attachments?, webSearch?, requestId? }`: a conversation of the dashboard's own → `201 { conversationId, key, requestId, admission }` |
| `GET /admin/api/conversations/:id` | one conversation |
| `GET /admin/api/conversations/:id/transcript?limit&cursor` | its history, newest first, a page at a time |
| `GET /admin/api/conversations/:id/events` | its live events as server-sent events: a `snapshot`, then each change |
| `POST /admin/api/conversations/:id/messages` | `{ text, attachments?, webSearch?, requestId? }`: the operator's follow-up → `202 { requestId, admission }` |
| `POST /admin/api/conversations/:id/abort` | stops its run → `200` |
| `POST /admin/api/conversations/:id/reset` | points its key to a new, empty conversation; the old one is kept → `200 { key, previousConversationId, conversationId }` |
| `GET /admin/api/commands` | `{ items: [{ name, description, argumentHint? }] }`: the App's slash commands (`agent.command`), by name |
| `POST /admin/api/conversations/:id/commands/:name` | `{ args? }`: the command run in the conversation → `200 { text? }`, a note for the operator |
| `GET /admin/api/delivery/pending?limit&cursor` | what is not delivered yet (with an `outbound.queue`, on a server) |
| `GET /admin/api/delivery/receipts?after&limit` | what settled (with an `outbound.queue`, on a server) |

- `limit` is 1 to 500 (50 when absent); `cursor` is the `next` of the previous page. Either one wrong
  is `400`.
- An id is opaque: put it in a path encoded (`encodeURIComponent`). An id with `:`, `@`, `.`, `~` or
  an encoded `/` (`email:ana@empresa.com~1`) is one segment like any other.
- A message, an abort or a reset reaches only a conversation's current one: to one a reset left
  behind it is `409 not_current`, to one with no key (no message reached it, no reset pointed a key to
  it) `409 no_agent`.
  A reset's new conversation is its key's current one, with the key's agent (`conversations.registry`'s
  `get`), before any message reaches it: it is listed with its key and takes a message at once.
- A message's `attachments` are images, `{ kind: "image", mimeType, data }` (base64, no `data:`
  prefix): png, jpeg, webp or gif, at most 4, each at most 5 MB (`attachmentsProblem` in `api.ts`; a
  wrong type or count is `400`, a larger one `413 too_large`, as is a body larger than a message can
  be). On Cloudflare they are at most 1 MB in all: the object stores the message in one Durable Object
  row (2 MB). The agent gets them with the text (`AgentRequest.images`), and the transcript keeps them.
  With attachments, `text` may be empty.
- A conversation is listed and read with its key's `title` when it has one ("Titles" below).
- `webSearch: true` asks the agent, in the message's first line, to search the web for it with the
  `websearch` tool (`WEB_SEARCH_TOOL`; tool-websearch-brave provides it): only of an agent defined
  with that tool, another is `400 invalid_request`.
- Live events: one JSON object per `data:` line, each with its `type`, in the runtime's own words. A
  client that falls behind gets a new `snapshot`: rebuild the view from it. A comment line every
  `heartbeatMs` keeps an idle stream open. A browser's `EventSource` cannot send a header: read the
  stream with `fetch`, and connect again when it ends.

```sh
curl -N -H "Authorization: Bearer $PIKIT_ADMIN_TOKEN" http://localhost:3000/admin/api/conversations
```

### The dashboard is a channel of its own

- **Its own conversations.** `POST /admin/api/conversations` makes a key `dashboard:<uuid>` and
  resolves it with one of the App's agents (`GET /admin/api/agents`: the code's or a live one; another
  is `400 unknown_agent`), then dispatches the first message. Its answers appear only in the dashboard:
  no channel delivers a `dashboard:` key, and none makes one, so no other channel can continue it.
- **Another channel's conversation.** The operator's message is a follow-up, never a steer (with a run
  going, it waits for it), and its request id starts with `dashboard:` (`DASHBOARD_REQUEST_PREFIX`; a
  client's own must too, or it is `400`). A run every request of which is the dashboard's is never
  delivered to that channel (`startAnswerDelivery`, @pikit/contracts): its answer stays in the
  dashboard, and nothing the operator says is sent anywhere. A run that answers both a user's message
  and the operator's (the follow-up joined the user's turn) is delivered to the user, as any run is.
- **The agent knows.** The message it reads starts with a line saying it comes from the operator in
  the dashboard, and, in another channel's conversation, that the user does not see it or its answer,
  and, when the operator asked for it, to search the web (`operatorPrompt`).
- **Abort and reset** stay on every conversation.
- Each action is logged with the operator's id and the conversation's key, never the message's text
  (a message's number of images and its web search, when it has them).

### Slash commands

The dashboard's "/" lists the App's slash commands and runs them in a conversation. They are a
registry, as Pi's are (`registerCommand`): the keyed capability `agent.command` of `@pikit/contracts`
(`command.ts`), one command per name (Pi's rule: lowercase letters, digits, `-` and `:`), each a
`{ description, argumentHint?, run(conversation, args, ctx) }`. Nothing about them is the dashboard's:
it shows what `GET /admin/api/commands` lists, and nothing else.

- **Who registers them.** admin-api registers two of Pi's built-ins that pikit does for real: `/new`
  (Pi's "Start a new session": the key's reset, `conversations.registry`'s `reset`; the dashboard
  follows the key to its new conversation) and `/name <title>` (the conversation's title, replacing a
  model's). runtime-pi registers `/compact` (pi-durable's manual compaction). A component of yours
  registers its own the same way:
  `pikit.provideKeyed("agent.command", "deploy", { description, argumentHint, run })`.
- **Where one runs**: in the App that holds the conversation (on Cloudflare its object, by the call
  `admin-api.command`), with the conversation's `ConversationRef` and the text after the name,
  trimmed (`runAgentCommand`). It acts only through contracts.
- **As an action**: only an operator, only a key's current conversation (`409 not_current`, `409
  no_agent`), whether or not a run is going. An unknown name is `404 unknown_command` (before the
  conversation is looked at); a command that throws is `422 command_failed`, its message the reason.
  It is logged with the operator, the key and the command's name, never its arguments.
- **What comes back**: `{ text? }`, which the dashboard shows in the conversation as a quiet note for
  the operator: no channel gets it, and the transcript has only what the command did there.

### Titles

A conversation gets a title once, from a model, after its first run settles: admin-api asks
`model.complete` (runtime-pi's) in the background, so no request and no event waits for it, with a
short system prompt (a title of 2 to 6 words, in the language of the message, no quotes) and the
conversation's first message (the text written, the operator's note line taken off, at most 1,000
characters; `maxTokens` 32, besides what a reasoning model thinks: `model.complete` leaves it room,
and asks one whose thinking cannot be turned off for the least). The model is `titleModel` when set, else the conversation's agent's. The
answer is cleaned (`cleanTitle` in `api.ts`: its first line, no label, quotes or markdown, at most 60
characters, cut at a word). A failure (a model error, an answer with no title) is logged, and tried
once more after a later run; then never (`TITLE_TRIES`). `/name` replaces any title, and no model
replaces the operator's. A title names one conversation: a reset (`/new`) starts one that gets its
own from its own first message. Until a conversation has a title, its first message (cleaned the same
way) names it, once a model was asked to title it. Titles are kept with the index (below) and come
with each conversation (`title`). With a fake model
(provider-faux) the title is its echo of the first message, cleaned.

### Browser sessions

`POST /admin/api/session` with the credential (and the header `x-pikit-admin: 1`) answers with a
session cookie from `admin.auth`'s `sessions` (admin-auth-token: signed, HttpOnly, SameSite=Strict,
`Path=/admin/api`, 12 h). The API then takes the cookie instead of the credential, but a `POST`
also needs `x-pikit-admin`, which a page of another site cannot send. `DELETE` clears it. An
`admin.auth` without sessions answers `404 not_installed`: send the credential with every call.

## The conversation index

The list is newest activity first, a page at a time, on every host: `agent.observe` lists in
creation order, and on Cloudflare sees one object's conversations. So admin-api keeps an index,
`admin_api_conversations` in `storage.sql`: one row per conversation (its key, its id, its agent, the
time of its newest activity), written

- when a message is dispatched (`agent.dispatched`, in the caller's context once it is durable; a
  duplicate is no activity), when a run settles or fails, when a reset points a key to a new
  conversation (listed at once), and when a resumed run starts;
- when the App starts, from every conversation `agent.observe` holds (on a server in the background,
  a page at a time; on Cloudflare the object's own): a conversation made before admin-api was
  installed, or whose events were missed (SPEC K3), is listed once its App starts again.

A write is an upsert that keeps the newest time: told twice, or late, it changes nothing. A row whose
conversation the runtime no longer has is left out of the page. Any conversation can always be read
by its id.

Titles are a second table of the same storage, `admin_api_conversation_titles`: one row per
conversation (its title, a model's or the operator's, the first message a model titles, its tries).
On a server it is the App's `storage.sql` (its conversation ids are unique); on Cloudflare the
conversation's own object's, by the object's own id (where its runs settle and `/name` runs, and
whose answer the list reads), not the index object's.

## On a server

One App, and this component's default export is the whole API over its contracts
(`createLocalBackend`): the list from the index (the App's own `storage.sql`), each conversation from
the runtime, ids the runtime's, live events from `agent.observe`'s `watch`, delivery from the
`outbound.queue` when one is installed.

## On Cloudflare

Each conversation lives in a Durable Object of its own (SPEC §4.1, C1), and the Worker reaches one only
by `actor.mailbox.call` (JSON in, JSON out). So admin-api has two halves, which `pikit add` (and
`pikit ui on`) puts in the two Apps of `pikit.config.ts`; admin-auth-token goes in both.

- **The Worker's half** (`worker.ts`, `export const worker`, config key `admin-api-worker`) serves the
  routes over the remote backend (`remote.ts`): each read and action is a call to the conversation's
  object. It needs only `admin.auth` and `actor.mailbox`.
- **The object's half** (the default export, in each object's App) answers those calls about its own
  conversations, through the same contracts as on a server (`calls.ts`), and tells the index of their
  activity (`admin-api.seen`, a message to the index object).
- **Ids** name the object: `<conversation key>~<the object's id>` (`telegram:12345~1`), split on the last
  `~`. Every object numbers its own conversations, so its own id alone names nothing.
- **The index** is the object `admin-api:index` (an object of the same class, which runs the same App
  and holds no conversation), its rows in that object's `storage.sql`. The list asks it for a page,
  then each conversation's object for it: a page is at most 20 conversations whatever `limit` says
  (each is a subrequest). An object that does not answer is left out of the page, and logged.
- **A new conversation** of the dashboard's own is one call to the object of its new key.
- **Live events are polled.** No call streams, so `…/events` asks the object for its `snapshot` every
  2 s and sends it only when it changed, then ends after 40 of them (the subrequests of a request are
  bounded); the dashboard connects again. Text does not stream word by word: the view shows where the
  run is, every 2 s.
- **The composition** (`/admin/api/app`), **the agents** (`/admin/api/agents`) and **the commands**
  (`/admin/api/commands`) are the objects' App's, where the agents run (the index's). A command runs
  in its conversation's object (`admin-api.command`), and a title is made and kept there.
- **Sizes.** A call carries at most 32 MiB each way. A message's images are at most 1 MB in all
  (checked in the Worker and again in the object), and a transcript page with images inline is
  answered shorter (`ANSWER_CHARS` in `calls.ts`) until it fits; its `next` reads on.
- **Delivery** is not listed: each conversation's outbound queue is in its own object
  (`404 not_installed`).
- An object that cannot be reached is `503 unavailable`.
- An id naming a key nobody used starts an empty object for it (Durable Objects exist by name), which
  then answers `404`. Only an operator can ask.
- **What it costs.** Every Worker request and every Durable Object call counts in the day's requests
  (the Free plan: 100,000 Worker requests and 100,000 Durable Object requests a day), shared with the
  bot. A list page is 1 Worker request and up to 21 object requests; an open conversation about 30
  object requests a minute. The dashboard asks only while its tab is visible and the operator is there
  (its README, "Requests").

## The dashboard's files

`GET /admin/*` serves `dashboard-files.ts`, a module the dashboard's own build writes
(`src/dashboard/`: `bun run build`, whose last step is `scripts/embed.ts`): every file of its `dist/`,
in base64. It is bundled with the app, so a server and a Worker serve it the same way, with no disk and
no binding. As installed it is empty, and `/admin/` is a `404` that says no dashboard is built; the API
still answers.

- The files hold no data, so they are served without a credential: a browser's navigation sends no
  header, and the page asks the operator for the token, once.
- Only `/admin/assets/…` and the built files are files: a missing asset is a `404`. Any other path is
  a page of the app and gets `index.html`, whatever it holds (an id with `.`, `@` or `%2F`): a reload
  of any page works. A path never leaves the files.
- Every answer has a Content-Security-Policy (`CSP` in `assets.ts`): `default-src 'self'`, scripts
  only from the dashboard's own files (no inline script, no `eval`), styles from its files and inline
  (the dialogs set some), fonts from its files, images from its files, `data:` and `blob:` URLs (an
  image in a transcript, one attached before it is sent), no framing, forms posted only to itself and
  to `https://github.com` (github-app's Connect posts its manifest there). Vite's build, its fonts and
  styles work under it.
- **Every deploy builds it.** On Cloudflare, deployment-cloudflare's `wrangler.jsonc` has a
  `build.command` that, in a project with `src/dashboard/`, runs `bun install --frozen-lockfile` and
  `bun run build` there before wrangler bundles: `pikit up`, `pikit dev`, a `wrangler deploy` by hand
  and Workers Builds from Git all ship the dashboard as its source is, and a build that fails stops the
  deploy. On a server, deployment-docker's image builds it in a stage of its own.
- **In git** the module is committed (a clone runs and type-checks as it is), and `pikit new` writes
  a `.gitattributes` that marks it generated (`linguist-generated=true -diff`): GitHub collapses it,
  and `git diff` says only that it changed.

## Config

```ts
"admin-api": {
  heartbeatMs: 15_000, // a comment on an idle event stream this often
  titleModel: "anthropic/claude-haiku-4-5", // optional: the model that titles conversations; absent, each one's agent's
}
// On Cloudflare, the Worker's half takes the same under workerConfig's "admin-api-worker".
```

## Guarantees

- Every API answer is an operator's (`admin.auth`); nothing is read, and no object called, before it
  says yes.
- It reads contracts only (`APP_DESCRIPTION`, `agent.definition`, `agent.observe`, `conversations.registry`,
  `agent.command`) and acts only through the contracts that own each action (`agent.runtime`'s
  `dispatch` and `abort`, `conversations.registry`'s `resolve` and `reset`, a command's `run`,
  `model.complete` for a title), on Cloudflare inside the conversation's own object.
- What the operator says never reaches another channel's chat; the agent reads that it is the
  operator's.
- No config value that looks like a secret leaves it (`redactSecrets`), on either host.
- Each action is logged with the operator's id and the conversation's key, never the message's text.
- Live events end when the client goes away or the server stops (on Cloudflare also after their
  polls): nothing keeps watching.

## Tests

- `admin-api.test.ts`, with a double for every contract (`runtime.test-support.ts`), routes picked the
  way a server picks them: what setup declares; `401` on every API route before anything is read;
  sessions; each route's answer and its `400` / `404` / `409`; the list from the index (filled at
  start, moved by activity, paged through thousands); the dashboard's own conversations and the
  operator's follow-ups (marked, never steer); the agents; images (reaching the request, their number,
  types and sizes checked: `400`, `413`) and web search (asked in the first line, only of an agent with
  the tool); ids with `.` and `/`; redacted config; server-sent events; messages logged without their
  text; the commands (listed, run as actions, `404` / `409` / `422`, a project's own, logged by name)
  and admin-api's own through the `agent.command` suite; titles (made in the background after the first
  run, once, retried once, `titleModel`, `/name` first).
- `remote.test.ts`: the Worker's half over a fake platform whose every key is an App running the
  default export on `durable`: ids, the list from the index (order, pages, an object that does not
  answer), the index told at an object's start and on dispatch (once per conversation), a dashboard
  conversation in its own object, reads, actions and their refusals across the call, the agents, images
  and web search across the call (over 1 MB `413` before any call), a transcript page answered shorter
  until it fits, the polled snapshot, `401` before any call; commands listed from the index object and
  run in the conversation's, the title in the list.
- `conversation-index.test.ts`: the index on SQLite (an upsert a late `seen` does not move back, one
  row per conversation, order, pages, cursors; titles: one model's try and one more, the operator's
  first). `assets.test.ts`: the files served from the module,
  pages for any other path, the CSP.
- The kit's workerd lane runs both halves in real Durable Objects (`tests/workerd/test/admin-api.workerd.ts`),
  a message with 1 MB of images stored and answered there among them, and the commands and a title
  made in a real object. The sample (`samples/http/test/admin.test.ts`) titles a chat on the real
  runtime and runs `/compact` and `/name` there.
