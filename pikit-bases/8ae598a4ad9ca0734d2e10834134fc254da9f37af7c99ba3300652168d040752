# conversations-kv

The conversation registry in `storage.kv`: which runtime conversation each conversation key is in now.
The same code runs on a server and in a Cloudflare Durable Object.

- **Provides:** `conversations.registry`.
- **Requires:** `storage.kv` (where the pointers live) and `agent.conversations` (the agent runtime's:
  `runtime-pi`; it creates each conversation there).
- **Targets:** `server` and `durable` (it imports nothing platform-specific).
- **Installs to:** `src/pikit/conversations-kv/`.
- **npm dependencies:** `typebox` (and `@pikit/pi-adapter` for its tests' fake `agent.conversations`).

The registry uses the runtime, never the other way round: `runtime-pi` provides
`agent.conversations` (a new pi-durable conversation; in a Cloudflare object, the object's root first)
and starts first; this component records which key points to which conversation id. So a project
installs `runtime-pi` before it.

```sh
pikit add conversations-kv    # offers storage-kv-sql (and storage-sqlite) when nothing provides storage.kv
```

It replaces `conversations-file`: a project has one `conversations.registry`. The pointers do not
move from one to the other; a conversation whose pointer is not found starts on a new conversation.

## What it does

A channel names a conversation with a key (`channel-http` uses `http:<conversationId>`).
- The first time a key is resolved, the registry creates a new conversation and records
  `key → { agent, conversationId }`.
- After that, the key resolves to the same conversation. A conversation keeps the agent it was created
  with, even if a later route names another one.
- A reset creates a new conversation and moves the pointer to it. The old conversation is kept, and its id
  is added to `previousConversationIds`. It then emits `conversation.reset`.
- No pointer is ever deleted. A conversation that went idle and was closed in memory keeps its
  pointer.

Each pointer is one value in the `storage.kv` namespace `conversations-kv`, at the conversation's
key. The store is the record, and nothing is cached: every call reads it, so a restarted server or
an evicted Durable Object finds what the last one wrote. A pointer is used only once it is stored.

A crash between creating a conversation and storing its pointer leaves one unused conversation behind. It
never leaves a pointer to a conversation that does not exist.

A value in its namespace that is not a pointer fails the call that reads it, and is never
overwritten.

The value at `http:c1`:

```json
{
  "agent": "assistant",
  "conversationId": "…",
  "previousConversationIds": ["…"],
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000
}
```

## What the store guarantees

`storage.kv` makes each call atomic, but has no transaction across calls. So:

- **Concurrent first resolves of one key get one conversation.** The first pointer is written with
  `setIfAbsent`: exactly one writer wins, and every other resolve returns the winner's pointer. In
  one process the racers wait for each other and create one conversation. Across processes (two server
  replicas over one database), each losing resolve leaves one unused conversation behind.
- **A resolve never undoes a reset, and a reset never undoes a resolve.** Only `setIfAbsent` writes
  a first pointer, and a reset only changes a pointer that exists. A resolve that loses its first
  write to another process returns that process's pointer, reset or not.
- **In one process, the changes to one key run one at a time.** A reset and a resolve sent together
  run in order, and two resets move the pointer twice and remember both previous conversations.
- **Across processes, two resets of one key at once both succeed, and the last write wins.** Each
  emits `conversation.reset` from the same previous conversation; the pointer names one of the two new
  conversations, and the other is kept in the runtime but is neither current nor in
  `previousConversationIds`. On Cloudflare this does not happen: one Durable Object owns a conversation.
  On a server, run one replica, as with `conversations-file`.
- **`conversation.reset` is emitted once the new pointer is stored.** A reset whose pointer could not
  be stored fails, emits nothing, and leaves the pointer where it was (and one unused conversation). An
  event may still be missed (SPEC K3); the pointer is the truth.

## Config

None. Where the pointers live is `storage.kv`'s business.

## Removing it

`pikit remove conversations-kv` refuses while a component requires `conversations.registry`. Its
values stay in `storage.kv`: they are your data.

## Tests

`conversations-kv.test.ts` is copied with the component and runs in your project, over the memory
`storage.kv` of `@pikit/contracts/testing` and a fake `agent.conversations`. It covers:
- the `conversations.registry` conformance suite from `@pikit/contracts/testing`, including the
  conversations it creates;
- the lifecycle conformance suite;
- the stored value, a `__proto__` key, a value that is not a pointer, the event only after the
  pointer is stored, and the races above, in one process and in two.

In this repository, `storage-kv-sql.test.ts` also runs the conformance suite over `storage-kv-sql`
on a SQLite file, and two processes racing over one database. It is not copied: a component's files
never import another component's.

`component.json` is generated from `setup` by `pikit registry generate` and is not written by hand;
the test "what setup declares" pins it.
