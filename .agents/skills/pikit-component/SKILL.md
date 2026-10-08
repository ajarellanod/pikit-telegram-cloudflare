---
name: pikit-component
description: Write a pikit component (a channel, a tool, a store, a router stage, a model provider, an admin route, a deployment, or a feature's own new kind) for a pikit project or registry. Use when the user asks to add behaviour to their pikit assistant, build a feature from a design note in features/, or make a component that others can `pikit add`.
---

# Write a pikit component

pikit is a kit for Pi: the kernel (`@pikit/core`) composes components, the contracts
(`@pikit/contracts`) are the words they share, and Pi (through `@pikit/pi-adapter`, the only door to
Pi) runs the agents. Everything else is a component: source copied into the project, which the user
owns. A component that follows the steps below composes, survives crashes and evictions, and can be
shared. Agent behaviour (prompt sections, hooks on requests and tool calls) is a component too, of a
special shape: read `.agents/skills/pikit-extension/SKILL.md` for it.

**Where the kit is.** `https://github.com/ajarellanod/pikit/tree/ff9bbe2c8d5fb46fc5152f22279e0fc77af21256` is the pikit repository (the kit) this project was made with,
on this machine; online, https://github.com/ajarellanod/pikit/tree/ff9bbe2c8d5fb46fc5152f22279e0fc77af21256. Its design notes are in `features/`, its decisions (the
K, C and P names READMEs cite) in `SPEC.md`, its components in `registry/components/`. (`pikit new`
writes both when it copies this skill into a project; in the pikit repository itself, they are its
root.)

## 0. Know the project before you write

```sh
pikit doctor                    # the components in start order, who provides what, what is missing
pikit registry capabilities     # every capability: what it is for, its stability, who provides it
```

Read `pikit.config.ts` (everything that runs is listed there) and `pikit.json` (what was installed,
and the target: `server` is a long-lived process, `durable` an actor per conversation on Cloudflare).
Installed components are in `src/pikit/<name>/`, each with a README and its tests; the project's own
are in `src/extensions/`. If the feature has a design note (`https://github.com/ajarellanod/pikit/tree/ff9bbe2c8d5fb46fc5152f22279e0fc77af21256/features/<feature>.md`),
read it first: it names the contract, what must be guaranteed and the tests that prove it
(`https://github.com/ajarellanod/pikit/tree/ff9bbe2c8d5fb46fc5152f22279e0fc77af21256/features/memory.md` is a complete build guide).

## 1. Pick the contract

A component **provides** capabilities and **uses** others. Find the one your behaviour fits:

| You want | Capability, and what to call |
|---|---|
| A chat platform | a channel: `admitInbound` for each message, `startAnswerDelivery` for the answers (both `@pikit/contracts`) |
| Something the model calls | `agent.tool` (`defineTool` from `@pikit/pi-adapter/tools`) |
| A slash command the operator runs (`/deploy staging` in the dashboard's "/") | `agent.command` under its name (below: "A slash command") |
| A text from one of the App's models, once (a title, a label) | `model.complete` (runtime-pi's): `complete({ model, system?, prompt, maxTokens? }, ctx)` |
| Text in every request, a check on tool calls, per-conversation state | `agent.extension` (skill `pikit-extension`) |
| Durable data | `storage.sql` (tables prefixed with your name) or `storage.kv` (a namespace named after you) |
| Routing a message to an agent | a stage of the `route.resolve` pipeline |
| An HTTP endpoint | `http.route` (`"POST /v1/x"`, `"GET /items/:id"`, a prefix `"GET /admin/*"`) |
| An operator-only route | ask `admin.auth`; read the runtime with `agent.observe`; the composition is `APP_DESCRIPTION`, which only a component named `admin-*` may read (SPEC K13, checked by `registry validate`) |
| Reach another conversation or an actor of yours | `actor.mailbox`: `send` (a message, held durably) or `call` (ask for an answer), handled with `actor.inbox`'s `handle` / `answer` |
| Run later, at least once | `wakeups` (`handle(name, handler)` in `start`, `at(name, time)`) |
| Deliver to a platform, retried | `outbound.queue` (through `startAnswerDelivery` for a channel) |
| Talk to a busy conversation | `agent.runtime`'s `dispatch` with `whenBusy: "steer"` (into the run's current round) |
| Models from another provider | `model.provider` under the provider's id (below: "A model provider") |
| Say that it broke after `start` (a stuck poller) | `useOptional("health")`: `reporter(name)`'s `up` / `degraded` / `down` |

Pi's own shapes are in `@pikit/pi-adapter`: `execution`, `workspace`, `model.provider`,
`model.credentials`, `agent.extension`.

**If no contract fits, it is yours; no CLI or kit change.** Its type lives in your component, in a
`contract.ts` that adds it by declaration merging:

```ts
declare module "@pikit/core" {
  interface AppCapabilities { memory: MemoryStore }        // AppKeyedCapabilities for one per key
}
```

A component of another name that uses it carries an identical copy of `contract.ts` (a component never
imports another's files; `tsc` refuses two copies that differ, TS2717). Declare the capability, and a
new kind when your feature is one, in the defining component's `component.json`:

```json
"declares": {
  "kinds": ["memory"],
  "capabilities": { "memory": { "mode": "single", "stability": "experimental", "summary": "What the agent remembers of each person." } }
}
```

Write its conformance suite next to it (a function returning `ConformanceCase[]`, as the kit's
`create…Conformance` do). Redeclaring a kit kind or capability is refused. Never a private coupling
between two components: what one needs from another is a capability.

**How big.** One component per thing whose removal takes away something an agent's `tools` or `model`
list does not already control: an import, a dependency, a secret, a config block, a table or timer, a
target, or a risk class (replay safe or unsafe, a shell, the network). Two tools of different risk are
two components; one per model provider. Build on another's capability, never copy it; a bundle is a
preset (`https://github.com/ajarellanod/pikit/tree/ff9bbe2c8d5fb46fc5152f22279e0fc77af21256/features/building-components.md`, "How big a component is").

## 2. Copy the reference of its kind

| Kind | Reference | What it teaches |
|---|---|---|
| Tool | `tool-fetch` | `defineTool` from `@pikit/pi-adapter/tools`, `replay`, limits, tests from `execute` to a Harness turn |
| Tool with a secret | `tool-websearch-brave` | a key through `secrets` at each call, `configure.ts`, `environment` in `component.json` |
| Agent extension | `extension-house-rules` | a section from config, a `beforeTool` hook, `agent.extension`, tests through runtime-pi |
| Channel | `channel-telegram` (server), `channel-telegram-webhook` (Cloudflare, two halves), `channel-http` | `admitInbound`, `startAnswerDelivery`, the channel suite |
| Pipeline stage | `router-basic`, `router-rules` | `pikit.pipeline("route.resolve", …)`, refusing to start on bad config |
| Store | `storage-sqlite`, `storage-kv-sql`, `conversations-kv` | providing a storage contract; state in `storage.kv` with `setIfAbsent` |
| Actor messages and calls | `mailbox-local` (what `send` / `call` promise) | `actor.inbox`'s `handle` and `answer` in `start` |
| Admin route / auth | `admin-auth-token` | `admin.auth`, a secret read at start, constant-time compare |
| Model provider | `provider-openrouter`, `provider-openai-compatible`, `provider-faux` | a pi-ai provider as `model.provider` by its id, `modelProviders`, the key's variable first in `environment` |
| Deployment | `deployment-docker` | `up`, `down`, `status`, `logs`; a stop deadline (K2) |
| A feature of your own kind | `https://github.com/ajarellanod/pikit/tree/ff9bbe2c8d5fb46fc5152f22279e0fc77af21256/features/memory.md` | `declares`, a contract file, an actor per owner with `call` |

Installed ones are in `src/pikit/`, each with its README; the rest are in the registry the CLI uses
(`pikit add <name> --yes` to read one in place, `pikit remove <name>` after).

**A model provider** is about ten lines. Every provider pi-ai ships is a subpath of the adapter,
`@pikit/pi-adapter/providers/<id>` (`groq`, `mistral`, `google`, `openai`, `xai`, `deepseek`…; one
per id, no barrel, so the app carries only yours):

```ts
import { defineComponent } from "@pikit/core";
import { groqProvider } from "@pikit/pi-adapter/providers/groq";

export default defineComponent({
  name: "provider-groq",
  setup(pikit) {
    const provider = groqProvider();
    pikit.provideKeyed("model.provider", provider.id, provider); // agents name groq/<model>
  },
});
```

Its `component.json` declares the key's variable first in `environment` (`{ "name": "GROQ_API_KEY",
"secret": true, "required": false }`: `pikit configure` offers to set that one; pi-ai's README lists
each provider's), and `targets` `["server", "durable"]` unless the subpath is in the CLI's
`SERVER_ONLY_EXPORTS` (Bedrock, Vertex: `registry validate` refuses `durable` then). runtime-pi reads
the variable through `secrets` first, then the environment. An endpoint pi-ai does not know is
`createProvider` with `envApiKeyAuth` (`@pikit/pi-adapter/provider`) and an API from
`@pikit/pi-adapter/api/<name>` (`openAICompletionsApi` from `api/openai-completions`): copy
`provider-openai-compatible`, or install it and configure it. Never `@earendil-works/*` directly.

**A slash command** is registered as Pi's `registerCommand` registers one: under its name (Pi's
rule: lowercase letters, digits, `-`, `:`), with a one-line description, the hint of its arguments,
and what it does in the conversation it runs in. The dashboard lists every `agent.command` in its "/"
(admin-api's `GET /admin/api/commands`) and runs one there; what `run` returns is a quiet note for the
operator, which no channel gets. It runs in the App that holds the conversation (on Cloudflare, its
Durable Object) and acts only through contracts. Throw an `Error` to refuse, its message for the
operator. Prove it with `createAgentCommandConformance` (`@pikit/contracts/testing`).

```ts
pikit.provideKeyed("agent.command", "deploy", {
  description: "Deploy the current branch",
  argumentHint: "<environment>",
  async run(conversation, args, ctx) {
    if (args === "") throw new Error("Name the environment: /deploy <environment>");
    await deploys.get().start(args, conversation.key, ctx);   // a contract you use
    return { text: `Deploying to ${args}.` };
  },
});
```

The kit's own: `/new` and `/name` (admin-api), `/compact` (runtime-pi).

A component is a folder:

```
component.json                         name, description, targets, requires, optional, provides,
                                       declares, dependencies, devDependencies, files, environment
                                       (provides / requires.capabilities / optional are generated
                                       from setup, capabilities in the order setup calls use())
README.md                              what it does, what it needs, its guarantees, how it is tested;
                                       installed as src/pikit/<name>/README.md
files/src/pikit/<name>/index.ts        export default defineComponent({ name, config?, setup })
files/src/pikit/<name>/<name>.test.ts  its tests, copied with it into the project
```

A component only the project needs can be a single file in `src/extensions/` listed in
`pikit.config.ts`, like `src/extensions/agents.ts`; make it a registry component when it should be
shared, upgraded or removed with `pikit remove`, or when it declares a kind or capability.

## 3. Write it by the rules

- **`setup` is synchronous and only registers**: `provide`, `provideKeyed`, `use`, `useOptional`,
  `useKeyed`, `on`, `pipeline`. Call `handle.get()` in `start` or later, never in `setup`.
- **Resources in `start`, released in `stop`**, both honouring `ctx.abortSignal`. Never keep
  `start`'s context for later work as it is: `ctx.derive(() => BACKGROUND_CONTEXT)` drops its
  deadline; per call, `app.derive(() => callContext)` puts a call's context under it.
- **Config holds values, never secrets or strategies**: a TypeBox schema with defaults, checked when
  the App is defined. A secret is read through `secrets` (`secrets.get().get("NAME")`) and declared in
  `component.json`'s `environment`. Two strategies are two components, not a config switch.
- **Imports**: `@pikit/core`, `@pikit/contracts`, `@pikit/pi-adapter` (never `@earendil-works/*`),
  `typebox`, and npm packages the component declares: what its shipped files import in
  `dependencies` (with a `requires.contracts` / `requires.adapter` range for those kit packages),
  what only its tests import in `devDependencies` (`@pikit/pi-adapter` for
  `@pikit/pi-adapter/testing`, with no range). A component for both targets imports no
  `node:*`, `bun:*` or `cloudflare:*` outside its tests; one that does says `"targets": ["server"]`.
  Never another component's files.
- **What crosses an actor is JSON** (`send`, `call`): use `type` aliases, not interfaces, for it, and
  check it on arrival.
- **Decisions are in the component's source**: a tool's `replay`, a policy, a default. Pi's own
  tools come as Pi ships them (`createReadTool()` from `@pikit/pi-adapter/tools`, no replay): spread
  one and set `replay` in your `setup`, as `tool-read` does.
- **A tool that works on `api.env`** (Pi's coding tools, or one of yours) `use`s `execution`
  (`execution.shell` when it needs a shell); `registry validate` refuses one that declares neither.
  The runtime gives each call its environment: never bind one to the tool.
- **Fail loudly**: a component that cannot work refuses to start, with a message naming the
  component and what to fix, never a secret's value.
- **No magic**: nothing happens on import; everything is in `setup`.

## 4. Durability comes with the contracts

Never hold what must survive in memory, and never rely on `stop()`: a `kill -9` or an eviction skips
it (K6). Instead:
- keep state in `storage.sql` (tables prefixed with the component's name, created in `start`) or
  `storage.kv` (a namespace named after the component);
- state that belongs to someone across conversations (a person, a team) lives with one owner: an
  actor key of yours (`memory:<person>`), reached with `actor.mailbox`'s `call`, whose `answer`
  handler reads and writes that actor's storage. On a server every key is the App itself; on
  Cloudflare each key is its own Durable Object, so writes for one owner are ordered;
- `send` is at-least-once and `call` is neither retried nor deduplicated: make handlers idempotent
  (by an id in the message);
- wake later with `wakeups`, at least once, maybe late: make the handler idempotent;
- read what must not be missed from a feed with a stored cursor (`agent.submissions`' `answers`),
  never from events alone (events may be missed, K3). A channel gets all of this from
  `startAnswerDelivery`: a cursor in its `storage.kv`, one lane per conversation, retries, idempotency
  keys, both runtime models;
- deliver through `outbound.queue`, which stores before it sends and retries;
- a tool with an effect is `replay: "unsafe"`, or idempotent by `${api.conversationId}:${api.callId}`
  and then `"safe"`.

## 5. Prove it with its suite

Run the contract's conformance suite in the component's test:

```ts
for (const c of createChannelConformance(() => myFixture())) test(`${c.group}: ${c.name}`, () => c.run());
```

From `@pikit/contracts/testing`: `createChannelConformance`, `createHttpRouteConformance`,
`createSqlDatabaseConformance`, `createKeyValueConformance`, `createConversationRegistryConformance`,
`createAdminAuthConformance`, `createAgentObserveConformance`, `createWakeupsConformance`,
`createMailboxConformance`, `createSecretStoreConformance`, `createOutboundQueueConformance`,
`createFeedConformance`, `createHealthConformance`; doubles: `createMemoryMailbox()`, `createMemoryKeyValueStorage()`,
`createMemoryWakeups()`, `createMemorySubmissions()`. `createLifecycleConformance` from
`@pikit/core/testing` when it owns resources. A channel's suite includes the durability cases it must
pass: an answer that ends while the channel is stopped, or whose event was lost, reaches its sender
once after a restart; a failed send is retried and holds up its conversation's later answers; a send
cut after it left goes again at most once, marked or under the same key; one conversation's failures
hold up no other.

Also a test named "what setup declares" that pins `app.describe().components` for it. No network in
tests: a local `Bun.serve` stands in for any API; `sqliteStorage(path)` (`@pikit/pi-adapter/testing`)
is a `storage.sql` on a file. A test that needs another component (runtime-pi) is the project's own
(`test/*.test.ts`, importing `src/pikit/*`), never the component's. A `durable` component also runs in
the workerd lane of the pikit repository (`https://github.com/ajarellanod/pikit/tree/ff9bbe2c8d5fb46fc5152f22279e0fc77af21256/tests/workerd`).

**The model** for a tool or an extension end to end (a project test, or a trial in `pikit dev`) is
provider-faux's `faux/scripted` (`pikit add provider-faux --yes`, an agent on `model: "faux/scripted"`):

| The message | The model |
|---|---|
| `call: <tool> <json>` | calls the tool; the turn after answers `<tool>: <result>` or `<tool> failed: <error>` |
| `echo-system` / `echo-system <section>` | answers the system prompt it got / that section, or `(no section <section>)` |
| `echo-tools` | answers the tools it was offered, sorted, or `(no tools)` |
| anything else | `faux: <the message>` (as `faux/echo`) |

A run's answer is its `agent.settled` event's `text`. A test that must see the requests themselves
(how many system messages carried a section) uses `scriptedProvider({ onRequest })` from
`@pikit/pi-adapter/testing` instead, provided as `model.provider` under `faux` (the same `call:` rule;
it answers `answer: <message>`).

## 6. Check it composes

In the pikit repository, `bun run registry generate` and `bun run registry validate`. In a project,
your registry is a folder, `registry/components/<name>/` (a project made by `pikit new` leaves
`registry/` out of `tsc` and `bun test`: the installed copy in `src/pikit/` is the one checked).
`pikit add` and `pikit upgrade` ask before they write: without a terminal, pass `--yes`.

```sh
pikit registry generate registry      # provides / requires / optional of component.json, from setup
pikit registry validate registry      # manifest, files, imports per target and per file kind, kinds and capabilities
pikit add <name> --registry registry --yes  # copies it and its README, lists it in pikit.config.ts, installs npm deps
pikit upgrade <name> --yes            # after each edit in registry/: takes the new version
pikit doctor                          # green: everything provided and configured
bun test && bun run typecheck
pikit dev                             # and try it
```

`pikit add` offers providers only from the registry it installs from: add the kit's (`pikit add
mailbox-local --yes`) yourself when doctor says one is missing. `pikit remove <name>` refuses while an
agent names a key only it provides (a tool, an extension): take the name out of the agent first, or
pass `--force` and doctor reports the agent until you do.

Done means: its suite and tests pass, `registry validate` is clean, `pikit add` then `pikit doctor`
is green, `pikit remove <name>` leaves the project as it was, and its README says what it provides,
needs, guarantees and how it is tested.
