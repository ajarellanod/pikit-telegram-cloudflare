/**
 * For the tests only: the part of a Durable Object's storage that storage-do uses (`sql.exec` and
 * `transaction`), over `node:sqlite` in memory, so its tests run under `bun test` with no workerd. It
 * answers as a Durable Object does: bytes come back as `ArrayBuffer`, and a transaction's closure
 * commits when it resolves and rolls back when it rejects.
 *
 * A double: the proof on a real object is pikit's workerd lane (`tests/workerd`).
 */

import { DatabaseSync } from "node:sqlite";
import type { WorkersHost } from "@pikit/contracts";
import type { DurableObjectSqlStorage } from "./index.ts";

export function fakeDurableObjectStorage(): DurableObjectSqlStorage {
  const db = new DatabaseSync(":memory:");
  return {
    sql: {
      exec(query, ...bindings) {
        const params = bindings.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
        const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
        const toArray = () =>
          rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? v.slice().buffer : v])));
        return { toArray };
      },
    },
    async transaction(closure) {
      db.exec("BEGIN");
      try {
        const result = await closure();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** A Durable Object's host over `storage`: what deployment-cloudflare puts in WORKERS_HOST. */
export function fakeObjectHost(storage: unknown = fakeDurableObjectStorage()): WorkersHost {
  return { env: {}, object: { id: "test-object", storage, onAlarm: () => {}, onDeliver: () => {} } };
}
