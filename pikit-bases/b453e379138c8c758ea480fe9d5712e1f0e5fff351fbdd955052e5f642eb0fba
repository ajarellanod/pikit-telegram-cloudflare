/**
 * For the tests only: the part of a Durable Object's storage that execution-do uses (`sql.exec` and
 * `transactionSync`), over `node:sqlite` in memory, so its tests run under `bun test` with no workerd.
 * It answers as a Durable Object does: bytes come back as `ArrayBuffer`, a row holds at most 2 MB, and
 * a transaction commits when its closure returns and rolls back when it throws.
 *
 * A double: the proof on a real object is pikit's workerd lane (`tests/workerd`).
 */

import { DatabaseSync } from "node:sqlite";
import type { WorkersHost } from "@pikit/contracts";
import type { DurableObjectFilesStorage } from "./files.ts";

const MAX_ROW_BYTES = 2 * 1024 * 1024;

export function fakeDurableObjectStorage(): DurableObjectFilesStorage {
  const db = new DatabaseSync(":memory:");
  return {
    sql: {
      exec(query, ...bindings) {
        const params = bindings.map((value) => {
          if (value instanceof ArrayBuffer && value.byteLength > MAX_ROW_BYTES) throw new Error("string or blob too big: SQLITE_TOOBIG");
          return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
        });
        const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
        return { toArray: () => rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? v.slice().buffer : v]))) };
      },
    },
    transactionSync(closure) {
      db.exec("SAVEPOINT execution_do_test");
      try {
        const result = closure();
        db.exec("RELEASE execution_do_test");
        return result;
      } catch (error) {
        db.exec("ROLLBACK TO execution_do_test");
        db.exec("RELEASE execution_do_test");
        throw error;
      }
    },
  };
}

/** A Durable Object's host over `storage`, with `env` as the Worker's: what deployment-cloudflare puts in WORKERS_HOST. */
export function fakeObjectHost(storage: unknown = fakeDurableObjectStorage(), env: Record<string, unknown> = {}): WorkersHost {
  return { env, object: { id: "test-object", storage, onAlarm: () => {}, onDeliver: () => {} } };
}
