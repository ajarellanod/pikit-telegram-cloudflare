# storage-do

The app's SQL database on Cloudflare: each conversation's Durable Object keeps its records in its own
SQLite. It provides `storage.sql` (SPEC §4.1, C5), so what uses `storage.sql` on a server
(`storage-kv-sql`, runtime-pi's pi-durable tables and answers log) runs unchanged in the object.

- **Provides:** `storage.sql`.
- **Requires:** nothing; it reads the object from `WORKERS_HOST`, which `deployment-cloudflare`'s
  entrypoint puts in the start context.
- **Target:** `durable`. On a server, use `storage-sqlite`.
- **Installs to:** `src/pikit/storage-do/`.
- **npm dependencies:** none.

```sh
pikit add storage-do
```

It belongs in the Durable Object's App (the default export of `pikit.config.ts`), not in the
Worker's (`export const worker`): the Worker has no storage of its own.

## What it does

- **The object's SQLite**, through `ctx.storage.sql`. The object's class must be SQLite-backed: in
  `wrangler.jsonc`, its migration lists it in `new_sqlite_classes`, not `new_classes`.
- **One statement at a time.** `sql.exec` is synchronous; each call is wrapped in a promise, on one
  queue. A transaction is never interleaved with anything, and a statement outside it never sees half
  of it.
- **Transactions** run in `ctx.storage.transaction(async …)`: every statement of the work commits
  when it resolves, none when it rejects. A transaction runs statements only (the contract): no
  network call inside one.
- **Bytes** read back as `Uint8Array`, like on a server.
- **It refuses to start** outside a Durable Object's App (no `WORKERS_HOST`, or one with no object),
  or on an object without SQLite, and says which.

## Limits of a Durable Object's SQLite

Cloudflare's, measured or documented (September 2026). A component that uses `storage.sql` on
Cloudflare must fit them:

- **2 MB per row, string or BLOB.** Store bigger data in chunks (C7 does for files).
- **`LIKE` and `GLOB` patterns over about 50 bytes fail** with "LIKE or GLOB pattern too complex". To
  find keys by prefix, use a range: `WHERE k >= ? AND k < ?` (the prefix, then the prefix with its last
  character incremented).
- **10 GB per object** on the paid plan, **1 GB on Free** (5 GB per account). Each conversation is its
  own object, so this is per conversation.
- Also documented: 100 KB per statement, 100 bound parameters per statement, 100 columns per table.
- No `BEGIN`, `COMMIT` or `SAVEPOINT` statements: use `transaction`.

## Removing it

`pikit remove storage-do` refuses while a component requires `storage.sql`. The data stays in each
object until the object is deleted: it is your data.

## Tests

Copied with the component, they run in your project under `bun test`, over a double of a Durable
Object's storage (`node:sqlite` in memory): the `storage.sql` conformance suite (values, bound
parameters, transactions, isolation, data that survives a restart), the lifecycle suite, and what it
refuses at start. pikit also runs the `storage.sql` suite, `storage-kv-sql`, and runtime-pi's answers feed and reconciliation
over this component, in workerd on a real SQLite-backed Durable Object (`tests/workerd`).
