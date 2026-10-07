# platform-cloudflare

The platform half of a Cloudflare project: the Worker reaches each conversation's Durable Object,
and components in the object handle its messages and wake at the time they ask for. It provides
`actor.mailbox`, `actor.inbox` and `wakeups` (SPEC §4.1, C2 to C5), the capabilities
`mailbox-local` and `wakeups-timers` provide on a server, so a channel or a runtime written against
them runs on both.

- **Provides:** `actor.mailbox`, `actor.inbox`, `wakeups`.
- **Requires:** nothing; it reads the platform from `WORKERS_HOST`, which `deployment-cloudflare`'s
  entrypoints put in each App's start context.
- **Target:** `durable`. On a server, use `mailbox-local` and `wakeups-timers`.
- **Installs to:** `src/pikit/platform-cloudflare/`.
- **npm dependencies:** none beyond pikit's (`typebox` for its config).

```sh
pikit add platform-cloudflare
```

It goes in **both Apps** of `pikit.config.ts` (C1): the Worker's (`export const worker`) and the
conversation object's (the default export). What it does depends on the App it starts in. So
`component.json` says `"apps": { "worker": "default" }`, and `pikit add` lists it in both (`pikit
remove` takes it out of both).

## In the Worker's App: `actor.mailbox`

`send(key, type, message, ctx)` is an RPC to the conversation's object:
`env.CONVERSATION.get(env.CONVERSATION.idFromName(key)).deliver(type, key, message)`. It resolves
when the object's `actor.inbox` handler for `type` resolved (the message is durable there), and
rejects on anything else: an empty key, a message that is not JSON, no handler for the type in the
object, a handler that rejected, the object unreachable, or `ctx` cancelled first. On a rejection
the channel does not acknowledge its platform, which delivers again: delivery is at-least-once, so
handlers recognise a message they already hold.

`call(key, type, message, ctx)` asks the object for an answer, by its `call` RPC: the object runs
the handler registered with `actor.inbox`'s `answer(type, handler)` and returns an outcome (the
JSON answer, or a code and a message), which the Worker turns back into the answer or an
`ActorCallError` with that code: an RPC keeps only an error's message, so the code travels in the
outcome. A failed RPC is `unreachable`, a cancelled `ctx` is `cancelled`, a handler's own
`ActorCallError` keeps its code, and anything else it throws is `failed`. This is how the Worker
reads a conversation's state (a dashboard), which it cannot read from its storage.

It refuses to start when `env.CONVERSATION` (or the binding you configure) is not a Durable Object
namespace. Its `actor.inbox` and `wakeups` throw there, saying they belong in the object's App.

## In the object's App

### `wakeups`, rows over one alarm

The object has one alarm; every component's requests share it. Each request is a row in the
object's SQL, in its own table (`platform_cloudflare_wakeups`: name, time, failures), and the alarm
is set to the earliest row whose name has a handler.

- **`at`, `cancel` and `handle` set the alarm again** when they change the earliest. A request for a
  name with no handler yet stays in the table and sets nothing (it would fire for nothing); the
  alarm is set once its handler registers.
- **When the alarm fires**, it runs **one slice** (`sliceMs`, 60 s by default), a small event loop:
  the due requests whose handler is registered **start at the same time**, earliest first, one run
  per name (a request for a name that is running waits for that run to end). While any handler still
  runs, the slice keeps starting what comes due, on time: `runtime-pi.drive` waits in its run while
  the model thinks, and meanwhile a channel's request 4 s later renews "typing", and a request made
  during the alarm (a message arriving by RPC) starts at once. It sleeps a second at most between two
  looks, so no alarm leaves a longer timer behind. The slice ends when nothing runs, or at its
  deadline: the running handlers' contexts are cancelled, each stops at a consistent point, asks
  again (`at(name, ctx.clock.now(), ctx)`) and resolves, and nothing more starts. Then the alarm is
  set to the earliest pending request, now if it is due, and the next alarm continues.
- **A row is deleted only when its handler resolved.** An alarm cut by the platform (a deploy, 15
  minutes of wall clock, an eviction) is retried by the platform and finds the row still there. A
  handler that rejects gets its row moved by the backoff: 1 s, 5 s, 30 s, then every 60 s, with its
  failures counted in the row and logged as a warning. A request made during the failed run stands
  if it is sooner; a `cancel` during it drops the retry. A run cut by the App's stop leaves its row
  as it was.
- **At start**, if rows exist, the alarm is set again (a reset may have lost it).
- **Cloudflare retries an alarm that rejects 6 times** (from 2 s apart, doubling: about 2 minutes),
  then drops it. A rejection here is the storage failing, rare and brief. An App that cannot start
  never reaches this component: deployment-cloudflare's entrypoint keeps the object woken then, with
  its guard alarm (its README), which this component's next `arm` replaces.

Nothing else in the object may set its alarm: a component that needs to wake uses `wakeups`.

### `actor.inbox`: the RPC's other end

The components that handle messages (a channel's object half) register a handler per type in their
`start`:

```ts
const inbox = pikit.use("actor.inbox");
// in start:
inbox.get().handle("telegram.update", async (key, message, ctx) => {
  await admit(key, message, ctx);   // resolve once it is durable: the Worker acknowledges then
});
```

A type has one handler (registering it twice throws); handlers are dropped at `stop`. The object's
`deliver` RPC, `deliver(type, key, message)`, calls the handler for `type` with a context of its own
(the start context's values, cancelled when the App stops, never by the sender), and resolves or
rejects with it. With no handler for the type, the error names it and lists the ones handled; the
Worker's `send` rejects, and the platform delivers again.

### `actor.mailbox` in the object

`actor.mailbox` works in the object too, so a component there can reach another conversation:
another key is an RPC to its object, as from the Worker; the object's own key (the one whose
`idFromName` is this object) is a local call, which spends no subrequest and does not re-enter the
object.

## How C4's budgets shape the slice

On Cloudflare an object runs only while an event is in progress: a request, an RPC, an alarm. A
promise left running after it is killed once the object idles out (70 to 140 s), and `waitUntil`
does nothing in an object. So long work (a run driven by the runtime) happens inside alarms, and
each alarm has its own budget, measured on the Free plan:

| Budget, per invocation | What the slice does about it |
|---|---|
| **15 minutes of wall clock** for an alarm, then it is cut (and retried) | A slice of 60 s is far from it; `sliceMs` is capped at 10 minutes. A cut alarm loses nothing (the rows stay) but wastes the work since the last commit. |
| **A deploy cuts every alarm in progress** (retried) | Short slices mean a deploy cuts at most one slice of work, which runs again. |
| **30 s of CPU** (waiting on the network does not count) | A slice is mostly waiting on the model; 60 s of wall clock rarely nears 30 s of CPU. Handlers that compute a lot should ask again sooner. |
| **50 subrequests** (fetches, RPCs to other objects) | Shared by every handler that runs in one slice, at the same time. See below what a slice costs. |
| **About 200 MB of memory** before the object is reset | Not the slice's: a reset is an eviction, and the rows make it lose nothing (K6). |

Why 60 to 90 s: long enough that a model call and its tools finish inside one slice, short enough to
stay far from every limit above and to let the other wakeups of the object (an outbox delivery) run
within a minute or so. Handlers run at the same time, so a handler that uses the whole slice delays
nothing else; what comes due at the deadline runs in the next alarm, at once.

### What a slice costs

Every handler that runs in a slice spends the same alarm's subrequests (50 on the Free plan, 1,000
on Paid). Reading and writing the object's own SQL spends none. In a Telegram conversation, for one
slice of 60 s while the model thinks:

| Who | Subrequests |
|---|---|
| `runtime-pi.drive`: each model call, and each tool call that fetches or reaches another object | 1 each |
| `channel-telegram-webhook.typing`: "typing", renewed every 4 s while a message waits for its run | up to 15 (60 s / 4 s) |
| `channel-telegram-webhook.answers`: the answer, once the run ends | 1 per piece (at most 20 per run) |

So about 35 remain for the run's model and tool calls on the Free plan: enough for several turns.
A shorter `sliceMs` gives each alarm fewer renewals and the next alarm 50 of its own. A handler that
fans out should stop early and ask again. Past the budget, a fetch fails: a lost "typing" is
ignored, a failed model call is the runtime's retry.

A handler that ignores its cancelled context keeps the alarm until the platform cuts it at 15
minutes, then runs again from the start: honour `ctx.abortSignal`.

## Config

```ts
"platform-cloudflare": {
  binding: "CONVERSATION",   // the conversation object's namespace binding in wrangler.jsonc
  sliceMs: 60_000,           // one alarm's slice, 1 ms to 10 minutes
}
```

Both are optional; these are the defaults. `binding` must be the one `deployment-cloudflare` binds
its conversation class to.

## The dependency graph

It uses nothing: message and wakeup handlers are registered with `handle`, not provided, so it starts
first and depends on none of them. A component in the object may handle messages, send them, wake
itself and use the runtime, which drives its runs with the same `wakeups`: no dependency cycle.

## Removing it

`pikit remove platform-cloudflare` refuses while a component requires `actor.mailbox`,
`actor.inbox` or `wakeups`. The table `platform_cloudflare_wakeups` stays in each object until the object is deleted;
drop it if you want it gone.

## Tests

Copied with the component, they run in your project under `bun test`, over doubles of a Durable
Object (its alarm on the app's clock, its RPC, its SQL in `node:sqlite`): the `wakeups` conformance
suite (with the slice deadline and requests that survive a restart), the `actor.mailbox` and
`actor.inbox` suite from a Worker's App to the objects (whose actor also sends and wakes itself), the
lifecycle suite, and the alarm set again, a slice (which leaves no timer longer than a second, and
runs a handler that asks again every second on time while another waits the whole slice), the
backoff rows, a request waiting for its handler, deliveries to `actor.inbox`, the object's own mailbox
and what it refuses at start. pikit also runs both suites in workerd, by RPC and alarm to
deployment-cloudflare's real `Conversation` class, and there the real alarm, an eviction, the slice
(with its handlers at the same time) and the backoff (`tests/workerd`). Beside the component (`object-app.test.ts`), object Apps with
`runtime-pi` on these wakeups: with an actor that handles and wakes (in workerd too), and a Telegram
project's whole object App with `channel-telegram-webhook`'s object half, which answers an update,
and shows "typing" without a gap while a slow model thinks, and not after the answer.
