/**
 * sessions-sql: each conversation's Pi session in the app's SQL database (SPEC §4, C5), so the same
 * project keeps its sessions on a server (SQLite, `storage-sqlite`) and in a Cloudflare Durable
 * Object (its SQL) alike.
 *
 * The store is `@pikit/pi-adapter/sql`'s: Pi's own session (`StorageBackedSession`) over a `Storage`
 * whose every commit is one `storage.sql` transaction, checked by Pi's session conformance suites.
 * This component decides only when it runs: it creates or upgrades the tables at start (the
 * `sessions_sql_*` tables, versioned in `sessions_sql_meta`), and closes the sessions still open at
 * stop. It provides `sessions.store`, which the agent runtime opens conversations from and the
 * conversation registry creates sessions in.
 *
 * A session is open in one process at a time: one server over its database, or the Durable Object
 * that owns the conversation (SPEC C1). Two processes on one session are not detected.
 *
 * Targets: `server` and `cloudflare`: it imports nothing platform-specific, and its storage is
 * whatever provides `storage.sql` there.
 */

import { defineComponent } from "@pikit/core";
import type { SessionStore } from "@pikit/pi-adapter";
import { createSqlSessionStore, type SqlSessionStore } from "@pikit/pi-adapter/sql";
import Type from "typebox";

const Config = Type.Object({
  /**
   * The working directory recorded in each new session, which Pi extensions read as `ctx.cwd`. None
   * by default: they then see `/`.
   */
  cwd: Type.Optional(Type.String({ minLength: 1 })),
});

export default defineComponent({
  name: "sessions-sql",
  config: Config,
  setup(pikit, config) {
    const storage = pikit.use("storage.sql");
    // Opened in start; the capability is a stable facade over it, as consumers resolve it once.
    let store: SqlSessionStore | undefined;
    const current = (): SqlSessionStore => {
      if (store === undefined) throw new Error("sessions-sql: sessions.store used while the app is not running");
      return store;
    };
    const sessions: SessionStore = {
      create: (options, ctx) => current().create(options, ctx),
      open: (metadata, ctx) => current().open(metadata, ctx),
      list: (options, ctx) => current().list(options, ctx),
      // By id, with one query: the runtime opens a conversation's session without listing them all.
      find: (id, ctx) => current().find(id, ctx),
      delete: (metadata, ctx) => current().delete(metadata, ctx),
      fork: (source, options, ctx) => current().fork(source, options, ctx),
    };
    pikit.provide("sessions.store", sessions);

    return {
      async start() {
        const opened = createSqlSessionStore(storage.get(), config.cwd === undefined ? {} : { cwd: config.cwd });
        // Fail at start, not at the first message: tables it cannot create, or a newer schema, stop the app.
        await opened.migrate();
        store = opened;
      },
      async stop(ctx) {
        const closing = store;
        store = undefined;
        await closing?.close(ctx);
      },
    };
  },
});
