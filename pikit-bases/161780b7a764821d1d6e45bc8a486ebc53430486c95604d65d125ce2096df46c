/**
 * The stored values: a table of `storage.sql`, `settings_store`, one row per component (its value as
 * the operator set it, as JSON text; who set it and when), made at its first use. On a server it is
 * the App's own database; on Cloudflare the settings object's (`SETTINGS_KEY`, `calls.ts`).
 *
 * **The version** is the highest `version` of its rows: a write gives its row the next one, in one
 * transaction, so a reader that kept the values of a version knows from that number alone whether
 * anything changed (an object's cache, `calls.ts`).
 */

import type { SettingsValue, SqlDatabase } from "@pikit/contracts";
import type { SettingsSource } from "./settings.ts";

const TABLE = "settings_store";

export interface SettingsTable extends SettingsSource {
  /** The values' version: 0 before any write. */
  version(): Promise<number>;
  /** Every stored value, and their version. */
  snapshot(): Promise<{ version: number; values: Record<string, SettingsValue> }>;
}

/** The table over `sql()` (`storage.sql`), and when a write happens (`now`, epoch ms). */
export function createSettingsTable(sql: () => SqlDatabase, now: () => number): SettingsTable {
  let ready: Promise<void> | undefined;
  const db = async (): Promise<SqlDatabase> => {
    const database = sql();
    ready ??= database
      .run(`CREATE TABLE IF NOT EXISTS ${TABLE} (component TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL, operator TEXT NOT NULL, at BIGINT NOT NULL)`)
      .then(
        () => undefined,
        (error: unknown) => {
          ready = undefined;
          throw error;
        },
      );
    await ready;
    return database;
  };

  const snapshot = async () => {
    const rows = await (await db()).query<{ component: string; value: string; version: number }>(`SELECT component, value, version FROM ${TABLE}`);
    const values: Record<string, SettingsValue> = {};
    let version = 0;
    for (const row of rows) {
      values[row.component] = JSON.parse(row.value) as SettingsValue;
      version = Math.max(version, Number(row.version));
    }
    return { version, values };
  };

  return {
    snapshot,
    async read() {
      return (await snapshot()).values;
    },
    async version() {
      const [row] = await (await db()).query<{ version: number | null }>(`SELECT MAX(version) AS version FROM ${TABLE}`);
      return Number(row?.version ?? 0);
    },
    async write(component, value, operator) {
      const database = await db();
      await database.transaction(async (tx) => {
        const [row] = await tx.query<{ version: number | null }>(`SELECT MAX(version) AS version FROM ${TABLE}`);
        const version = Number(row?.version ?? 0) + 1;
        await tx.run(
          `INSERT INTO ${TABLE} (component, value, version, operator, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (component) DO UPDATE SET ` +
            "value = excluded.value, version = excluded.version, operator = excluded.operator, at = excluded.at",
          [component, JSON.stringify(value), version, operator.id, Math.floor(now())],
        );
      });
    },
  };
}
