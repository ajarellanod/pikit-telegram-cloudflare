/**
 * The outbox's records in `storage.sql`: one row per piece of an answer, from stored to delivered or
 * abandoned, and one receipt per piece that settled. All SQL of the component is here; the rest reads
 * and writes `Piece`s.
 *
 * The dialect is SQLite's (`INTEGER PRIMARY KEY` as the order of arrival, `AUTOINCREMENT`,
 * `ON CONFLICT`). A Postgres port changes this file only; its receipts need a cursor that follows
 * commit order, which a sequence under concurrent writers does not (SPEC §4.8).
 */

import type { DeliveryReceipt, FeedPage, SqlDatabase, SqlRow, SqlStatements } from "@pikit/contracts";

/** `pending` → `sending` → `delivered` | `abandoned` (SPEC §5, "Outbound delivery"). */
export type PieceState = "pending" | "sending" | "delivered" | "abandoned";

export interface Piece {
  /** Order of arrival: a conversation's pieces go out in this order. */
  seq: number;
  /** `${idempotencyKey}#${index}`. */
  key: string;
  channel: string;
  conversationKey: string;
  text: string;
  state: PieceState;
  /** Sends tried, whatever came of them. */
  attempts: number;
  /** Transient failures only: the fifth abandons. A rate limit is not a failure. */
  failures: number;
  /** Not sent before this time (ms). */
  nextAttemptAt: number;
  /** It may have reached the platform already. */
  possibleDuplicate: boolean;
  createdAt: number;
}

interface PieceRow extends SqlRow {
  seq: number;
  key: string;
  channel: string;
  conversation_key: string;
  text: string;
  state: string;
  attempts: number;
  failures: number;
  next_attempt_at: number;
  possible_duplicate: number;
  created_at: number;
}

interface ReceiptRow extends SqlRow {
  seq: number;
  message_key: string;
  piece_index: number;
  channel: string;
  conversation_key: string;
  outcome: string;
  platform_message_id: string | null;
  possible_duplicate: number;
  reason: string | null;
  attempts: number;
  at: number;
}

const COLUMNS = "seq, key, channel, conversation_key, text, state, attempts, failures, next_attempt_at, possible_duplicate, created_at";

/**
 * The schema, one step per version. `outbound_meta.schema_version` says how many have run; each runs
 * in its own transaction with the version it reaches. `CREATE TABLE IF NOT EXISTS` alone cannot add a
 * table or a column to a database that already exists (the outbox of a deployed bot), and
 * `PRAGMA user_version` is shared by every component of the app's one database.
 */
const MIGRATIONS: readonly ((tx: SqlStatements) => Promise<void>)[] = [
  // 1. The pieces. `IF NOT EXISTS`: databases from before versioning already have them.
  async (tx) => {
    await tx.run(`CREATE TABLE IF NOT EXISTS outbound_pieces (
      seq INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      text TEXT NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      possible_duplicate INTEGER NOT NULL DEFAULT 0,
      platform_message_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    )`);
    await tx.run("CREATE INDEX IF NOT EXISTS outbound_pieces_open ON outbound_pieces (state, conversation_key, seq)");
  },
  // 2. The receipts (SPEC §4.8, §5). A table of their own: a piece's `seq` is given when it is stored,
  // not when it settles (an older piece may settle later), and SQLite reuses the highest rowid once
  // that row is pruned. `AUTOINCREMENT` never reuses one, so `seq` follows the order pieces settled.
  async (tx) => {
    await tx.run(`CREATE TABLE outbound_receipts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      message_key TEXT NOT NULL,
      piece_index INTEGER NOT NULL,
      channel TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      outcome TEXT NOT NULL,
      platform_message_id TEXT,
      possible_duplicate INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      attempts INTEGER NOT NULL,
      at INTEGER NOT NULL
    )`);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** The piece's receipt, committed in the same transaction as the state it settled in. */
type Settlement = { kind: "delivered"; platformMessageId: string } | { kind: "abandoned"; reason: string };

export function createStore(db: SqlDatabase) {
  const meta = async (sql: SqlStatements, name: string): Promise<number | undefined> =>
    (await sql.query<{ value: number }>("SELECT value FROM outbound_meta WHERE name = ?", [name]))[0]?.value;
  const setMeta = (sql: SqlStatements, name: string, value: number) =>
    sql.run("INSERT INTO outbound_meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value", [name, value]);

  /** Marks `piece` settled, if it still is where `from` says, and records its receipt with it. */
  const settle = (piece: Piece, from: readonly PieceState[], attempts: number, settlement: Settlement, now: number): Promise<boolean> =>
    db.transaction(async (tx) => {
      const states = from.map(() => "?").join(", ");
      const changed =
        settlement.kind === "delivered"
          ? await tx.run(
              `UPDATE outbound_pieces SET state = 'delivered', platform_message_id = ?, last_error = NULL, settled_at = ? WHERE key = ? AND state IN (${states})`,
              [settlement.platformMessageId, now, piece.key, ...from],
            )
          : await tx.run(
              `UPDATE outbound_pieces SET state = 'abandoned', last_error = ?, settled_at = ? WHERE key = ? AND state IN (${states})`,
              [settlement.reason, now, piece.key, ...from],
            );
      // Settled already (by a process that no longer owns it): its receipt exists, and stays the only one.
      if (changed.changes !== 1) return false;
      const { idempotencyKey, index } = splitKey(piece.key);
      await tx.run(
        `INSERT INTO outbound_receipts (message_key, piece_index, channel, conversation_key, outcome, platform_message_id, possible_duplicate, reason, attempts, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idempotencyKey,
          index,
          piece.channel,
          piece.conversationKey,
          settlement.kind,
          settlement.kind === "delivered" ? settlement.platformMessageId : null,
          piece.possibleDuplicate ? 1 : 0,
          settlement.kind === "abandoned" ? settlement.reason : null,
          attempts,
          now,
        ],
      );
      return true;
    });

  return {
    /** Brings the tables to `SCHEMA_VERSION`. Refuses a database written by a newer outbox. */
    async migrate(): Promise<void> {
      await db.run("CREATE TABLE IF NOT EXISTS outbound_meta (name TEXT PRIMARY KEY, value INTEGER NOT NULL)");
      // The version is read inside each step's transaction, which holds the write lock: two
      // processes starting at once would otherwise both see version 0 and both run step 1.
      let done = false;
      while (!done) {
        done = await db.transaction(async (tx) => {
          const version = (await meta(tx, "schema_version")) ?? 0;
          if (version > SCHEMA_VERSION) {
            throw new Error(`outbound-durable: the database is at schema version ${version}, newer than this component's ${SCHEMA_VERSION}; upgrade the component`);
          }
          if (version === SCHEMA_VERSION) return true;
          await (MIGRATIONS[version] as (tx: SqlStatements) => Promise<void>)(tx);
          await setMeta(tx, "schema_version", version + 1);
          return false;
        });
      }
    },

    /** Stores a message's pieces in one transaction; keys already stored are left as they are. */
    async add(pieces: { key: string; channel: string; conversationKey: string; text: string }[], now: number): Promise<void> {
      await db.transaction(async (tx) => {
        for (const p of pieces) {
          await tx.run(
            "INSERT INTO outbound_pieces (key, channel, conversation_key, text, state, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT (key) DO NOTHING",
            [p.key, p.channel, p.conversationKey, p.text, now, now],
          );
        }
      });
    },

    /**
     * A process that starts finds `sending` rows only if the last one died during their send: they
     * may have reached the platform, so they go back to `pending` as possible duplicates.
     */
    async recoverInterrupted(): Promise<number> {
      return (await db.run("UPDATE outbound_pieces SET state = 'pending', possible_duplicate = 1 WHERE state = 'sending'")).changes;
    },

    /** The first open piece of every conversation: only a conversation's head may be sent. */
    async heads(): Promise<Piece[]> {
      const rows = await db.query<PieceRow>(
        `SELECT ${COLUMNS} FROM outbound_pieces p
         WHERE p.state IN ('pending', 'sending')
           AND p.seq = (SELECT MIN(q.seq) FROM outbound_pieces q
                        WHERE q.conversation_key = p.conversation_key AND q.state IN ('pending', 'sending'))
         ORDER BY p.seq`,
      );
      return rows.map(toPiece);
    },

    /** Written before the platform call: if the process dies now, the next one knows it may have been sent. */
    async markSending(key: string): Promise<boolean> {
      return (await db.run("UPDATE outbound_pieces SET state = 'sending', attempts = attempts + 1 WHERE key = ? AND state = 'pending'", [key])).changes === 1;
    },

    /** The send succeeded. False when the piece was no longer being sent: nothing changed. */
    markDelivered(piece: Piece, attempts: number, platformMessageId: string, now: number): Promise<boolean> {
      return settle(piece, ["sending"], attempts, { kind: "delivered", platformMessageId }, now);
    },

    /** Back to `pending`, to be tried at `nextAttemptAt`. */
    async retryLater(key: string, change: { nextAttemptAt: number; failed: boolean; possibleDuplicate: boolean; error: string }): Promise<void> {
      await db.run(
        `UPDATE outbound_pieces SET state = 'pending', next_attempt_at = ?, failures = failures + ?,
           possible_duplicate = MAX(possible_duplicate, ?), last_error = ? WHERE key = ?`,
        [change.nextAttemptAt, change.failed ? 1 : 0, change.possibleDuplicate ? 1 : 0, change.error, key],
      );
    },

    /** Given up, while it waited or was being sent. False when it had settled already: nothing changed. */
    abandon(piece: Piece, attempts: number, reason: string, now: number): Promise<boolean> {
      return settle(piece, ["pending", "sending"], attempts, { kind: "abandoned", reason }, now);
    },

    /**
     * Delivered rows and their receipts go after `deliveredMs`; abandoned ones stay readable for
     * `abandonedMs`. The highest receipt pruned is remembered, so a reader behind it learns it missed
     * some (`gap`).
     */
    async prune(now: number, deliveredMs: number, abandonedMs: number): Promise<void> {
      await db.run("DELETE FROM outbound_pieces WHERE state = 'delivered' AND settled_at < ?", [now - deliveredMs]);
      await db.run("DELETE FROM outbound_pieces WHERE state = 'abandoned' AND settled_at < ?", [now - abandonedMs]);
      const expired = "(outcome = 'delivered' AND at < ?) OR (outcome = 'abandoned' AND at < ?)";
      const bounds = [now - deliveredMs, now - abandonedMs];
      await db.transaction(async (tx) => {
        const [row] = await tx.query<{ last: number | null }>(`SELECT MAX(seq) AS last FROM outbound_receipts WHERE ${expired}`, bounds);
        if (row?.last == null) return;
        await tx.run(`DELETE FROM outbound_receipts WHERE ${expired}`, bounds);
        const through = (await meta(tx, "receipts_pruned_through")) ?? 0;
        await setMeta(tx, "receipts_pruned_through", Math.max(through, row.last));
      });
    },

    /** `OutboundQueue.receipts.read`: receipts after `after`, and whether some after it were pruned. */
    async readReceipts(after: string | undefined, limit: number): Promise<FeedPage<DeliveryReceipt>> {
      if (!Number.isInteger(limit) || limit < 1) throw new Error(`outbound-durable: limit must be an integer of at least 1, got ${limit}`);
      if (after !== undefined && !/^\d+$/.test(after)) throw new Error(`outbound-durable: "${after}" is not a receipt cursor`);
      const from = after === undefined ? 0 : Number(after);
      // One snapshot: a prune between the two reads would otherwise hide a gap.
      return db.transaction(async (tx) => {
        const rows = await tx.query<ReceiptRow>("SELECT * FROM outbound_receipts WHERE seq > ? ORDER BY seq LIMIT ?", [from, limit]);
        const prunedThrough = (await meta(tx, "receipts_pruned_through")) ?? 0;
        return {
          items: rows.map((row) => ({ cursor: String(row.seq), fact: toReceipt(row) })),
          gap: after !== undefined && from < prunedThrough,
        };
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;

/** `${idempotencyKey}#${index}` back into its parts; the key itself may contain `#`. */
function splitKey(key: string): { idempotencyKey: string; index: number } {
  const hash = key.lastIndexOf("#");
  return { idempotencyKey: key.slice(0, hash), index: Number(key.slice(hash + 1)) };
}

function toReceipt(row: ReceiptRow): DeliveryReceipt {
  return {
    idempotencyKey: row.message_key,
    index: row.piece_index,
    channel: row.channel,
    conversationKey: row.conversation_key,
    attempts: row.attempts,
    outcome:
      row.outcome === "delivered"
        ? { kind: "delivered", platformMessageId: row.platform_message_id ?? "", possibleDuplicate: row.possible_duplicate === 1 }
        : { kind: "abandoned", reason: row.reason ?? "" },
    at: row.at,
  };
}

function toPiece(row: PieceRow): Piece {
  return {
    seq: row.seq,
    key: row.key,
    channel: row.channel,
    conversationKey: row.conversation_key,
    text: row.text,
    state: row.state as PieceState,
    attempts: row.attempts,
    failures: row.failures,
    nextAttemptAt: row.next_attempt_at,
    possibleDuplicate: row.possible_duplicate === 1,
    createdAt: row.created_at,
  };
}
