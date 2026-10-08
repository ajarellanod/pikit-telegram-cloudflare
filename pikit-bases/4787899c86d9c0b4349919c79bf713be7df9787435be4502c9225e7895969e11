/**
 * The GitHub App's connection, kept and used by one object: the github-app object (`GITHUB_APP_KEY`,
 * `calls.ts`), which every other App reaches through `actor.mailbox`. Its tables, in that object's
 * `storage.sql`:
 *
 * - `github_app_states`: each connection started and not finished: the digests of its `state` and of
 *   its browser's nonce, the operator who started it, until when (`STATE_MS`). Single-use: the
 *   callback deletes it before anything else, whatever comes of it.
 * - `github_app`: one row, the App: its id, slug, client id, owner and page in the clear; its private
 *   key, client secret and webhook secret sealed (`crypto.ts`, AES-GCM with a key derived from the
 *   admin token); its installation, the repositories it reaches, the one chosen; the last token minted
 *   or the last failure.
 *
 * Tokens are minted here (`token`): the App's JWT, then `POST /app/installations/{id}/access_tokens`
 * for the chosen repository alone, kept in memory until `REFRESH_MS` before GitHub's expiry, so every
 * caller of the deployment shares one. Errors are `ActorCallError`s whose code says why
 * (`api.ts`'s `GitHubAppError`), crossing a call whole; none holds a token or a key.
 */

import type { Clock, Logger } from "@pikit/core";
import { ActorCallError, GITHUB_REPOSITORY, GITHUB_TOKEN_MIN_LIFE_MS, GitHubNotConnectedError, type SecretStore, type SqlDatabase } from "@pikit/contracts";
import type { GitHubAppStatus, StartResponse } from "./api.ts";
import { appJwt, credentialsKey, randomToken, seal, sha256, unseal } from "./crypto.ts";

/** GitHub's site and API. */
export const GITHUB_WEB = "https://github.com";
export const GITHUB_API = "https://api.github.com";
/** How long a started connection waits for GitHub's callback. */
export const STATE_MS = 15 * 60 * 1000;
/** A token is minted again this long before GitHub's expiry (an hour after it is made). */
export const REFRESH_MS = GITHUB_TOKEN_MIN_LIFE_MS + 60 * 1000;
/** How long one call to GitHub may take. */
const TIMEOUT_MS = 15_000;
/** GitHub App names: at most 34 characters. */
const NAME_MAX = 34;
/** The permissions the App asks for: push its branches, open, merge and close pull requests, read their checks. */
export const PERMISSIONS = { contents: "write", pull_requests: "write", checks: "read", statuses: "read", metadata: "read" } as const;

const STATES = "github_app_states";
const TABLE = "github_app";

export interface AppStoreOptions {
  sql(): SqlDatabase;
  secrets(): SecretStore;
  /** The secret the credentials' key is derived from: the admin token (`PIKIT_ADMIN_TOKEN`). */
  keySecret: string;
  clock: Clock;
}

/** The sealed part of the App's credentials. */
interface Sealed {
  pem: string;
  clientSecret: string;
  webhookSecret: string | null;
}

interface Row {
  app_id: number;
  slug: string;
  name: string;
  client_id: string;
  owner: string;
  owner_type: string;
  html_url: string;
  sealed: string;
  installation_id: number | null;
  installation_account: string | null;
  repositories: string | null;
  repository: string | null;
  last_token_at: number | null;
  last_token_error: string | null;
}

const refusal = (code: string, message: string) => new ActorCallError(code, message);

/** `pikit-<worker>` from the host the dashboard is reached at (`<worker>.<account>.workers.dev`, or a domain). */
export function appNameOf(host: string): string {
  const labels = host.toLowerCase().replace(/:\d+$/, "").replace(/\.workers\.dev$/, "").split(".");
  const base = (host.toLowerCase().endsWith(".workers.dev") ? labels.join("-") : (labels[0] ?? "")).replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = base.startsWith("pikit") ? base : `pikit-${base}`;
  return name.slice(0, NAME_MAX).replace(/-+$/, "") || "pikit";
}

/** The manifest GitHub creates the App from (https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest). */
export function manifestOf(origin: string): Record<string, unknown> {
  const host = new URL(origin).host;
  return {
    name: appNameOf(host),
    url: origin,
    description: `The pikit agent at ${host}: it proposes changes to itself as pull requests, which its operator approves from the dashboard.`,
    redirect_url: `${origin}/admin/api/github-app/callback`,
    setup_url: `${origin}/admin/api/github-app/setup`,
    setup_on_update: true,
    public: false,
    // No webhooks: the app asks GitHub when it needs to.
    hook_attributes: { url: origin, active: false },
    default_permissions: PERMISSIONS,
    default_events: [],
  };
}

/** GitHub's answer to one call, or a `github_refused` saying what it answered (never a credential). */
async function github<T>(method: string, path: string, authorization: string | undefined, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "pikit-github-app",
        ...(authorization !== undefined && { authorization }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw refusal("github_refused", `GitHub did not answer ${method} ${path.split("?")[0]} (${error instanceof Error && error.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : "unreachable"})`);
  }
  if (!response.ok) {
    const answer = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
    const message = typeof answer?.message === "string" ? answer.message.slice(0, 300) : `HTTP ${response.status}`;
    throw refusal("github_refused", `GitHub answered ${response.status} to ${method} ${path.split("?")[0]}: ${message}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export type AppStore = ReturnType<typeof createAppStore>;

export function createAppStore(options: AppStoreOptions) {
  const { clock } = options;
  let ready: Promise<void> | undefined;
  /** The token minted last, for the repository and installation it was minted for. */
  let cached: { token: string; expiresAt: number; repository: string; installation: number } | undefined;

  const db = async (): Promise<SqlDatabase> => {
    const sql = options.sql();
    ready ??= (async () => {
      await sql.run(`CREATE TABLE IF NOT EXISTS ${STATES} (state_hash TEXT PRIMARY KEY, nonce_hash TEXT NOT NULL, operator TEXT NOT NULL, organization TEXT, expires_at BIGINT NOT NULL)`);
      await sql.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY, app_id BIGINT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, client_id TEXT NOT NULL, owner TEXT NOT NULL, owner_type TEXT NOT NULL, html_url TEXT NOT NULL, sealed TEXT NOT NULL, ` +
          "installation_id BIGINT, installation_account TEXT, repositories TEXT, repository TEXT, operator TEXT NOT NULL, connected_at BIGINT NOT NULL, last_token_at BIGINT, last_token_error TEXT)",
      );
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    await ready;
    return sql;
  };

  const row = async (): Promise<Row | undefined> => (await (await db()).query(`SELECT * FROM ${TABLE} WHERE id = 1`))[0] as unknown as Row | undefined;

  const key = async (): Promise<CryptoKey> => {
    const secret = await options.secrets().get(options.keySecret);
    if (secret === undefined) throw refusal("key_changed", `${options.keySecret} is not set: github-app seals the App's credentials with a key derived from it`);
    return credentialsKey(secret);
  };

  /** The sealed credentials, or `key_changed` when the admin token is not the one they were sealed with. */
  const credentials = async (found: Row): Promise<Sealed> => {
    try {
      return JSON.parse(await unseal(await key(), found.sealed)) as Sealed;
    } catch (error) {
      if (error instanceof ActorCallError) throw error;
      throw refusal("key_changed", `The GitHub App's credentials cannot be read: ${options.keySecret} changed since GitHub was connected. Disconnect, then connect again (and delete the old App on GitHub)`);
    }
  };

  const jwtOf = async (found: Row): Promise<string> => `Bearer ${await appJwt((await credentials(found)).pem, found.client_id, clock.now())}`;

  const ownerPath = (found: Pick<Row, "owner" | "owner_type">) => (found.owner_type === "Organization" ? `${GITHUB_WEB}/organizations/${found.owner}/settings` : `${GITHUB_WEB}/settings`);

  /** A token of the installation: for `repository` alone, or for all it reaches (to list them). */
  const mint = async (found: Row, installation: number, repository?: string) => {
    const body = repository === undefined ? {} : { repositories: [repository.split("/")[1] as string] };
    const minted = await github<{ token: string; expires_at: string }>("POST", `/app/installations/${installation}/access_tokens`, await jwtOf(found), body);
    return { token: minted.token, expiresAt: Date.parse(minted.expires_at) };
  };

  /** The installation's repositories, read with a token of it. */
  const repositoriesOf = async (found: Row, installation: number): Promise<string[]> => {
    const { token } = await mint(found, installation);
    const listed = await github<{ repositories: { full_name: string }[] }>("GET", "/installation/repositories?per_page=100", `Bearer ${token}`);
    return listed.repositories.map((repository) => repository.full_name);
  };

  const recordToken = async (error: string | undefined) => {
    await (await db()).run(`UPDATE ${TABLE} SET last_token_at = ?, last_token_error = ? WHERE id = 1`, [Math.floor(clock.now()), error ?? null]);
  };

  /** A token for the chosen repository: the one kept while it lasts, else a new one. */
  const token = async (): Promise<{ token: string; expiresAt: number; repository: string }> => {
    const found = await row();
    if (found === undefined || found.installation_id === null || found.repository === null) {
      throw new GitHubNotConnectedError(
        found === undefined
          ? "GitHub is not connected: connect it from the dashboard's Settings → GitHub"
          : found.installation_id === null
            ? `GitHub is not connected: install the GitHub App ${found.slug} on the project's repository (the dashboard's Settings → GitHub)`
            : "GitHub is not connected: choose the project's repository in the dashboard's Settings → GitHub",
      );
    }
    const { repository, installation_id: installation } = found;
    if (cached !== undefined && cached.repository === repository && cached.installation === installation && cached.expiresAt - clock.now() > REFRESH_MS) {
      return { token: cached.token, expiresAt: cached.expiresAt, repository };
    }
    try {
      const minted = await mint(found, installation, repository);
      cached = { ...minted, repository, installation };
      await recordToken(undefined);
      return { ...minted, repository };
    } catch (error) {
      cached = undefined;
      await recordToken(error instanceof Error ? error.message : String(error)).catch(() => {});
      throw error;
    }
  };

  const status = async (check: boolean): Promise<GitHubAppStatus> => {
    let found = await row();
    if (found === undefined) return { connected: false };
    let problem: string | undefined;
    try {
      await credentials(found);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (check && problem === undefined && found.installation_id !== null) {
      // Live: the repositories it reaches now, and a token minted for the chosen one.
      const installation = found.installation_id;
      const repositories = await repositoriesOf(found, installation).catch(() => undefined);
      if (repositories !== undefined) {
        const repository = found.repository !== null && repositories.some((each) => each.toLowerCase() === found?.repository?.toLowerCase()) ? found.repository : repositories.length === 1 ? (repositories[0] as string) : null;
        await (await db()).run(`UPDATE ${TABLE} SET repositories = ?, repository = ? WHERE id = 1`, [JSON.stringify(repositories), repository]);
      }
      await token().catch(() => {});
      found = (await row()) ?? found;
    }
    const repositories = found.repositories === null ? [] : (JSON.parse(found.repositories) as string[]);
    return {
      connected: problem === undefined && found.installation_id !== null && found.repository !== null,
      app: {
        id: Number(found.app_id),
        slug: found.slug,
        name: found.name,
        owner: found.owner,
        url: found.html_url,
        settingsUrl: `${ownerPath(found)}/apps/${found.slug}/advanced`,
        installUrl: `${GITHUB_WEB}/apps/${found.slug}/installations/new`,
      },
      ...(found.installation_id !== null && {
        installation: {
          id: Number(found.installation_id),
          account: found.installation_account ?? found.owner,
          repositories,
          url: `${ownerPath({ owner: found.installation_account ?? found.owner, owner_type: found.owner_type })}/installations/${found.installation_id}`,
        },
      }),
      ...(found.repository !== null && { repository: found.repository }),
      ...(found.last_token_at !== null && { lastToken: { at: Number(found.last_token_at), ok: found.last_token_error === null, ...(found.last_token_error !== null && { error: found.last_token_error }) } }),
      ...(problem !== undefined && { problem }),
    };
  };

  return {
    /** Starts a connection for `operator` from `origin`: the form to post to GitHub, and the nonce for this browser's cookie. */
    async start(input: { origin: string; organization?: string; operator: string }, logger: Logger): Promise<StartResponse & { nonce: string }> {
      if (input.organization !== undefined && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(input.organization)) throw refusal("invalid_request", "organization is a GitHub organization's login");
      if ((await row()) !== undefined) throw refusal("already_connected", "A GitHub App is connected already: disconnect it first");
      const state = randomToken();
      const nonce = randomToken();
      const sql = await db();
      const now = Math.floor(clock.now());
      await sql.run(`DELETE FROM ${STATES} WHERE expires_at < ?`, [now]);
      await sql.run(`INSERT INTO ${STATES} (state_hash, nonce_hash, operator, organization, expires_at) VALUES (?, ?, ?, ?, ?)`, [
        await sha256(state),
        await sha256(nonce),
        input.operator,
        input.organization ?? null,
        now + STATE_MS,
      ]);
      logger.info("github-app: connection started", { operator: input.operator, ...(input.organization !== undefined && { organization: input.organization }) });
      const where = input.organization === undefined ? `${GITHUB_WEB}/settings/apps/new` : `${GITHUB_WEB}/organizations/${input.organization}/settings/apps/new`;
      return { action: `${where}?state=${encodeURIComponent(state)}`, manifest: JSON.stringify(manifestOf(input.origin)), nonce };
    },

    /**
     * GitHub's callback: `state` must be one started by `operator` from the browser holding `nonce`,
     * unexpired and unused; then `code` is converted into the App, whose credentials are stored sealed.
     * Answers where to install it.
     */
    async connect(input: { state: string; nonce: string | undefined; operator: string; code: string }, logger: Logger): Promise<{ slug: string; installUrl: string }> {
      const sql = await db();
      const stateHash = await sha256(input.state);
      // Single-use: gone before anything else is decided.
      const started = await sql.transaction(async (tx) => {
        const [found] = await tx.query<{ nonce_hash: string; operator: string; expires_at: number }>(`SELECT nonce_hash, operator, expires_at FROM ${STATES} WHERE state_hash = ?`, [stateHash]);
        await tx.run(`DELETE FROM ${STATES} WHERE state_hash = ?`, [stateHash]);
        return found;
      });
      if (started === undefined) throw refusal("invalid_state", "This connection is unknown or was finished already: start again from the dashboard's Settings → GitHub");
      if (Number(started.expires_at) < clock.now()) throw refusal("invalid_state", "This connection expired: start again from the dashboard's Settings → GitHub");
      if (input.nonce === undefined || (await sha256(input.nonce)) !== started.nonce_hash || started.operator !== input.operator) {
        throw refusal("invalid_state", "This connection was started from another browser or by another operator: start again from the dashboard's Settings → GitHub");
      }
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.code)) throw refusal("invalid_request", "GitHub's code is missing or malformed");
      if ((await row()) !== undefined) throw refusal("already_connected", "A GitHub App is connected already: disconnect it first");
      const app = await github<{
        id: number;
        slug: string;
        name: string;
        client_id: string;
        client_secret: string;
        webhook_secret: string | null;
        pem: string;
        html_url: string;
        owner: { login: string; type?: string };
      }>("POST", `/app-manifests/${input.code}/conversions`, undefined);
      const sealed = await seal(await key(), JSON.stringify({ pem: app.pem, clientSecret: app.client_secret, webhookSecret: app.webhook_secret ?? null } satisfies Sealed));
      await sql.run(
        `INSERT INTO ${TABLE} (id, app_id, slug, name, client_id, owner, owner_type, html_url, sealed, operator, connected_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [app.id, app.slug, app.name, app.client_id, app.owner.login, app.owner.type ?? "User", app.html_url, sealed, input.operator, Math.floor(clock.now())],
      );
      cached = undefined;
      logger.info("github-app: GitHub App created and stored", { operator: input.operator, app: app.slug, owner: app.owner.login });
      return { slug: app.slug, installUrl: `${GITHUB_WEB}/apps/${app.slug}/installations/new` };
    },

    /** After the operator installed it (`setup_url`): the installation, checked to be this App's, and its repositories. */
    async install(input: { installationId: number; operator: string }, logger: Logger): Promise<GitHubAppStatus> {
      const found = await row();
      if (found === undefined) throw refusal("not_connected", "No GitHub App is connected: connect one from the dashboard's Settings → GitHub");
      // Answered only for this App's own installations (the JWT is the App's).
      const installation = await github<{ id: number; account: { login: string } | null }>("GET", `/app/installations/${input.installationId}`, await jwtOf(found));
      const repositories = await repositoriesOf(found, installation.id);
      const kept = found.repository !== null && repositories.some((each) => each.toLowerCase() === found.repository?.toLowerCase()) ? found.repository : undefined;
      const repository = kept ?? (repositories.length === 1 ? repositories[0] : undefined) ?? null;
      await (await db()).run(`UPDATE ${TABLE} SET installation_id = ?, installation_account = ?, repositories = ?, repository = ? WHERE id = 1`, [
        installation.id,
        installation.account?.login ?? found.owner,
        JSON.stringify(repositories),
        repository,
      ]);
      cached = undefined;
      logger.info("github-app: installed", { operator: input.operator, app: found.slug, installation: installation.id, repositories: repositories.length });
      return status(false);
    },

    /** The repository tokens are minted for: one the installation reaches. */
    async choose(input: { repository: string; operator: string }, logger: Logger): Promise<GitHubAppStatus> {
      if (!GITHUB_REPOSITORY.test(input.repository)) throw refusal("invalid_request", "repository is owner/name");
      const found = await row();
      if (found === undefined || found.installation_id === null) throw refusal("not_installed", "Install the GitHub App first (the dashboard's Settings → GitHub)");
      const repositories = found.repositories === null ? [] : (JSON.parse(found.repositories) as string[]);
      const chosen = repositories.find((each) => each.toLowerCase() === input.repository.toLowerCase());
      if (chosen === undefined) throw refusal("invalid_request", `The GitHub App is not installed on ${input.repository}: add it to the installation on GitHub, then check again`);
      await (await db()).run(`UPDATE ${TABLE} SET repository = ? WHERE id = 1`, [chosen]);
      cached = undefined;
      logger.info("github-app: repository chosen", { operator: input.operator, repository: chosen });
      return status(false);
    },

    status,
    token,
    async repository(): Promise<string | undefined> {
      const found = await row();
      return found === undefined || found.installation_id === null ? undefined : (found.repository ?? undefined);
    },

    /** Forgets the App (its credentials, installation, tokens). It stays on GitHub until the operator deletes it there. */
    async disconnect(input: { operator: string }, logger: Logger): Promise<{ settingsUrl?: string }> {
      const found = await row();
      const held = cached;
      cached = undefined;
      await (await db()).run(`DELETE FROM ${TABLE}`);
      if (found === undefined) return {};
      // Best effort: the token kept is revoked, so no copy outlives the connection.
      if (held !== undefined) await github("DELETE", "/installation/token", `Bearer ${held.token}`).catch(() => {});
      logger.info("github-app: disconnected", { operator: input.operator, app: found.slug });
      return { settingsUrl: `${ownerPath(found)}/apps/${found.slug}/advanced` };
    },
  };
}
