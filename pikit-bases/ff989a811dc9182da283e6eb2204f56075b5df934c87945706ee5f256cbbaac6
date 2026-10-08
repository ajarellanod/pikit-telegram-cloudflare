/**
 * On Cloudflare the connection is one object's, the github-app object (`GITHUB_APP_KEY`, an object of
 * the conversations' class that is never a conversation, as settings-store's is), reached by
 * `actor.mailbox.call` and answered with `actor.inbox.answer` over its store (`store.ts`):
 *
 * | Type | Message | Answer |
 * |---|---|---|
 * | `github-app.start` | `{ origin, organization?, operator }` | `{ action, manifest, nonce }` |
 * | `github-app.connect` | `{ state, nonce?, operator, code }` | `{ slug, installUrl }` |
 * | `github-app.install` | `{ installationId, operator }` | `GitHubAppStatus` |
 * | `github-app.choose` | `{ repository, operator }` | `GitHubAppStatus` |
 * | `github-app.status` | `{ check }` | `GitHubAppStatus` |
 * | `github-app.disconnect` | `{ operator }` | `{ settingsUrl? }` |
 * | `github-app.repository` | — | `{ repository? }` |
 * | `github-app.token` | — | `{ token, expiresAt, repository }` |
 *
 * A refusal is an `ActorCallError` whose code is the store's (`api.ts`), `not_connected` included,
 * which `createRemoteGitHub` turns back into `GitHubNotConnectedError`.
 *
 * Every App (the Worker's, each conversation's object, the github-app object itself) reads `github`
 * through calls (`createRemoteGitHub`), keeping an answer `FRESH_MS` (concurrent reads share one call):
 * the github-app object keeps the token itself until shortly before it expires, so the deployment
 * mints one an hour, and a disconnect applies to every App's next call past that second.
 */

import type { AppContext, Clock } from "@pikit/core";
import { ActorCallError, type ActorInbox, type ActorMailbox, type GitHubAccess, GitHubNotConnectedError, isJsonObject, type JsonValue } from "@pikit/contracts";
import type { GitHubAppStatus, StartResponse } from "./api.ts";
import type { AppStore } from "./store.ts";

/** The object that keeps the connection: of the conversations' class, never a conversation. */
export const GITHUB_APP_KEY = "github-app:credentials";

export const CALL = {
  start: "github-app.start",
  connect: "github-app.connect",
  install: "github-app.install",
  choose: "github-app.choose",
  status: "github-app.status",
  disconnect: "github-app.disconnect",
  repository: "github-app.repository",
  token: "github-app.token",
} as const;

/** How long an App answers `github` from what it read last, before it calls again. */
export const FRESH_MS = 1_000;

type Fields = Record<string, unknown>;
const fieldsOf = (message: JsonValue): Fields => (isJsonObject(message) ? message : {});
const text = (fields: Fields, name: string, optional = false): string | undefined => {
  const value = fields[name];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value === "") throw new ActorCallError("invalid_request", `github-app: "${name}" is a non-empty string`);
  return value;
};
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

/** Registers the github-app object's answers over `store`. Every object registers them; only that object is called. Call it in `start`. */
export function answerCalls(inbox: ActorInbox, store: AppStore): void {
  inbox.answer(CALL.start, async (_key, message, ctx) => {
    const fields = fieldsOf(message);
    const organization = text(fields, "organization", true);
    return json(await store.start({ origin: text(fields, "origin") as string, operator: text(fields, "operator") as string, ...(organization !== undefined && { organization }) }, ctx.logger));
  });
  inbox.answer(CALL.connect, async (_key, message, ctx) => {
    const fields = fieldsOf(message);
    return json(await store.connect({ state: text(fields, "state") as string, nonce: text(fields, "nonce", true), operator: text(fields, "operator") as string, code: text(fields, "code") as string }, ctx.logger));
  });
  inbox.answer(CALL.install, async (_key, message, ctx) => {
    const fields = fieldsOf(message);
    const id = fields.installationId;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new ActorCallError("invalid_request", 'github-app: "installationId" is a positive integer');
    return json(await store.install({ installationId: id, operator: text(fields, "operator") as string }, ctx.logger));
  });
  inbox.answer(CALL.choose, async (_key, message, ctx) => {
    const fields = fieldsOf(message);
    return json(await store.choose({ repository: text(fields, "repository") as string, operator: text(fields, "operator") as string }, ctx.logger));
  });
  inbox.answer(CALL.status, async (_key, message) => json(await store.status(fieldsOf(message).check === true)));
  inbox.answer(CALL.disconnect, async (_key, message, ctx) => json(await store.disconnect({ operator: text(fieldsOf(message), "operator") as string }, ctx.logger)));
  inbox.answer(CALL.repository, async () => {
    const repository = await store.repository();
    return repository === undefined ? {} : { repository };
  });
  inbox.answer(CALL.token, async () => {
    try {
      return json(await store.token());
    } catch (error) {
      if (error instanceof GitHubNotConnectedError) throw new ActorCallError("not_connected", error.message);
      throw error;
    }
  });
}

/** A call to the github-app object. */
async function call(mailbox: () => ActorMailbox | undefined, type: string, message: JsonValue, ctx: AppContext): Promise<Fields> {
  const calls = mailbox();
  if (calls === undefined) throw new Error("github-app: the github-app object is reached through actor.mailbox: install platform-cloudflare");
  return fieldsOf(await calls.call(GITHUB_APP_KEY, type, message, ctx));
}

/** `github` for any App of the deployment: calls to the github-app object, each answer kept `freshMs`. */
export function createRemoteGitHub(mailbox: () => ActorMailbox | undefined, clock: Clock, freshMs = FRESH_MS): GitHubAccess {
  /** One read of `type`, kept `freshMs`, shared while it runs. */
  const kept = <T>(type: string, read: (fields: Fields) => T) => {
    let held: { value: T; at: number } | undefined;
    let reading: Promise<T> | undefined;
    return (ctx: AppContext): Promise<T> => {
      if (held !== undefined && clock.now() - held.at < freshMs) return Promise.resolve(held.value);
      reading ??= call(mailbox, type, null, ctx)
        .then((fields) => {
          const value = read(fields);
          held = { value, at: clock.now() };
          return value;
        })
        .finally(() => {
          reading = undefined;
        });
      return reading;
    };
  };
  const repository = kept(CALL.repository, (fields) => (typeof fields.repository === "string" ? fields.repository : undefined));
  const token = kept(CALL.token, (fields) => {
    if (typeof fields.token !== "string") throw new Error("github-app: the github-app object answered no token");
    return fields.token;
  });
  return {
    repository,
    async token(ctx) {
      try {
        return await token(ctx);
      } catch (error) {
        if (error instanceof ActorCallError && error.code === "not_connected") throw new GitHubNotConnectedError(error.message);
        throw error;
      }
    },
  };
}

/** What the Worker's routes ask the github-app object. */
export interface RemoteAdmin {
  start(input: { origin: string; organization?: string; operator: string }, ctx: AppContext): Promise<StartResponse & { nonce: string }>;
  connect(input: { state: string; nonce?: string; operator: string; code: string }, ctx: AppContext): Promise<{ slug: string; installUrl: string }>;
  install(input: { installationId: number; operator: string }, ctx: AppContext): Promise<GitHubAppStatus>;
  choose(input: { repository: string; operator: string }, ctx: AppContext): Promise<GitHubAppStatus>;
  status(check: boolean, ctx: AppContext): Promise<GitHubAppStatus>;
  disconnect(operator: string, ctx: AppContext): Promise<{ settingsUrl?: string }>;
}

export function createRemoteAdmin(mailbox: () => ActorMailbox | undefined): RemoteAdmin {
  const ask = <T>(type: string, message: unknown, ctx: AppContext) => call(mailbox, type, json(message), ctx) as Promise<T>;
  return {
    start: (input, ctx) => ask(CALL.start, input, ctx),
    connect: (input, ctx) => ask(CALL.connect, input, ctx),
    install: (input, ctx) => ask(CALL.install, input, ctx),
    choose: (input, ctx) => ask(CALL.choose, input, ctx),
    status: (check, ctx) => ask(CALL.status, { check }, ctx),
    disconnect: (operator, ctx) => ask(CALL.disconnect, { operator }, ctx),
  };
}
