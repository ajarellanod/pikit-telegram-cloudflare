# github-app

The project's GitHub access on Cloudflare, connected in two clicks from the dashboard: a GitHub App
created in your own account (GitHub's [App Manifest
flow](https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)) and
installed on the bot's repository. The app then mints its own short-lived installation tokens for that
repository: nothing is pasted into Cloudflare, and the agent never holds a token. It is what
self-improvement (SPEC §6, `features/self-improvement.md`) uses on Cloudflare: the agent's `git`
(execution-do) and the proposals' GitHub calls.

- **Provides:** `github` (`@pikit/contracts`' github.ts): the connected repository and a token for it,
  in both Apps; `http.route` (the Worker's half): the routes below.
- **Requires:** `storage.sql` (the connection, in one object), `secrets` (`PIKIT_ADMIN_TOKEN`, which
  the credentials' key is derived from), `actor.inbox` and `actor.mailbox` (platform-cloudflare). The
  Worker's half requires `actor.mailbox`; **uses, if installed,** `admin.auth` (who is an operator;
  without it, its routes answer nobody).
- **Settings:** `settings/`, the Settings dialog's GitHub: Connect, the App, its installation and the
  repository, the last token minted, Disconnect (installed to `src/dashboard/src/settings/github-app/`).
- **Targets:** `durable`. On a server (or from the CLI), `github-token` provides the same `github`
  from a `GITHUB_TOKEN` secret: the consumers never know which is installed.
- **Installs to:** `src/pikit/github-app/`.
- **npm dependencies:** `typebox`.

```sh
pikit add github-app
```

`pikit add` puts the default export in the objects' App and the Worker's half (`github-app-worker`) in
the Worker's. The connection is one object's, `github-app:credentials`, of the conversations' class
and never a conversation (as settings-store's settings object): every App reaches it through
`actor.mailbox`.

## Connect it

Dashboard → Settings → GitHub → **Connect GitHub**:

1. **The dashboard posts a manifest to GitHub** (`https://github.com/settings/apps/new`, or an
   organization's `…/organizations/<org>/settings/apps/new` when you give one): a private App named
   `pikit-<worker>-<account>` from the Worker's host (rename it on GitHub's page if the name is
   taken), its homepage the Worker's URL, no webhook, and these permissions on the repositories it is
   installed on: Contents *write* (push its branches), Pull requests *write* (open, merge, close them),
   Checks and Commit statuses *read* (the proposals' checks), Metadata *read*. You click **Create
   GitHub App** there.
2. **GitHub redirects back** (`…/callback`): the app converts GitHub's code into the App (its id,
   slug, client id and secret, private key), stores them, and sends you on to installing it.
3. **You install it** on the bot's repository (**Only select repositories**: the one the Deploy to
   Cloudflare button made). GitHub redirects back (`…/setup`) and the dashboard opens Settings → GitHub:
   one repository is the repository; with several, you choose one there; with none, it says so.

Tokens are then minted when used: an RS256 JWT of the App (Web Crypto), then
`POST /app/installations/{id}/access_tokens` for that repository alone, kept by the github-app object
until six minutes before GitHub's hour runs out. Every App reads `github` through calls, keeping an
answer a second (`freshMs`).

**Disconnect** forgets the App here (and revokes the token kept). It stays on GitHub until you delete
it there: the section links to its settings (Advanced → Delete GitHub App).

## Security

- **The connection is bound to who started it.** `POST …/start` (an operator, with the dashboard's
  header) stores a random `state` and a browser nonce, as SHA-256 digests, for 15 minutes; the nonce
  goes to the browser as a cookie (`pikit_github_app`, `HttpOnly`, `SameSite=Lax` so GitHub's redirect
  carries it, `Path=/admin/api/github-app`). The callback refuses (`403 invalid_state`) a state that is
  unknown, used, expired, or comes back without that browser's nonce or with another operator; it is
  deleted before anything else, whatever comes of it. GitHub's code is converted only then.
- **Every route asks `admin.auth`.** The callback and the setup are navigations from github.com, and
  the dashboard's session cookie is `SameSite=Strict`, so the browser does not send it on them: the
  route answers a page that loads the same URL again from this site (a `meta` refresh, no script),
  which does send it; still without a session, `401`. The setup's installation is read with the
  App's JWT, so only this App's installation is taken.
- **Sealed at rest.** The private key, client secret and webhook secret are encrypted with AES-256-GCM
  under a key derived from `PIKIT_ADMIN_TOKEN` (HKDF-SHA256, its own `info`); the table holds them only
  sealed, the rest (id, slug, owner, installation, repositories) in the clear. **Changing the admin
  token means connecting again**: the status says so, Disconnect, Connect, and delete the old App on
  GitHub.
- **Tokens never leave trusted code.** A token is answered to the app's own components (`github`),
  never logged, never stored (memory only), sent only to GitHub. The agent's shell has no process to
  read one (execution-do), its pushes are fenced to `pikit/self/*` of the repository, and merging is
  only the dashboard's, behind `admin.auth`: one repository-scoped credential is enough. A ruleset on
  the default branch (a pull request required) is an extra layer, not a requirement.
- **The dashboard's CSP** allows a form to post to `https://github.com` (admin-api's `form-action`):
  that is how the manifest gets there.

## API

Every route asks `admin.auth` first. JSON, typed in `api.ts` (the section keeps a copy); an error is
`{ error, message? }`, codes in `api.ts`.

| Route | Answers |
|---|---|
| `GET /admin/api/github-app/status` | `GitHubAppStatus`: the App, its installation and repositories, the repository, the last token minted or failed; `?check=1` reads the repositories and mints a token now |
| `POST /admin/api/github-app/start` | `{ organization? }` → `{ action, manifest }`: the form to post to GitHub; sets the nonce cookie. `409 already_connected` while one is |
| `GET /admin/api/github-app/callback?code&state` | GitHub's redirect: `302` to installing the App, or a page saying why not |
| `GET /admin/api/github-app/setup?installation_id` | GitHub's redirect after installing (or changing the installation): `302` to `/admin/?settings=github-app` |
| `PUT /admin/api/github-app/repository` | `{ repository }`: one the installation reaches → `GitHubAppStatus` |
| `DELETE /admin/api/github-app` | `{ disconnected: true, settingsUrl? }` |

## Configure

```ts
"github-app": {
  keySecret: "PIKIT_ADMIN_TOKEN", // default: the secret the credentials' key is derived from
  freshMs: 1000,                   // default: how long an object answers `github` from what it read last
}
```

The Worker's half (`github-app-worker`) has no config.

## Guarantees

`github-app.test.ts`, against a fake GitHub behind `fetch` (`fake-github.test-support.ts`: the
manifest conversion with a generated PKCS#1 key, installations, tokens accepted only with a JWT the
key verifies, installation repositories, pull requests) and a double of the objects: the `github`
suite (`createGitHubConformance`); the whole connection through the Worker's routes (the manifest, the
bounce for the session cookie, the install, tokens for the repository); a state unknown, replayed,
expired, another browser's or operator's, or without a session, refused before GitHub is asked; the
credentials sealed in the table, unreadable under another admin token; a token kept and shared, minted
again before it expires, a failure recorded; one, several or no repositories; an installation not this
App's refused; disconnect revoking the token. The workerd lane (`tests/workerd`) runs the same
connection on a real Durable Object (its SQLite, Web Crypto's RS256 in workerd).

Not tested without a real GitHub: GitHub's own pages (creating and installing the App), and real
installation tokens on git's smart HTTP.

## Remove it

`pikit remove github-app` takes the routes, the section and `github` away; components that used it
are not connected until another provider is installed (`github-token`). The connection's rows stay in the github-app object's tables;
delete the App on GitHub.
