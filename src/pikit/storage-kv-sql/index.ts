/**
 * storage-kv-sql: `storage.kv` on `storage.sql`. Small JSON values each component keeps across
 * restarts, by key, in a namespace of its own: a reader's cursor, a token, a setting.
 *
 * - **One table**, `storage_kv_sql_entries`, keyed by namespace and key, created in `start` if
 *   missing. Values are stored as JSON text, so a value read back is always a copy.
 * - **Each call is one statement**, so it is atomic on its own, across processes too. `setIfAbsent`
 *   is an `INSERT … ON CONFLICT DO NOTHING`: the database decides a race, not this process.
 * - **Nothing is cached.** Two processes over the same database see each other's writes.
 *
 * What needs queries, or several records changed together, belongs in a component's own tables in
 * `storage.sql`, not here.
 *
 * Targets: `server` and `cloudflare`: it imports nothing platform-specific, and its storage is
 * whatever provides `storage.sql` there.
 */

import { defineComponent } from "@pikit/core";
import type { JsonValue, KeyValueStorage, SqlRow } from "@pikit/contracts";

export const TABLE = "storage_kv_sql_entries";

/** A value as stored: JSON text. A value that is not JSON is refused, never stored as something else. */
function serialize(value: JsonValue): string {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) throw new TypeError("storage-kv-sql: a value must be JSON");
  return text;
}

export default defineComponent({
  name: "storage-kv-sql",
  setup(pikit) {
    const storage = pikit.use("storage.sql");

    const kv: KeyValueStorage = {
      namespace(name) {
        return {
          async get<T extends JsonValue = JsonValue>(key: string) {
            const [row] = await storage.get().query<{ json: string } & SqlRow>(`SELECT json FROM ${TABLE} WHERE namespace = ? AND entry_key = ?`, [name, key]);
            return row === undefined ? undefined : (JSON.parse(row.json) as T);
          },
          async set(key, value) {
            await storage
              .get()
              .run(`INSERT INTO ${TABLE} (namespace, entry_key, json) VALUES (?, ?, ?) ON CONFLICT (namespace, entry_key) DO UPDATE SET json = excluded.json`, [
                name,
                key,
                serialize(value),
              ]);
          },
          async setIfAbsent(key, value) {
            const { changes } = await storage
              .get()
              .run(`INSERT INTO ${TABLE} (namespace, entry_key, json) VALUES (?, ?, ?) ON CONFLICT (namespace, entry_key) DO NOTHING`, [name, key, serialize(value)]);
            return changes === 1;
          },
          async delete(key) {
            await storage.get().run(`DELETE FROM ${TABLE} WHERE namespace = ? AND entry_key = ?`, [name, key]);
          },
        };
      },
    };
    pikit.provide("storage.kv", kv);

    return {
      async start() {
        await storage
          .get()
          .run(`CREATE TABLE IF NOT EXISTS ${TABLE} (namespace TEXT NOT NULL, entry_key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (namespace, entry_key))`);
      },
    };
  },
});
