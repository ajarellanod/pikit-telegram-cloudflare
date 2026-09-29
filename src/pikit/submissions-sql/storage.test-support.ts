/**
 * For the tests only: a `storage.sql` over one SQLite file, so submissions-sql's tests need no other
 * component (a component never imports another's files). `storage-sqlite` is the real one.
 */

import { DatabaseSync } from "node:sqlite";
import { defineComponent } from "@pikit/core";
import { type SqlDatabase, type SqlRow, type SqlStatements, type SqlValue } from "@pikit/contracts";

/** The contract over whatever SQLite handle `open()` gives now, one call at a time. */
function sqlDatabase(open: () => DatabaseSync): { database: SqlDatabase; settled(): Promise<void> } {
  let line: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = line.then(work);
    line = next.catch(() => {});
    return next;
  };
  const statements: SqlStatements = {
    query: async <Row extends SqlRow = SqlRow>(sql: string, params: readonly SqlValue[] = []) => open().prepare(sql).all(...params) as Row[],
    run: async (sql, params = []) => ({ changes: Number(open().prepare(sql).run(...params).changes) }),
  };
  const database: SqlDatabase = {
    query: (sql, params) => serial(() => statements.query(sql, params)),
    run: (sql, params) => serial(() => statements.run(sql, params)),
    transaction: (work) =>
      serial(async () => {
        open().exec("BEGIN IMMEDIATE");
        try {
          const result = await work(statements);
          open().exec("COMMIT");
          return result;
        } catch (error) {
          if (open().isTransaction) open().exec("ROLLBACK");
          throw error;
        }
      }),
  };
  return { database, settled: () => line.then(() => {}) };
}

/** A component providing `storage.sql` over the file at `path`, opened in `start` and closed in `stop`. */
export function testStorage(path: string) {
  let db: DatabaseSync | undefined;
  const { database, settled } = sqlDatabase(() => {
    if (db === undefined) throw new Error("test storage: not running");
    return db;
  });
  return defineComponent({
    name: "test-storage",
    setup(pikit) {
      pikit.provide("storage.sql", database);
      return {
        start() {
          db = new DatabaseSync(path);
          db.exec("PRAGMA journal_mode = WAL");
        },
        async stop() {
          await settled();
          db?.close();
          db = undefined;
        },
      };
    },
  });
}

/** A database over the file at `path` that outlives the apps using it: records across processes. */
export function openTestDatabase(path: string): { database: SqlDatabase; close(): Promise<void> } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  const { database, settled } = sqlDatabase(() => db);
  return {
    database,
    async close() {
      await settled();
      db.close();
    },
  };
}
