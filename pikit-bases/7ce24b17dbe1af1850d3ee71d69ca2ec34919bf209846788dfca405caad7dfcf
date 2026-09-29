/**
 * For the tests only: the part of a Durable Object's `storage.sql` this component uses (`exec`),
 * over `node:sqlite` in memory, so its tests run under `bun test` with no workerd. A double: pikit's
 * workerd lane (`tests/workerd`) runs the same suites on a real object's SQLite.
 */

import { DatabaseSync } from "node:sqlite";
import type { ObjectStorage } from "./index.ts";

export function fakeSql(): ObjectStorage["sql"] {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query, ...bindings) {
      const rows = db.prepare(query).all(...bindings) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
}
