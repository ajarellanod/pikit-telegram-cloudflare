/**
 * For the tests only: a `storage.sql` over one SQLite file, so sessions-sql's tests need no other
 * component (a component never imports another's files). `storage-sqlite` is the real one on a server,
 * and a Durable Object's SQL on Cloudflare: this one refuses every statement a Durable Object would
 * (over 100 bound parameters, 100 KB of SQL, 2 MB in one value, `LIKE`/`GLOB`), so what passes here
 * fits there.
 */

import { defineComponent } from "@pikit/core";
import { openSqliteDatabase, type SqliteDatabase } from "@pikit/pi-adapter/testing";

type Database = SqliteDatabase["database"];

/** A component providing `storage.sql` over the file at `path`, opened in `start` and closed in `stop`. */
export function testStorage(path: string) {
  let db: SqliteDatabase | undefined;
  const current = () => {
    if (db === undefined) throw new Error("test storage: not running");
    return db.database;
  };
  return defineComponent({
    name: "test-storage",
    setup(pikit) {
      pikit.provide("storage.sql", {
        query: ((...args: Parameters<Database["query"]>) => current().query(...args)) as Database["query"],
        run: (sql, params) => current().run(sql, params),
        transaction: (work) => current().transaction(work),
      });
      return {
        start() {
          db = openSqliteDatabase(path, { durableObjectLimits: true });
        },
        async stop() {
          const closing = db;
          db = undefined;
          await closing?.close();
        },
      };
    },
  });
}

/** A database over the file at `path` that outlives the apps using it: to read what they wrote. */
export function openTestDatabase(path: string): SqliteDatabase {
  return openSqliteDatabase(path);
}
