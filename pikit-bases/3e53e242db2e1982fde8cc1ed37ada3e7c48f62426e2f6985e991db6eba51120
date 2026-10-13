# settings-store

The values an operator changes live, from the dashboard's Settings dialog: the agent's system prompt,
model and tools, which agent answers by default, a channel's options ([features/settings.md](https://github.com/ajarellanod/pikit/blob/main/features/settings.md)). Each
component declares its own; a change applies to the next run, with no deploy and no restart.

- **Provides:** `settings` (`@pikit/contracts`' `settings.ts`: a component declares and reads), and
  `http.route`: the routes below, one set for every component's section, its operator surface.
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
a secret: secrets stay in `secrets`, and a setting's value is shown to every operator. A setting may
name one (`tokenSecret: "GITHUB_TOKEN"`), and settings-store holds every component to it with the
contract's two checks:

- `declare` throws for a schema whose string under a secret's key (`apiKey`, `token`, `password`,
  `secret`, `authorization`...) is free: give it `pattern: SECRET_NAME_PATTERN` (from
  `@pikit/contracts`), so it holds a secret's name. It throws too for defaults holding a credential.
- A change holding a known credential's shape (`sk-...`, `ghp_...`, a bot token, a JWT, a private
  key, a URL with a password), whole or as a word of a text, is refused: `400 invalid_value` naming
  where (`/prompt`), never the value, and stores nothing. Prose with a long hash or id is not refused.

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
- An operator changes a value through the routes below, never through `settings`: the contract has
  `declare` and `get` only.
- The schema's `title`, `description` and `default` keywords are what the dashboard shows; `defaults`
  is what applies.
- `get` rejects when the values cannot be read at all (on Cloudflare, an object that never reached the
  settings object): keep what you read last, or your config.

## The routes

settings-store's own operator surface, over its `SettingsStore` (`settings.ts`: `set` and `sections`),
not the `settings` contract's. Every route asks `admin.auth` first: without an operator, `401`. An
error is `{ error, message? }`.

- **A `PUT` stores** the component's whole value, once its merge over the defaults is valid
  (`invalid_value` otherwise, an `InvalidSettingsError`, which stores nothing; its message says where
  the value is wrong, never the value), logged with the operator, the component and the keys, never
  the values.

| Route | Answer |
|---|---|
| `GET /admin/api/settings` | `{ items: [{ component, schema, defaults, value }] }`, by component name |
| `GET /admin/api/settings/:component` | its section (`404 unknown_component`) |
| `PUT /admin/api/settings/:component` | body: its whole value → its section with the value `get` now gives (`400 invalid_value`, `400 invalid_request`, `404 unknown_component`, `413 too_large` past 256 KiB) |

A store that cannot be reached is `503 unavailable`, logged.

## On each target

The component never reads the target: in its start, `actor.inbox`'s `scope` says whether this App is
every key's actor (`"all"`, a server; or no `actor.inbox`) or one key's (`"one"`, a Durable Object).

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
over a double of the platform's calls), its fixture's operator storing values through the `PUT` route:
defaults until a change, a change stored whole and read back, unknown components, a value per
component, copies, a value outliving a restart, a key a later schema refuses taking its default
(logged), and a change read by another App. Its own tests cover its operator side on both targets
(the value a change answers, a refused value storing nothing, unknown components, sections, the log
without values, components seeing `declare` and `get` only), the routes (`401`, the statuses), the
Worker's routes as calls to the settings object, and what an object's cache spends in calls.

## Replace it

Another provider (settings in a KV namespace, with a history to undo) is another component that
provides `settings` and passes the same suite (its fixture's operator going through its own surface),
and serves the same routes for the dashboard. Components do not change.
