# settings-store

The values an operator changes live, from the dashboard's Settings dialog: the agent's system prompt,
model and tools, which agent answers by default, a channel's options (features/settings.md). Each
component declares its own; a change applies to the next run, with no deploy and no restart.

- **Provides:** `settings` (`@pikit/contracts`' `settings.ts`), and `http.route`: the routes below,
  one set for every component's section.
- **Requires:** `storage.sql` (where the values are kept). **Uses, if installed:** `admin.auth`
  (without it, its routes answer nobody). On Cloudflare, also `actor.inbox` and `actor.mailbox`
  (platform-cloudflare).
- **Targets:** `server` and `durable` (Cloudflare): below, how it works on each.
- **Installs to:** `src/pikit/settings-store/`.
- **npm dependencies:** `typebox`.

Without it nothing changes: a component uses `settings` through `useOptional`, and keeps to its config.
`pikit ui on` (and `pikit new --ui`) installs it with the dashboard.

## Config or setting, never both

Config (`pikit.config.ts`) is what is deployed: it changes through a commit. A setting is what an
operator changes live, read when used. A component says which of its values are settings by declaring
them; a setting's default may come from its config (router-basic's `defaultAgent`). A setting is never
a secret: secrets stay in `secrets`, and a setting's value is shown to every operator.

## Declare and read

```ts
const settings = pikit.useOptional("settings");
// in start: setup only registers, and a handle is read from start on.
settings.get()?.declare(
  "my-component",
  Type.Object({ tone: Type.Union([Type.Literal("brief"), Type.Literal("thorough")], { title: "Tone", description: "How long the answers are." }) }),
  { tone: config.tone },
);
// when used (an admission, a run):
const { tone } = await settings.get()!.get<{ tone: string }>("my-component", ctx);
```

- **What `get` gives** is the defaults with each key the operator stored over them, while the schema
  accepts it: a key a deploy made invalid takes its default, logged, and the rest still applies.
- **What `set` stores** is the component's whole value, once its merge over the defaults is valid
  (`invalid_value` otherwise), logged with the operator, the component and the keys, never the values.
- The schema's `title`, `description` and `default` keywords are what the dashboard shows; `defaults`
  is what applies.
- `get` rejects when the values cannot be read at all (on Cloudflare, an object that never reached the
  settings object): keep what you read last, or your config.

## The routes

Every route asks `admin.auth` first: without an operator, `401`. An error is `{ error, message? }`.

| Route | Answer |
|---|---|
| `GET /admin/api/settings` | `{ items: [{ component, schema, defaults, value }] }`, by component name |
| `GET /admin/api/settings/:component` | its section (`404 unknown_component`) |
| `PUT /admin/api/settings/:component` | body: its whole value → its section with the value `get` now gives (`400 invalid_value`, `400 invalid_request`, `404 unknown_component`, `413 too_large` past 256 KiB) |

A store that cannot be reached is `503 unavailable`, logged.

## On each target

- **Server:** a table of the App's `storage.sql`, `settings_store`: one row per component (its value as
  set, as JSON; who and when; a version). Every `get` is one query.
- **Cloudflare:** the values are one object's, `settings-store:settings` (`SETTINGS_KEY`), of the
  conversations' class and never a conversation, as admin-api's index is. The Worker's half
  (`export const worker`, `settings-store-worker`) serves the routes as calls to it; it validates
  against its App's declarations (every object runs the same App), stores and logs. The Worker's half
  also provides `settings` to the Worker's App, read as an object reads it, for a component whose
  routes the Worker serves (admin-proposals declares its repository there too). A conversation's
  object reads it when used, keeping the values with their version: a `get` within `freshMs` of the
  last call is answered from them, and past it the call says whether the version changed (the values
  cross only when it did). One call per admission at most. When the call fails, the values read last
  apply (logged).

## Config

```ts
"settings-store": {
  freshMs: 1000, // default; Cloudflare only: how long an object answers from the values it read last
}
```

## Guarantees

Its tests run `createSettingsConformance` (`@pikit/contracts/testing`) on both targets (on Cloudflare
over a double of the platform's calls): defaults until a set, a set stored whole and read back, a
refused value storing nothing, unknown components, a value per component, sections, copies, the log
without values, a value outliving a restart, a key a later schema refuses taking its default, and a
change read by another App. Its own tests cover the routes (`401`, the statuses), the Worker's routes
as calls to the settings object, and what an object's cache spends in calls.

## Replace it

Another provider (settings in a KV namespace, with a history to undo) is another component that
provides `settings` and passes the same suite, and serves the same routes. Components and the dashboard
do not change.
