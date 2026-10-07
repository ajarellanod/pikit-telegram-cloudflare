/**
 * storage-do: the app's SQL database (`storage.sql`) in a Durable Object's own SQLite (SPEC §4.1, C5).
 *
 * On Cloudflare each conversation's Durable Object runs an App (C1); this component gives that App's
 * components (sessions, submissions, `storage.kv`) the object's SQLite, through the object's
 * `DurableObjectStorage`, which `deployment-cloudflare` puts in `WORKERS_HOST`.
 *
 * - **Async over sync.** `storage.sql.exec` is synchronous; each call is wrapped in a promise.
 * - **One line.** Statements and transactions run in order on one queue, so a statement outside a
 *   transaction waits for it and never sees half of it.
 * - **Transactions** go through `storage.transaction(async …)`, which commits the `sql.exec` calls its
 *   closure makes across `await`s, and rolls them all back when it rejects. A transaction's work may
 *   only run statements (the contract): it holds the line while it runs.
 * - **Bytes** are bound as `ArrayBuffer` and read back as `Uint8Array`; `run().changes` comes from
 *   `SELECT changes()`, since a DO cursor does not report it.
 * - It refuses to start outside a Durable Object's App.
 *
 * Target: `durable`. It imports nothing from `cloudflare:*`: the storage is typed here by what is
 * used of it.
 */

import { defineComponent } from "@pikit/core";
import type { SqlDatabase, SqlRow, SqlStatements, SqlValue } from "@pikit/contracts";
import { WORKERS_HOST } from "@pikit/contracts/cloudflare";

/** What this component uses of a `DurableObjectStorage` (Cloudflare's type, written structurally). */
export interface DurableObjectSqlStorage {
  sql: { exec(query: string, ...bindings: (string | number | null | ArrayBuffer)[]): { toArray(): Record<string, unknown>[] } };
  transaction<T>(closure: () => Promise<T>): Promise<T>;
}

const bind = (params: readonly SqlValue[]) =>
  // `slice()` copies exactly the view's bytes: a Uint8Array may be a window on a larger buffer.
  params.map((value) => (value instanceof Uint8Array ? value.slice().buffer : value));

const toRow = (row: Record<string, unknown>): SqlRow => {
  const out: SqlRow = {};
  for (const [column, value] of Object.entries(row)) out[column] = value instanceof ArrayBuffer ? new Uint8Array(value) : (value as SqlValue);
  return out;
};

function isSqlStorage(storage: unknown): storage is DurableObjectSqlStorage {
  const candidate = storage as Partial<DurableObjectSqlStorage> | undefined;
  try {
    return typeof candidate?.sql?.exec === "function" && typeof candidate.transaction === "function";
  } catch {
    // An object without SQLite (declared in `new_classes`) throws when `sql` is read.
    return false;
  }
}

export default defineComponent({
  name: "storage-do",
  setup(pikit) {
    let storage: DurableObjectSqlStorage | undefined;
    let line: Promise<unknown> = Promise.resolve();
    /** Runs `work` after everything queued before it, whether that succeeded or failed. */
    const serial = <T>(work: () => Promise<T>): Promise<T> => {
      const next = line.then(work);
      line = next.catch(() => {});
      return next;
    };
    const open = (): DurableObjectSqlStorage => {
      if (storage === undefined) throw new Error("storage-do: storage.sql used while the app is not running");
      return storage;
    };

    // Statements run directly on the storage: the caller already holds the line.
    const statements: SqlStatements = {
      query: async <Row extends SqlRow = SqlRow>(sql: string, params: readonly SqlValue[] = []) =>
        open()
          .sql.exec(sql, ...bind(params))
          .toArray()
          .map((row) => toRow(row) as Row),
      run: async (sql, params = []) => {
        const sqlStorage = open().sql;
        sqlStorage.exec(sql, ...bind(params)).toArray();
        const [row] = sqlStorage.exec("SELECT changes() AS changes").toArray();
        return { changes: Number(row?.changes ?? 0) };
      },
    };

    const database: SqlDatabase = {
      query: (sql, params) => serial(() => statements.query(sql, params)),
      run: (sql, params) => serial(() => statements.run(sql, params)),
      transaction: (work) => serial(() => open().transaction(() => work(statements))),
    };
    pikit.provide("storage.sql", database);

    return {
      start(ctx) {
        const host = ctx.value(WORKERS_HOST);
        if (host?.object === undefined) {
          throw new Error(
            host === undefined
              ? "storage-do: no WORKERS_HOST in the start context: it runs only on Cloudflare, in a Durable Object's App started by deployment-cloudflare. On a server, use storage-sqlite."
              : "storage-do: this App is not a Durable Object's (WORKERS_HOST has no object): install storage-do in the default export of pikit.config.ts, the conversation object's App, not in the Worker's.",
          );
        }
        if (!isSqlStorage(host.object.storage)) {
          throw new Error(
            "storage-do: the Durable Object's storage has no SQL API: declare its class in new_sqlite_classes (not new_classes) in the migrations of wrangler.jsonc.",
          );
        }
        storage = host.object.storage;
      },
      async stop(ctx) {
        // Let the statement in flight finish; the stop deadline bounds the wait. The storage stays
        // the object's: there is nothing to close.
        await untilAborted(line, ctx.abortSignal);
        storage = undefined;
      },
    };
  },
});

function untilAborted(work: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
  const settled = work.then(
    () => {},
    () => {},
  );
  if (signal === undefined) return settled;
  return Promise.race([
    settled,
    new Promise<void>((done) => {
      if (signal.aborted) done();
      signal.addEventListener("abort", () => done(), { once: true });
    }),
  ]);
}
