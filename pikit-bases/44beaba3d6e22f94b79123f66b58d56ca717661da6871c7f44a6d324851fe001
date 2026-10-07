/**
 * The conversation index: every conversation admin-api has seen, and when each was last active, so the
 * list is newest activity first and paged on every host (features/cloudflare-conversation-index.md).
 * The runtime keeps no such order (`agent.observe` lists in creation order).
 *
 * It is a table, `admin_api_conversations` in `storage.sql`, of one row per conversation: its key, its
 * id in the runtime, its agent, and the time of the newest activity seen.
 * - **On a server** it is the App's own `storage.sql`; admin-api writes it from the runtime's events.
 * - **On Cloudflare** it is the `storage.sql` of one object, `admin-api:index` (`INDEX_KEY`), of the
 *   conversations' class: each conversation's object sends it `admin-api.seen`, and the Worker asks it
 *   `admin-api.list`. A row's id is then the object's own (`1`), which only its key makes unique.
 *
 * **When a row is written** (`index.ts`): when a message is dispatched (in the caller's context, once
 * it is durable), when a run starts, settles or fails, when a reset points a key to a new
 * conversation, and when the App starts, from what `agent.observe` holds (a server's every
 * conversation, in the background; an object's own): so a conversation made before admin-api was
 * installed, or whose events were missed (SPEC K3), is listed once its App starts again.
 *
 * `seen` is an upsert: sent twice, or late, it changes nothing a newer one wrote.
 *
 * **Archived and deleted.** The operator puts a conversation away (`hide`): a third table,
 * `admin_api_hidden`, holds one row per conversation put away, with how (`archived`: listed apart,
 * restorable; `deleted`: never listed again) and its activity then. New activity brings it back to
 * the list by itself (a person wrote again: the operator must see it); a start's backfill, which
 * brings no newer activity, does not. Nothing of the runtime's is deleted: pi-durable keeps every
 * conversation (docs/upstream, "Delete a conversation").
 *
 * **Titles.** A title names a key, so the conversations a reset left behind share it with the key's
 * current one: a second table of the same storage, `admin_api_titles`, holds one row per key (its
 * title, whose it is, the text a model is asked to title, the model's tries). On a server it is the
 * App's; on Cloudflare the conversation's own object's (where its runs settle and `/name` runs, and
 * whose answer the Worker's list reads): the index object holds none.
 * - A model titles a key once, after its first run (`titling` claims a try, at most `TITLE_TRIES`,
 *   and keeps the text to title; `titled` writes the answer unless the operator named it meanwhile).
 * - The operator's title (`/name`) replaces any, and a model never replaces it.
 */

import type { SqlDatabase } from "@pikit/contracts";
import { refusal } from "./backend.ts";

/** The actor that keeps the index on Cloudflare: an object of the conversations' class, never a conversation. */
export const INDEX_KEY = "admin-api:index";
const TABLE = "admin_api_conversations";
const TITLES = "admin_api_titles";
const HIDDEN = "admin_api_hidden";

/** How the operator put a conversation away. */
export type Hidden = "archived" | "deleted";
/** A model is asked to title a key at most this often: once, and once more if that failed. */
export const TITLE_TRIES = 2;

/** One conversation the index knows. */
export interface IndexedConversation {
  key: string;
  /** The runtime's id: on Cloudflare its object's own, unique with its key. */
  conversationId: string;
  agent: string;
  /** Epoch ms of the newest activity seen. */
  at: number;
}

export interface IndexPage {
  items: IndexedConversation[];
  next?: string;
}

export interface ConversationIndex {
  /** Records each entry, unless the index already has a newer time for its conversation. */
  seen(entries: readonly IndexedConversation[]): Promise<void>;
  /**
   * At most `limit` conversations, the most recently active first: those listed (not put away), or
   * with `archived` those archived. Throws `invalid_cursor`.
   */
  list(page: { limit: number; cursor?: string; archived?: boolean }): Promise<IndexPage>;
  /**
   * Puts conversation `conversationId` of `key` away (`archived`, `deleted`) as of its activity now, or
   * back in the list (`undefined`). `false` when the index has no such conversation.
   */
  hide(key: string, conversationId: string, how: Hidden | undefined): Promise<boolean>;
  /**
   * The key of conversation `conversationId`, its newest row's: a server's ids are unique (on
   * Cloudflare an object's are not, and only the index object has rows).
   */
  keyOf(conversationId: string): Promise<string | undefined>;
  /** The title of `key`, a model's or the operator's; `undefined` until it has one. */
  title(key: string): Promise<string | undefined>;
  /** The operator's title for `key` (`/name`): it replaces any, and no model replaces it. */
  name(key: string, title: string): Promise<void>;
  /**
   * Claims a model's try at titling `key`, `input` its first message: the text to title (kept from the
   * first claim, which a retry titles too). `undefined` when `key` has a title, or had its tries.
   */
  titling(key: string, input: string): Promise<{ input: string } | undefined>;
  /** A model's title for `key`: written unless it has one (the operator named it meanwhile). */
  titled(key: string, title: string): Promise<void>;
}

/** `{at}:{key}:{conversationId}` of a page's last item, the key and id URI-encoded (`:` never appears in them). */
const cursorOf = ({ at, key, conversationId }: IndexedConversation): string => `${at}:${encodeURIComponent(key)}:${encodeURIComponent(conversationId)}`;

function parseCursor(cursor: string): { at: number; key: string; conversationId: string } {
  const parts = cursor.split(":");
  if (parts.length === 3 && /^[0-9]+$/.test(parts[0] as string)) {
    try {
      return { at: Number(parts[0]), key: decodeURIComponent(parts[1] as string), conversationId: decodeURIComponent(parts[2] as string) };
    } catch {
      // Not ours: below.
    }
  }
  throw refusal("invalid_cursor", "the cursor is not one this API gave");
}

/** The index over `sql()` (`storage.sql`); its table is made at the first use. */
export function createConversationIndex(sql: () => SqlDatabase): ConversationIndex {
  let ready: Promise<void> | undefined;
  const db = async (): Promise<SqlDatabase> => {
    const database = sql();
    ready ??= (async () => {
      await database.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT NOT NULL, conversation TEXT NOT NULL, agent TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (key, conversation))`,
      );
      await database.run(`CREATE INDEX IF NOT EXISTS ${TABLE}_at ON ${TABLE} (at, key, conversation)`);
      await database.run(`CREATE INDEX IF NOT EXISTS ${TABLE}_conversation ON ${TABLE} (conversation)`);
      await database.run(
        `CREATE TABLE IF NOT EXISTS ${TITLES} (key TEXT PRIMARY KEY, title TEXT, source TEXT, input TEXT, tries INTEGER NOT NULL DEFAULT 0)`,
      );
      await database.run(
        `CREATE TABLE IF NOT EXISTS ${HIDDEN} (key TEXT NOT NULL, conversation TEXT NOT NULL, how TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (key, conversation))`,
      );
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    await ready;
    return database;
  };

  return {
    async seen(entries) {
      if (entries.length === 0) return;
      const database = await db();
      await database.transaction(async (tx) => {
        for (const { key, conversationId, agent, at } of entries) {
          await tx.run(
            `INSERT INTO ${TABLE} (key, conversation, agent, at) VALUES (?, ?, ?, ?) ON CONFLICT (key, conversation) DO UPDATE SET ` +
              `agent = CASE WHEN excluded.at >= ${TABLE}.at THEN excluded.agent ELSE ${TABLE}.agent END, ` +
              `at = CASE WHEN excluded.at > ${TABLE}.at THEN excluded.at ELSE ${TABLE}.at END`,
            [key, conversationId, agent, Math.max(0, Math.floor(at))],
          );
        }
      });
    },

    async list({ limit, cursor, archived = false }) {
      const after = cursor === undefined ? undefined : parseCursor(cursor);
      // Put away while no newer activity came: archived ones listed apart, deleted ones never.
      const away = `h.how IS NOT NULL AND h.at >= c.at`;
      const rows = await (await db()).query<{ key: string; conversation: string; agent: string; at: number }>(
        `SELECT c.key AS key, c.conversation AS conversation, c.agent AS agent, c.at AS at FROM ${TABLE} c ` +
          `LEFT JOIN ${HIDDEN} h ON h.key = c.key AND h.conversation = c.conversation ` +
          `WHERE ${archived ? `${away} AND h.how = 'archived'` : `NOT (${away})`}` +
          (after === undefined ? "" : " AND (c.at < ? OR (c.at = ? AND (c.key > ? OR (c.key = ? AND c.conversation > ?))))") +
          " ORDER BY c.at DESC, c.key ASC, c.conversation ASC LIMIT ?",
        after === undefined ? [limit + 1] : [after.at, after.at, after.key, after.key, after.conversationId, limit + 1],
      );
      const items = rows.slice(0, limit).map(({ key, conversation, agent, at }) => ({ key, conversationId: conversation, agent, at: Number(at) }));
      const last = items.at(-1);
      return { items, ...(rows.length > limit && last !== undefined && { next: cursorOf(last) }) };
    },

    async hide(key, conversationId, how) {
      const database = await db();
      return database.transaction(async (tx) => {
        const [row] = await tx.query<{ at: number }>(`SELECT at FROM ${TABLE} WHERE key = ? AND conversation = ?`, [key, conversationId]);
        if (row === undefined) return false;
        if (how === undefined) await tx.run(`DELETE FROM ${HIDDEN} WHERE key = ? AND conversation = ?`, [key, conversationId]);
        else {
          await tx.run(
            `INSERT INTO ${HIDDEN} (key, conversation, how, at) VALUES (?, ?, ?, ?) ON CONFLICT (key, conversation) DO UPDATE SET how = excluded.how, at = excluded.at`,
            [key, conversationId, how, Number(row.at)],
          );
        }
        return true;
      });
    },

    async keyOf(conversationId) {
      const rows = await (await db()).query<{ key: string }>(`SELECT key FROM ${TABLE} WHERE conversation = ? ORDER BY at DESC LIMIT 1`, [conversationId]);
      return rows[0]?.key;
    },

    async title(key) {
      const rows = await (await db()).query<{ title: string | null }>(`SELECT title FROM ${TITLES} WHERE key = ?`, [key]);
      return rows[0]?.title ?? undefined;
    },

    async name(key, title) {
      await (await db()).run(
        `INSERT INTO ${TITLES} (key, title, source) VALUES (?, ?, 'operator') ON CONFLICT (key) DO UPDATE SET title = excluded.title, source = 'operator'`,
        [key, title],
      );
    },

    async titling(key, input) {
      const database = await db();
      return database.transaction(async (tx) => {
        const [row] = await tx.query<{ title: string | null; input: string | null; tries: number }>(`SELECT title, input, tries FROM ${TITLES} WHERE key = ?`, [key]);
        if (row !== undefined && (row.title !== null || Number(row.tries) >= TITLE_TRIES)) return undefined;
        await tx.run(
          `INSERT INTO ${TITLES} (key, input, tries) VALUES (?, ?, 1) ON CONFLICT (key) DO UPDATE SET tries = ${TITLES}.tries + 1, input = COALESCE(${TITLES}.input, excluded.input)`,
          [key, input],
        );
        return { input: row?.input ?? input };
      });
    },

    async titled(key, title) {
      await (await db()).run(`UPDATE ${TITLES} SET title = ?, source = 'model' WHERE key = ? AND title IS NULL`, [title, key]);
    },
  };
}
