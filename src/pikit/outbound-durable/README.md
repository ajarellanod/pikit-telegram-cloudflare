# outbound-durable

Every answer your agent gives is stored before it is sent, and delivered even if the process dies,
the Durable Object is evicted, the platform is down for up to a day, or it asks you to slow down. It
provides `outbound.queue` (@pikit/contracts' `outbound.ts`) on `storage.sql` and `wakeups`.

```sh
pikit add storage-sqlite      # the database it keeps its records in
pikit add wakeups-timers      # what wakes it for a retry (platform-cloudflare on Cloudflare)
pikit add outbound-durable
```

A channel that delivers through `startAnswerDelivery` (`channel-telegram`, `channel-telegram-webhook`)
uses it as soon as it is installed; remove it and the channel sends directly again. What each way
guarantees, and how they differ (receipts here; retries that never give up there), is said once, in
@pikit/contracts' `delivery.ts`, in its header ("Direct or queued").

## What it does

- **Stored before sent.** A channel enqueues each answer; it is split into the pieces the platform
  accepts and stored in one transaction, one row per piece. Enqueuing the same answer twice sends it
  once.
- **In order, per conversation.** One conversation's pieces go out one at a time. A piece waiting to
  be retried holds the ones behind it; other conversations do not wait.
- **Failures** are classified by the channel, handled here:

  | The channel says | What happens |
  |---|---|
  | transient (network, 5xx) | retried after 5 s, 30 s, 2 min, then every 10 min; never abandoned for failing |
  | rate limited | waits what the platform asked; not counted as a failure |
  | permanent (bot blocked, chat gone) | abandoned at once |
  | anything, after 24 hours | abandoned |

  An abandoned piece is logged as an error, emits `outbound.abandoned` and gets a receipt.
- **Woken by `wakeups`.** Sends and retries run in the handler it registers with `wakeups`
  (`outbound-durable`): when an answer is enqueued, and at the time the next piece is due. On a
  server `wakeups-timers` wakes it; on Cloudflare `platform-cloudflare` does, in the Durable Object's
  alarm, so a retry runs on time with the object evicted and no new message. A run that reaches its
  slice's deadline stops its sends (they go again as possible duplicates) and asks for the next one.

- **Crashes.** A piece that was being sent when the process died is sent again by the next one, as a
  *possible duplicate*: a platform with idempotent sends drops the copy; Telegram shows a `↻` marker.
  Losing an answer is worse than receiving it twice. A piece that had not been sent yet is sent
  normally.
- **Stopping** waits for the sends in flight, within the stop deadline, then aborts them; they are
  sent again (as possible duplicates) next time.

Known gap: an answer is enqueued by the channel right after the run ends. A crash in those few
milliseconds loses its delivery (the answer is still in the conversation's session). Pi's durable
runtime has the same gap; it closes when Pi can enqueue in the same commit as the answer.

## Receipts: for what must not miss a delivery

Every piece that settles, delivered or abandoned, gets one receipt, written in the same transaction
as its new state (`outbound_receipts`). Components that must not miss a delivery read them through
`outbound.queue`'s `receipts`, a feed (`Feed`, SPEC K3), from a cursor of their own. A decision bound to the
message that carries it, a reply that quotes an answer, an alert on an abandoned one: each reads
the receipts when it starts and whenever `outbound.delivered` wakes it, so a crash only delays it.

```ts
const page = await queue.receipts.read(savedCursor, 100);
for (const { cursor, fact } of page.items) {
  // fact.idempotencyKey is the answer's key (`answerKey(conversation, requestId)`), fact.index its piece;
  // fact.outcome is { kind: "delivered", platformMessageId, possibleDuplicate } or { kind: "abandoned", reason }.
}
if (page.gap) {
  // Receipts after savedCursor were pruned before you read them: say so.
}
```

Receipts are kept as long as their pieces (7 days delivered, 30 abandoned).

## Pending: what has not settled yet

`outbound.queue`'s `pending` lists the pieces still open, oldest stored first, a page at a time
(50 by default, at most 500): what the dashboard shows waiting. Each says its answer and piece, its
channel and conversation, its state, its attempts, when it is next due, why its last try failed,
whether it goes out as a possible duplicate, and when it was stored. Never its text.

```ts
let cursor: string | undefined;
do {
  const page = await queue.pending({ limit: 100, ...(cursor !== undefined && { cursor }) });
  for (const piece of page.items) {
    // piece.state: "queued" (never tried), "sending" (in flight), "retrying" (tried, waits to go again);
    // piece.nextAttemptAt, piece.lastError ("transient: 503 …", cut to 200 characters).
  }
  cursor = page.next;
} while (cursor !== undefined);
```

It reads `outbound_pieces` as it is now: a piece that settles while you page is in `receipts` instead.
On Cloudflare each conversation's Durable Object holds its own outbox, and lists only its own pieces.

## Schema versions

The tables carry a schema version (`outbound_meta`), so a later version of this component can add
what it needs to a database that already exists; a database written by a newer one is refused at
start.

## Seeing what happened

`pending` and `receipts` are the way in for code. By hand, everything is in the table
`outbound_pieces` of the database (`.pikit/pikit.db`):

```sh
sqlite3 .pikit/pikit.db "SELECT key, state, attempts, last_error FROM outbound_pieces WHERE state != 'delivered'"
```

Delivered pieces are kept 7 days, abandoned ones 30, with their reason. Each delivery emits
`outbound.delivered`, each abandonment `outbound.abandoned` (and an error in the logs).

## Config

```ts
"outbound-durable": {
  concurrency: 8,         // conversations sent to at the same time
  keepDeliveredDays: 7,
  keepAbandonedDays: 30,
}
```

## Removing it

`pikit remove outbound-durable`: channels send directly again. Pieces still pending in the table are
not sent by anyone; empty the table first if that matters.

## Tests

Copied with the component, they run in your project: the `outbound.queue` conformance suite (order,
each retry to the millisecond, rate limits, abandonment, restarts, detach, receipts), the lifecycle
suite, the feed suite over the receipts with their pruning, a database from before receipts, what
`pending` shows of an interrupted send and a long failure, its page sizes, the
convergence suite (the process killed after each of its commits in turn: every piece still delivered,
in order, with one receipt, and every repeated send marked a possible duplicate), and a test that kills
a process with SIGKILL during a send and checks the next process delivers it. pikit's workerd lane
also runs it in a real Durable Object: a failed send retried by the object's alarm after the object
was evicted, with no new message (`tests/workerd/test/outbound-durable.workerd.ts`).
