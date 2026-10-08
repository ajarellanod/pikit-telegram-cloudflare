# runtime-pi

The agent runtime: Pi runs your agents (`@earendil-works/pi-durable` 1.0), and this component plugs
it into the app.

- **Provides:** `agent.runtime`, `agent.conversations` (where `conversations.registry` creates the
  conversation of a new key, or of a reset), and `agent.submissions` (what became of each message,
  and the `answers` feed channels deliver from: "Nothing admitted goes unanswered" below), and
  `agent.observe` (what an operator sees, read-only from pi-durable's records: conversations, a
  transcript, live events, usage; `createObserver` in the adapter's `observe.ts`). Also
  `model.complete` (a text from one of the models the agents run on, once: admin-api titles
  conversations with it) and one slash command, `agent.command` `compact` ("/compact" below).
- **Requires:** `storage.sql`: pi-durable keeps every conversation there (its transcript, its state,
  its runs and the messages it holds). On a server that is `storage-sqlite`, in a Cloudflare object
  `storage-do`. Its tables are pi-durable's (`conversations`, `entries`, `tasks`, `submissions`,
  `documents`…), unprefixed: one runtime per database; and the answers log, `runtime_pi_answers`.
- **Uses:**
  - `agent.definition`: the agents, one per name;
  - `model.provider`: the providers the agents name as `provider/modelId`;
  - `agent.tool`: the installed tools (`tool-read`, `tool-bash`…) the agents name in `tools`;
  - `agent.extension`: the installed agent extensions the agents name in `extensions` ("Agent
    extensions" below);
  - `execution` and `workspace`, if installed: where tools work. Each tool call gets its
    conversation's workspace when a `workspace` provider is installed (`workspace-local`: a directory
    per agent), otherwise `execution`;
  - `model.credentials`, if installed: where the providers' credentials live (API keys, OAuth tokens).
    pi-ai refreshes OAuth tokens and writes them back there. Without it, providers read only their
    environment variables (`ANTHROPIC_API_KEY`);
  - `secrets`, if installed: where those variables are read first, then the environment. On
    Cloudflare, `secrets-cloudflare` reads them from the Worker's secrets, with no `process.env`;
  - `wakeups`, if installed: runs are driven inside wakeups, in slices, instead of by promises left
    running, which is what a Durable Object needs ("Cloudflare" below). Without it, nothing changes;
  - `settings`, if installed (`settings-store`): the agents' live overrides, an operator's system
    prompt, model and tools per agent, set from the dashboard ("Live overrides" below). Without it,
    every agent is its definition;
  - `agent.directory`, if installed (`agents-live`): agents that are data, an operator's, for a name
    no `agent.definition` has ("Live agents" below).

  It refuses to start without an agent, with two stewards (`steward: true`: a project has one, SPEC
  §6), when an agent names a model no provider has, when an agent
  names a tool or an extension no component provides (`pikit doctor` names the registry component that
  provides a missing tool), when an agent names `read`, `write`, `edit` or `bash` and neither
  `execution` nor `workspace` is installed (the tools that work on files and commands:
  `ENVIRONMENT_TOOLS` in `index.ts`), and when an agent's provider has no credentials at all. That
  last check makes no network call and refreshes nothing: it only asks whether a credential is stored
  or an environment variable set.
- **Target:** `server` and `durable`. On Cloudflare it goes in the conversation object's App, with
  `platform-cloudflare` for `wakeups` ("Cloudflare" below).
- **Installs to:** `src/pikit/runtime-pi/`.
- **npm dependencies:** `@pikit/pi-adapter`, pinned with Pi.

## What it does

A message goes in with `dispatch`. Once the message is durable in pi-durable, `dispatch` resolves
with its admission:
- `started`: the conversation was idle and a run began;
- `queued`: a run is going. The message waits in the conversation's inbox, and every message queued
  while that run goes is taken together by the **next run**, which starts once the run in progress
  ends: its `agent.started` names the first of them, and its one answer (`agent.settled`) lists them
  all in `requestIds`, so a channel that replies per message replies to each. A **steer**
  (`dispatch({ ..., whenBusy: "steer" })`, a person correcting course, or the dashboard) joins the run
  in progress instead, after its current tool round, and that run's answer lists it in `requestIds`;
  if the run answers before another tool round, the steer gets the next run. A steer to an idle
  conversation starts a run, as any message does;
- `duplicate`: the conversation already has this request (pi-durable deduplicates by request id, for
  as long as it keeps the conversation). Nothing runs.

`abort()` stops the active run. Any message queued behind it is withdrawn and stays a duplicate.

Each agent names its model as `provider/modelId`, so different agents can use different providers.
Install one `model.provider` component per provider.

pi-durable runs every conversation of the storage in one scheduler, opened at the first message (or
at start, with `wakeups`). Stopping the app leaves unfinished runs pending in the storage, and the
next process resumes them.

A conversation key points to a pi-durable conversation id (`ConversationRef.conversationId`).

## Nothing admitted goes unanswered

pi-durable keeps every message it admitted and how it ended; `agent.submissions` reads them
(`@pikit/pi-adapter`'s README, "Submissions"):
- `dispatch` resolves once pi-durable holds the message, so a channel tells its platform "received"
  only then; `get` says where one message is (HTTP's `GET`), `pending` which conversations hold
  messages a run has not ended yet;
- every run's end is appended to the `answers` log, once, before its `agent.settled` /
  `agent.failed`; a message `abort()` withdrew is logged aborted, unannounced. Channels deliver from
  that feed with a cursor of their own, so an answer that ends while they are stopped (a deploy) is
  delivered when they start again. A run's end stays in the log `keepSettledDays`; `get` then reads it
  from pi-durable:

```json
"runtime-pi": { "keepSettledDays": 7, "abandonPendingAfterHours": 72 }
```

- a run that ended while its log was never written (a crash between the two) is logged and announced
  by the next reconciliation of its conversation: at start, when one of its messages is delivered
  again, or when the conversation is resumed. A batch answered together is logged as one run, never
  split;
- **at start**, opening pi-durable resumes every run the last process left open and gives a run to
  every message waiting in an inbox, all at once (nothing bounds how many run together). Then, in the
  background, each conversation holding a message nobody answered is recovered (`recover`, four calls
  in flight, `RESUME_AT_ONCE` in `resume.ts`): an unlogged run's end is logged and announced, a
  conversation whose agent is gone or that is missing has its messages abandoned, and the call waits
  until its messages are settled. Start does not wait for them; stop cancels what has not started.
  Progress and failures are logged. With `wakeups`, start asks for a wakeup instead, and its
  handler resumes them ("Cloudflare" below).
- a message nothing can answer is **abandoned**: settled unanswered in pi-durable (reason
  `abandoned`), logged and announced as `agent.failed` (code `abandoned`), so its channel asks the
  user to send it again, instead of being retried at every start. At once when the conversation's
  agent is no longer defined (`agent_removed`); and when resuming its conversation fails and its
  oldest pending message is older than `abandonPendingAfterHours`. Only messages still queued are
  abandoned: a run that took one settles it.

## Cloudflare: runs driven by wakeups, in slices

A Durable Object keeps running only while an event is in progress (a request, an RPC, an alarm). A
promise left running after its event is killed when the object is evicted, 70 to 140 s after it went
idle, and waiting on an outbound `fetch` (a model call) does not keep it alive: measured, a 180 s run
was lost. So on Cloudflare (SPEC §4.1, C4) a run is driven inside an event: install a `wakeups`
provider (`platform-cloudflare`: the object's alarm, multiplexed), and runtime-pi does the rest.

In an object's App (`WORKERS_HOST` has an `object`), the object is one chat: its first conversation is
pi-durable's root (later ones, after a reset, are ownerless), and pi-durable's clock is the app's
(workerd freezes `Date.now()` between I/O).

pikit's workerd lane runs it so in a real Durable Object (`tests/workerd/test/runtime-pi.workerd.ts`):
pi-durable on `storage-do`, a message sent from the Worker's App by RPC, its run driven in the
object's alarm until it answers; a run the object is evicted in the middle of, answered by the next
instance; a model error's backoff waited out with the object gone.

It registers the wakeup handler `runtime-pi.drive`, and asks for it whenever a run may be left going:
after a `dispatch` or a `resume` that leaves a run in the conversation (before `dispatch` resolves,
so a channel acknowledges its platform only once a wakeup will drive it), and at start when pi-durable
has work pending. The handler:
1. opens pi-durable if this instance has not (a new instance after an eviction): what it finds resumes,
   and a run's end an eviction left unlogged is logged;
2. resumes the conversations holding pending messages that this App is not driving (a message it
   never answered: as at start, through `recover`, abandoned after `abandonPendingAfterHours`);
3. waits until this App drives no run, or until its slice ends;
4. asks again at once when runs are still going. When what is left only waits for a time (a model
   retry's backoff, a deferred response's poll), the runtime asked for a wakeup at that time
   (`onIdleWithPendingWork` and `nextWakeAtOf` in `@pikit/pi-adapter`), and the handler closes
   pi-durable inside its event (`suspend`) so the object can be evicted until then; the wakeup opens
   it again and the wait continues from its checkpoint.

A request carries nothing: the handler reads what to do from pi-durable each time. So a handler that runs twice (delivery is at least once), late, or in a new object after an
eviction does the right thing. An object evicted mid-run is started again by its alarm, and the run
resumes from the storage under pi-durable's replay rules (a `safe` tool's interrupted call runs again;
an `unsafe` one's gives the model an interrupted result).

**How slices meet the budgets.** Each alarm is an invocation with its own budget, measured on the Free
plan: 30 s of CPU (waiting on the network does not count), 50 subrequests, 15 minutes of wall clock,
about 200 MB of memory. The slice deadline is the provider's (60 to 90 s on Cloudflare): a slice mostly
waits on the model, so its CPU stays far under 30 s; a few model and tool calls fit in 50
subrequests; and it ends long before 15 minutes. A long run is a sequence of short alarms, each with a
fresh budget. An alarm the platform cuts (a deploy) is retried, and the cut slice asked for the next
one already or runs again: either way the run continues from the storage.

**What still runs in memory, and why that is fine.** The run itself, while the handler waits for it
(the handler's alarm is the event that keeps the object alive), and the events' listeners. If the
object is evicted between a run's end and its log, the next opening of pi-durable (the next handler
run, at the latest) logs and announces it.

## Pi extensions

Not supported: running unmodified Pi coding-agent extensions was dropped with the move to
`@earendil-works/pi-durable`, whose own extensions will replace it.

## Your agents

A component of your own provides your agents:

```ts
import { defineComponent } from "@pikit/core";
import support from "../agents/support/agent.ts";

export default defineComponent({
  name: "agents",
  setup(pikit) {
    pikit.provideKeyed("agent.definition", support.name, support);
  },
});
```

## Tools

An agent gets the tools it names, and only those:

```ts
defineAgent({ name: "ops", model: "anthropic/claude-sonnet-4-6", tools: ["read", "bash", lookupTicket] })
```

A name (`"bash"`) is a tool that a `tool-*` component provides. An object (`lookupTicket`) is a tool
of your own: pi-durable's `defineTool` (from `@pikit/pi-adapter/tools`), with its `replay` (`"safe"`
runs it again when a run resumes after a crash; `"unsafe"`, the default, gives the model an
interrupted result). Installing `tool-bash` gives no agent a shell until one of them names `bash`.

A tool of your own that more than one agent names, or that needs a capability (a secret,
`execution`), is a `defineComponent` providing it as `agent.tool` under its name.

## Agents that change with the conversation

An agent can keep a JSON state per conversation and choose its model, system prompt and tools from it
(`agent.state`, @pikit/contracts' agent-state.ts):

```ts
defineAgent({
  name: "release",
  model: "anthropic/claude-sonnet-4-6",
  tools: ["read", advance],
  state: { phase: "testing" },
  prepare: (state) => (state.phase === "deploying" ? { tools: ["read", "bash", advance] } : {}),
});
```

`prepare` gives the conversation's agent for its state as it is then; what it leaves out keeps the
static value. It runs where its inputs change (when a message is admitted, with every state update,
and when pi-durable reopens), so the agent of each model request is always `prepare` of the state at
that moment: **a tool's state update applies from the run's next model request**, not from the next
run. A tool changes the state of the conversation it runs in through its context:
`await context.value(AGENT_STATE)?.update({ phase: "deploying" }, context)`. The state lives in the
conversation (a pi-durable document): it survives restarts and starts again from `state` after a reset.

Tool names only `prepare` returns cannot be checked at start. If `prepare` throws, or names a tool, an
extension or a model nothing provides, the conversation gets the static definition and the error is
logged.

`prepare` is the simple path: pure and synchronous, from the state. Anything that reads a store, waits,
or must see each model request or tool call is an extension.

## Live overrides

With `settings` installed (`settings-store`, installed with the dashboard), an operator changes an
agent's **system prompt**, **model** (one an installed provider has) and **tools** (on or off, among
those its definition names) from the dashboard's Settings, Agent (router-basic's section), with no
deploy and no restart (features/settings.md). The definition still owns the agent (SPEC §6): the
overrides are data over it (`overrides.ts`).

- **Declared at start** as runtime-pi's settings: one optional object per agent, its schema built from
  the App (the installed providers' models, the tools the definition names), its `default`s the
  definition's (what the dashboard shows), its defaults none. A value outside it is refused when set,
  and left out when read (a deploy removed the model).
- **Read** before every admission, every resume and `/compact`, and every run of the driving wakeup; on
  a server also at start. The agent of each model request is then the definition, `prepare` of the state,
  and the override over what `prepare` gave: a restart, a reopened Harness and an evicted object build
  the same agent, and a change applies to every conversation's next run (one already going keeps its
  agent until the next of these).
- **Failing safe**: an override the runtime cannot resolve makes the run use the definition, logged as
  `prepare`'s failures are; settings that cannot be read keep the ones read last, logged.

## Live agents

With `agent.directory` installed (`agents-live`: agents an operator creates in the dashboard), a
conversation's agent is its `agent.definition`, else the directory's agent of that name.

- **Read** with the overrides (before every admission, resume, `/compact` and driving wakeup; on a
  server also at start), so a new agent answers its first message with no restart and a change applies
  to the next run. A directory that cannot be read keeps the agents read last, logged.
- **Checked when used, not at start**: a live agent must name a model an installed provider has, and
  installed tools and extensions (`read`, `write`, `edit`, `bash` with an execution), as the code's
  agents must at start. A message to an agent that is neither the code's nor a live one that checks
  fails its admission (`dispatch` rejects), saying why.
- **Overrides** apply to a live agent as to any: with a directory, runtime-pi's settings accept an
  override for any other agent name, among the installed models and tools.
- Until the directory was read once in this App, a conversation of a name the code does not have is not
  resumed at start, nor abandoned as having no agent: its agent may be live.

## Agent extensions

What an agent does besides its model, prompt and tools is a Pi extension (`defineExtension` from
`@pikit/pi-adapter/extensions`): system prompt sections (async; they read the conversation's documents),
hooks on model requests (`beforeRequest`, `afterResponse`, `onYield`, `afterTools`), tool calls
(`beforeTool` blocks or rewrites, `afterTool`) and compaction (`beforeCompact`), tool wrappers, durable
tasks, and tools. A component provides one under its name, and an agent runs with the ones it names, in
that order, after its own tools:

```ts
pikit.provideKeyed("agent.extension", "memory", defineExtension({ name: "memory", sections: [recall], tools: [remember] }));
defineAgent({ name: "assistant", model: "anthropic/claude-sonnet-4-6", extensions: ["memory"] });
```

Only the agents that name an extension run with it, as with tools: installing one changes no agent, and
agents that share one list it (`const shared = ["memory", "guard"]`). An extension's tools come with
it, and run with `CONVERSATION` and `AGENT_STATE` like the agent's; one of the same name as an agent's
tool replaces it. Its state is a document (`defineDoc`, committed with the transcript, surviving
restarts) or the app's `storage.sql`. Names starting with `pikit.` are the runtime's own.

## Tests

`runtime-pi.test.ts` is copied with the component and runs in your project. It uses the scripted
model from `@pikit/pi-adapter/testing`, so it needs no API key. It covers:
- the `agent.runtime` conformance suite (queued messages batched into the next run, a worker that died
  mid-run), with and without `wakeups`;
- the lifecycle conformance suite, the same ways;
- a run that died mid-way resumed at start, with no new message, and its answer in `agent.submissions`;
  an answer in `answers` at the next start;
- `resume.ts`: which messages are abandoned after `abandonPendingAfterHours`, and that a `pending()`
  that never answers does not hold `stop`;
- `wakeups`: a run that died mid-way completed by the next App's wakeup; a long run driven over
  several slices, each cut asking again at once; a model retry's backoff as a wakeup at its time, with
  pi-durable suspended meanwhile; stop cancelling a waiting handler, which asks again;
- the start failures above, and a stored credential reaching the provider;
- an agent whose `prepare` gives it a tool once another tool moved its state on.

`overrides.test.ts` covers the live overrides (with a `settings` double): an override changing the next
run's system prompt, model and tools, the same agent after a restart, and the definition again once it
is taken away; the declared schema (the providers' models, the definition's tools); an override over
what `prepare` gives.

`live-agents.test.ts` covers the live agents (with a directory double): one made after start answering
its first message, a change applying to the next run, a name that is no agent and live agents that
cannot run here failing their admission, a live agent's override, a directory that cannot be read.

`extensions.test.ts` takes an agent extension through a real App: an async section reading a
document its tool wrote, a `beforeTool` hook that blocks, a `beforeRequest` hook, per-agent selection,
the start failures, and the extension's state across a restart.

`component.json` is generated from `setup` by the CLI (`pikit registry validate`) and is not written
by hand; the test "what setup declares" pins it.

## /compact and model.complete

- **`/compact [what the summary keeps]`** is Pi's command, registered through `agent.command` as any
  component's is (admin-api lists it in the dashboard's "/" and runs it in the conversation): it
  compacts that conversation now with pi-durable's manual compaction (`DurableRuntime.compact`): its
  older entries are summarized by its agent's model, with what follows the command as the summary's
  instructions, and the model reads the summary from then on; the entries stay in storage and in the
  transcript. It waits for the summary, and answers whether anything was cut ("Nothing to compact" for
  a conversation shorter than what pi-durable keeps verbatim, `keepRecentTokens`).
- **`model.complete`** asks one of the App's models for a text once (`createModelComplete` in the
  adapter: pi-ai's `completeSimple` over the same models, providers and credentials as the agents):
  no conversation, no tools, not counted in any conversation's usage. A model the providers do not
  have, a failed call or a cancelled context is a rejection. `maxTokens` is the answer's text: a
  reasoning model gets 2,048 tokens more to think in, and one whose thinking cannot be turned off
  (`openrouter/z-ai/glm-5.3-flash`) thinks at the least it allows. It passes `createModelCompleteConformance`
  (`runtime-pi.test.ts`, with the scripted faux model), and `/compact` the `agent.command` suite.

