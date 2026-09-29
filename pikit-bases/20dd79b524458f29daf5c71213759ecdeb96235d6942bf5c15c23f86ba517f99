/**
 * The submissions' records in `storage.sql`: one row per admitted request, and one per run that settled
 * some (the `answers` feed). All SQL of the component is here.
 *
 * - `submissions_requests`: a request is pending while `answer_seq` is `NULL`, and settled by the run
 *   whose `submissions_answers.seq` it holds. Unique per session and request id, as Pi deduplicates.
 * - `submissions_answers`: one row per run, unique per session and starter, so settling a run twice
 *   appends it once. Its `seq` is the feed's cursor: `AUTOINCREMENT` never reuses an id, and one
 *   writer at a time (SQLite) commits them in order.
 *
 * The dialect is SQLite's (`AUTOINCREMENT`, `ON CONFLICT … DO UPDATE … WHERE`). A Postgres port changes
 * this file only, and must handle:
 * - the feed's cursor: it must follow commit order, which a sequence under concurrent writers does not
 *   (SPEC §4.8);
 * - `INTEGER` is 64-bit in SQLite and 32-bit in Postgres: `settled_at`, `admitted_at` (epoch
 *   milliseconds) and `submissions_meta.value` need `BIGINT`;
 * - the "one snapshot" reads in `get` and `readAnswers` rely on SQLite's transaction being one
 *   snapshot; Postgres' default `READ COMMITTED` takes one per statement, so they need `REPEATABLE READ`;
 * - `migrate` reads the schema version inside each migration's transaction, so two processes starting
 *   at once do not both run the same step. That holds because SQLite's `BEGIN IMMEDIATE` takes the
 *   write lock before the read; Postgres needs a lock of its own (`pg_advisory_xact_lock`, or
 *   `SELECT … FOR UPDATE` on the version row).
 */

import type { ConversationRef, FeedPage, PendingConversation, RunSettlement, SqlDatabase, SqlRow, SqlStatements, SubmissionStatus } from "@pikit/contracts";

interface AnswerRow extends SqlRow {
  seq: number;
  session_id: string;
  request_id: string;
  conversation_key: string;
  agent: string;
  request_ids: string;
  kind: string;
  text: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface RequestRow extends SqlRow {
  session_id: string;
  request_id: string;
  conversation_key: string;
  agent: string;
  admitted_at: number;
  answer_seq: number | null;
}

/**
 * The schema, one step per version. `submissions_meta.schema_version` says how many have run; each runs
 * in its own transaction with the version it reaches, so a database that exists gains what a newer
 * version adds. `PRAGMA user_version` is shared by every component of the app's one database.
 */
const MIGRATIONS: readonly ((tx: SqlStatements) => Promise<void>)[] = [
  async (tx) => {
    await tx.run(`CREATE TABLE submissions_answers (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      agent TEXT NOT NULL,
      request_ids TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT,
      error_code TEXT,
      error_message TEXT,
      settled_at INTEGER NOT NULL,
      UNIQUE (session_id, request_id)
    )`);
    await tx.run(`CREATE TABLE submissions_requests (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      agent TEXT NOT NULL,
      admitted_at INTEGER NOT NULL,
      answer_seq INTEGER,
      UNIQUE (session_id, request_id)
    )`);
    await tx.run("CREATE INDEX submissions_requests_pending ON submissions_requests (answer_seq, seq)");
    await tx.run("CREATE INDEX submissions_answers_settled_at ON submissions_answers (settled_at)");
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function createStore(db: SqlDatabase) {
  const meta = async (sql: SqlStatements, name: string): Promise<number | undefined> =>
    (await sql.query<{ value: number }>("SELECT value FROM submissions_meta WHERE name = ?", [name]))[0]?.value;
  const setMeta = (sql: SqlStatements, name: string, value: number) =>
    sql.run("INSERT INTO submissions_meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value", [name, value]);

  return {
    /**
     * Brings the tables to `SCHEMA_VERSION`. Refuses a database written by a newer component.
     *
     * Each step reads the version in the transaction that runs it: another process starting at the same
     * time may have run it between two steps, or before the first. Read outside, both would run
     * migration 0 and the second would fail on a table that exists (outbound-durable's `migrate`, which
     * this one was copied from, still reads it outside).
     */
    async migrate(): Promise<void> {
      await db.run("CREATE TABLE IF NOT EXISTS submissions_meta (name TEXT PRIMARY KEY, value INTEGER NOT NULL)");
      let done = false;
      while (!done) {
        done = await db.transaction(async (tx) => {
          const version = (await meta(tx, "schema_version")) ?? 0;
          if (version > SCHEMA_VERSION) {
            throw new Error(`submissions-sql: the database is at schema version ${version}, newer than this component's ${SCHEMA_VERSION}; upgrade the component`);
          }
          if (version === SCHEMA_VERSION) return true;
          await (MIGRATIONS[version] as (tx: SqlStatements) => Promise<void>)(tx);
          await setMeta(tx, "schema_version", version + 1);
          return false;
        });
      }
    },

    /** A pending request, unless the session already knows it (pending or settled). */
    async admitted(conversation: ConversationRef, requestId: string, now: number): Promise<void> {
      await db.run(
        `INSERT INTO submissions_requests (session_id, request_id, conversation_key, agent, admitted_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (session_id, request_id) DO NOTHING`,
        [conversation.sessionId, requestId, conversation.key, conversation.agent, now],
      );
    },

    /** The run and the requests it settles, in one transaction; a run already recorded changes nothing. */
    async settled(run: RunSettlement, now: number): Promise<void> {
      const { conversation } = run;
      await db.transaction(async (tx) => {
        const inserted = await tx.run(
          `INSERT INTO submissions_answers (session_id, request_id, conversation_key, agent, request_ids, kind, text, error_code, error_message, settled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, request_id) DO NOTHING`,
          [
            conversation.sessionId,
            run.requestId,
            conversation.key,
            conversation.agent,
            JSON.stringify(run.requestIds),
            run.kind,
            run.text ?? null,
            run.error?.code ?? null,
            run.error?.message ?? null,
            now,
          ],
        );
        if (inserted.changes === 0) return;
        const [answer] = await tx.query<{ seq: number }>("SELECT seq FROM submissions_answers WHERE session_id = ? AND request_id = ?", [
          conversation.sessionId,
          run.requestId,
        ]);
        if (answer === undefined) throw new Error("submissions-sql: a run just recorded cannot be read back");
        for (const requestId of run.requestIds) {
          // A request never admitted (its admission was lost with a crash) is recorded settled; one
          // already settled keeps the run that settled it first.
          await tx.run(
            `INSERT INTO submissions_requests (session_id, request_id, conversation_key, agent, admitted_at, answer_seq)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (session_id, request_id) DO UPDATE SET answer_seq = excluded.answer_seq WHERE submissions_requests.answer_seq IS NULL`,
            [conversation.sessionId, requestId, conversation.key, conversation.agent, now, answer.seq],
          );
        }
      });
    },

    /**
     * Those of `requestIds` still pending, settled unanswered by one run appended to the answers, in one
     * transaction. The run, or `undefined` when none was pending.
     */
    async abandoned(conversation: ConversationRef, requestIds: readonly string[], reason: string, now: number): Promise<RunSettlement | undefined> {
      return db.transaction(async (tx) => {
        const still: string[] = [];
        for (const requestId of new Set(requestIds)) {
          const [row] = await tx.query<{ answer_seq: number | null }>(
            "SELECT answer_seq FROM submissions_requests WHERE session_id = ? AND request_id = ?",
            [conversation.sessionId, requestId],
          );
          if (row !== undefined && row.answer_seq === null) still.push(requestId);
        }
        const [first] = still;
        if (first === undefined) return undefined;
        const run: RunSettlement = { conversation, requestId: first, requestIds: still, kind: "failed", error: { code: "abandoned", message: reason } };
        await tx.run(
          `INSERT INTO submissions_answers (session_id, request_id, conversation_key, agent, request_ids, kind, text, error_code, error_message, settled_at)
           VALUES (?, ?, ?, ?, ?, 'failed', NULL, 'abandoned', ?, ?)`,
          [conversation.sessionId, first, conversation.key, conversation.agent, JSON.stringify(still), reason, now],
        );
        const [answer] = await tx.query<{ seq: number }>("SELECT seq FROM submissions_answers WHERE session_id = ? AND request_id = ?", [
          conversation.sessionId,
          first,
        ]);
        if (answer === undefined) throw new Error("submissions-sql: a run just recorded cannot be read back");
        for (const requestId of still) {
          await tx.run("UPDATE submissions_requests SET answer_seq = ? WHERE session_id = ? AND request_id = ?", [answer.seq, conversation.sessionId, requestId]);
        }
        return run;
      });
    },

    /** Requests with no run yet, grouped by session, in admission order. */
    async pending(): Promise<PendingConversation[]> {
      const rows = await db.query<RequestRow>(
        "SELECT session_id, request_id, conversation_key, agent, admitted_at, answer_seq FROM submissions_requests WHERE answer_seq IS NULL ORDER BY seq",
      );
      const bySession = new Map<string, PendingConversation>();
      for (const row of rows) {
        const entry = bySession.get(row.session_id) ?? { conversation: conversationOf(row), requestIds: [], oldestAdmittedAt: row.admitted_at };
        entry.requestIds.push(row.request_id);
        entry.oldestAdmittedAt = Math.min(entry.oldestAdmittedAt, row.admitted_at);
        bySession.set(row.session_id, entry);
      }
      return [...bySession.values()];
    },

    async get(sessionId: string, requestId: string): Promise<SubmissionStatus | undefined> {
      // One snapshot: a prune between the two reads would otherwise show a settled request with no run.
      return db.transaction(async (tx) => {
        const [request] = await tx.query<RequestRow>(
          "SELECT session_id, request_id, conversation_key, agent, admitted_at, answer_seq FROM submissions_requests WHERE session_id = ? AND request_id = ?",
          [sessionId, requestId],
        );
        if (request === undefined) return undefined;
        const base = { conversation: conversationOf(request), requestId };
        if (request.answer_seq === null) return { kind: "pending", ...base };
        const [answer] = await tx.query<AnswerRow>("SELECT * FROM submissions_answers WHERE seq = ?", [request.answer_seq]);
        return answer === undefined ? undefined : { kind: "settled", ...base, run: settlementOf(answer) };
      });
    },

    /**
     * Runs settled before `before`, and the requests they settled, go. Pending requests stay, whatever
     * their age: nothing answered them yet. The highest run pruned is remembered, so a reader behind it
     * learns it missed some (`gap`).
     */
    async prune(before: number): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = await tx.query<{ last: number | null }>("SELECT MAX(seq) AS last FROM submissions_answers WHERE settled_at < ?", [before]);
        if (row?.last == null) return;
        await tx.run("DELETE FROM submissions_requests WHERE answer_seq IN (SELECT seq FROM submissions_answers WHERE settled_at < ?)", [before]);
        await tx.run("DELETE FROM submissions_answers WHERE settled_at < ?", [before]);
        const through = (await meta(tx, "answers_pruned_through")) ?? 0;
        await setMeta(tx, "answers_pruned_through", Math.max(through, row.last));
      });
    },

    /** `answers.read`: runs after `after`, and whether some after it were pruned. */
    async readAnswers(after: string | undefined, limit: number): Promise<FeedPage<RunSettlement>> {
      if (!Number.isInteger(limit) || limit < 1) throw new Error(`submissions-sql: limit must be an integer of at least 1, got ${limit}`);
      if (after !== undefined && !/^\d+$/.test(after)) throw new Error(`submissions-sql: "${after}" is not an answers cursor`);
      const from = after === undefined ? 0 : Number(after);
      // One snapshot: a prune between the two reads would otherwise hide a gap.
      return db.transaction(async (tx) => {
        const rows = await tx.query<AnswerRow>("SELECT * FROM submissions_answers WHERE seq > ? ORDER BY seq LIMIT ?", [from, limit]);
        const prunedThrough = (await meta(tx, "answers_pruned_through")) ?? 0;
        return {
          items: rows.map((row) => ({ cursor: String(row.seq), fact: settlementOf(row) })),
          gap: after !== undefined && from < prunedThrough,
        };
      });
    },
  };
}

export type Store = ReturnType<typeof createStore>;

function conversationOf(row: { session_id: string; conversation_key: string; agent: string }): ConversationRef {
  return { key: row.conversation_key, agent: row.agent, sessionId: row.session_id };
}

function settlementOf(row: AnswerRow): RunSettlement {
  return {
    conversation: conversationOf(row),
    requestId: row.request_id,
    requestIds: JSON.parse(row.request_ids) as string[],
    kind: row.kind as RunSettlement["kind"],
    ...(row.text !== null && { text: row.text }),
    ...(row.error_code !== null && { error: { code: row.error_code, message: row.error_message ?? "" } }),
  };
}
