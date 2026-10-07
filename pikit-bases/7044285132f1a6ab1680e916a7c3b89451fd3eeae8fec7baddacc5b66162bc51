# storage-kv-sql

Small values your components keep across restarts, by key: a reader's cursor, a token, a setting.
It provides `storage.kv` on `storage.sql`, so the values live in the app's SQL database.

```sh
pikit add storage-sqlite      # the database it keeps its values in
pikit add storage-kv-sql
```

`pikit add channel-telegram` (or any component that requires `storage.kv`) offers it, with
`storage-sqlite` when nothing provides `storage.sql`.

## Using it

A component opens the namespace named after it, and never sees another's keys:

```ts
const kv = pikit.useOptional("storage.kv");   // or pikit.use, when it cannot work without it

// in start, or later:
const store = kv.get()?.namespace("my-component");
await store?.set("cursor", "42");
const cursor = await store?.get<string>("cursor");   // undefined when there is none
const first = await store?.setIfAbsent("owner", "me"); // true only for the call that wrote it
await store?.delete("cursor");
```

- **Values are JSON**; a value read back is a copy. `null` is a value, a missing key is `undefined`,
  and a value that is not JSON (`undefined`, a function) is refused.
- **Each call is atomic on its own**, across processes too: of concurrent `setIfAbsent` calls for
  one key, exactly one writes. There is no transaction across calls: what needs one, or queries,
  belongs in your component's own tables in `storage.sql`.

## What it does

- **One table**, `storage_kv_sql_entries` (`namespace`, `entry_key`, `json`), created at start when
  missing. You can read it with SQL (`sqlite3 .pikit/pikit.db`).
- **One statement per call**, and no cache: two processes over the same database see each other's
  writes, and the database decides a `setIfAbsent` race.

## Removing it

`pikit remove storage-kv-sql` refuses while a component requires `storage.kv` (every chat channel,
which keeps its delivery cursor there, and `conversations-kv`). The table stays: it is your data.

## Tests

Copied with the component, they run in your project: the `storage.kv` conformance suite (every kind
of JSON value, copies, namespaces, keys, `setIfAbsent` races, refused values, data that survives a
restart), the lifecycle suite, and two processes over one database.
