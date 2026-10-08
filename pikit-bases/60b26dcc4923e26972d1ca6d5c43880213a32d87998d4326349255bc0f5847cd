# admin-proposals

The gate of the agent's changes to itself (SPEC §6, `features/self-improvement.md`). The agent
proposes a change as a GitHub pull request from a branch under `pikit/self/` of the project's
repository (execution-do's `git push` and `git pr` on Cloudflare); the operator reads it in the
dashboard's Proposals view (the description, the diff, the checks, a preview) and approves it, which
merges it, or rejects it, which closes it. The deploy follows the merge (Workers Builds on
Cloudflare). It is **dormant until connected**: it starts without a repository or a token, and is
connected after deploying ("Connect it" below).

- **Provides:** `http.route`: the five routes below, the view's data and actions.
- **Requires:** `secrets` (the two tokens). **Uses, if installed:** `admin.auth` (who is an operator;
  `admin-auth-token`; without it, its routes answer nobody) and `settings` (the repository, live;
  `settings-store`). A server (`server-bun`, or the Worker on Cloudflare) serves the routes.
- **View:** `view/`, the dashboard's Proposals page and a page per proposal: installed to
  `src/dashboard/src/views/admin-proposals/` when the project has a UI. Before it is connected, the
  page says what is missing and how to connect it.
- **Settings:** `settings/`, the Settings dialog's Self-improvement: the repository, the connection
  checked live, and the steps (installed to `src/dashboard/src/settings/admin-proposals/`).
- **Targets:** `server` and `durable`. On Cloudflare it goes in both Apps (`apps.worker: "default"`),
  with its config in both: the Worker's App serves the routes, the objects' copy is never reached (as
  admin-api's).
- **Installs to:** `src/pikit/admin-proposals/`, and `.github/workflows/pikit-checks.yml`, the
  project's checks ("Checks" below).
- **npm dependencies:** `typebox`.

```sh
pikit add admin-proposals
```

## Connect it

Three things, each checked live by `GET …/status` and shown in Settings → Self-improvement:

1. **The repository**, `owner/name`: a setting, set in Settings → Self-improvement (saved with
   execution-do's own, where the agent may push), applied at the next request; its default is the
   config's `repository` (which `pikit configure` writes). The Deploy to Cloudflare button's
   repository is not known before deploying, so the template leaves it empty.
2. **The two tokens** ("Tokens" below), as secrets, never typed into the dashboard: on Cloudflare in
   the Worker's Variables and Secrets (they apply at once and stay through deploys), on a server in
   `.env` (`pikit configure` asks for them).
3. **A ruleset** on the default branch ("Protect the default branch" below): best effort, the status
   reads the rules GitHub applies to it with the read token.

Until the repository and the read token are there, every route but `status` answers `503
not_connected`, saying what is missing; Approve and Reject also need the merge token.

`pikit configure` (`configure.ts`) offers the same in a terminal: the repository (`git remote
get-url origin`'s by default) written to `pikit.config.ts` (both Apps' configs on Cloudflare), the two
tokens asked without echo into `.env`, and how to create the ruleset. Without a terminal it asks
nothing, and nothing is missing.

## Configure

```ts
"admin-proposals": {
  repository: "ana/my-bot",              // default "": the setting's default (empty: not connected)
  branchPrefix: "pikit/self/",           // default: execution-do's git.branchPrefix
  tokenSecret: "GITHUB_TOKEN",           // default: the token that reads
  mergeTokenSecret: "PIKIT_MERGE_TOKEN", // default: the token that merges and closes
  apiBase: "https://api.github.com",     // default: GitHub's API (GitHub Enterprise Server, a test double)
}
```

On Cloudflare the same entry goes in `config` and in `workerConfig`.

## Tokens

Two secrets, read through `secrets` at each request, never in config, a log line or an answer:

| Secret | Used for | Fine-grained token, this repository only |
|---|---|---|
| `GITHUB_TOKEN` (`tokenSecret`) | listing the pull requests, their files, comments and checks; the status | Pull requests, Checks, Commit statuses: read. The agent's own token (execution-do's) does, which needs Contents and Pull requests read and write to push its branches and open pull requests. |
| `PIKIT_MERGE_TOKEN` (`mergeTokenSecret`) | Approve (squash merge), Reject (comment and close) | Contents and Pull requests: read and write. Nothing else holds it. |

The merge token is sent only by the approve and reject routes, behind `admin.auth` (the status
compares it with the read token, never sends it): no tool, no agent code reaches it. Both secrets
holding the same token is refused (`503 not_configured`), and so
is a config naming one secret for both (the App does not start). On Cloudflare every secret is a
binding the objects' App could read too: what keeps the agent from it is that no tool reads
`secrets` for it.

**Protect the default branch** with a ruleset (Settings → Rules): a pull request required, no direct
push, no force push, status check `checks` (this workflow's job) required, and nobody bypasses it but
the merge token's account if you choose so. The gate then holds even if the agent's token leaks. A
CODEOWNERS on `.github/`, `src/pikit/admin-proposals/` and the deployment's files makes "the agent
never changes its gate" checkable.

## API

Every route asks `admin.auth` first: without an operator's credential, `401` and GitHub is not asked.
JSON, typed in `api.ts` (the view keeps an identical copy, `view/types.ts`); an error is
`{ error, message? }`.

| Route | Answers |
|---|---|
| `GET /admin/api/admin-proposals/status` | `ConnectionStatus`: whether it is connected, and each part (the repository, the read token, the merge token, the default branch's ruleset) `ok`, `missing`, `failing` or `unknown`, with what to do |
| `GET /admin/api/admin-proposals` | `ProposalList`: open proposals (newest first, each with its checks and a preview URL when found), then the last closed ones (merged or rejected) |
| `GET /admin/api/admin-proposals/:number` | `ProposalDetail`: the description (markdown), base and default branch, head commit, mergeable state, the files with their patches, the checks |
| `POST /admin/api/admin-proposals/:number/approve` | `{ sha?, override? }` → squash-merged with the merge token: `{ number, merged: true, sha }` |
| `POST /admin/api/admin-proposals/:number/reject` | `{ comment? }` → the comment left, then closed with the merge token: `{ number, closed: true }` |

**What a proposal is:** a pull request whose head is a branch under `branchPrefix` of `repository`
itself. A fork's branch with the same name is not one: not listed, `404 not_a_proposal` to read,
`409 not_a_proposal` to approve or reject. Pull requests of people are not the dashboard's.

**Approve refuses** (`409`), before anything is written: a pull request already merged or closed
(`not_open`); a base other than the repository's default branch (`wrong_base`); a head other than the
`sha` the operator read (`changed`: the agent pushed again since); checks that fail, still run, or never
ran (`checks_failing`), unless `override: true`; GitHub refusing the merge (`not_mergeable`: a
conflict, a draft, a ruleset's requirement). Each approval and rejection is logged with the
operator's id and the number (`admin-proposals: approved and merged`, with whether checks were
overridden).

**Checks** are the head commit's check runs and commit statuses: `failing` when one fails (a failure,
a timeout, a cancellation), else `pending` while one runs, else `passing` when one passed, else `none`.

**Bounds:** the list reads the last 100 open and 30 closed pull requests, lists 20 closed proposals,
and reads the checks of the first 20 open ones (on Cloudflare's Free plan a request makes at most 50
subrequests; the list makes 2 plus 2 per open proposal). A proposal's page shows its first 100 files,
each patch cut at 60,000 characters and none past 400,000 in all (`truncated`).

**Errors from GitHub:** its rate limit is `429 rate_limited` with `retry-after`; a token GitHub
refuses is `502 github_unauthorized` (wrong, expired) or `502 github_forbidden` (a permission
missing), a repository it cannot see `502 github_not_found`, GitHub down or slow (15 s) `502
github_unavailable`; no repository or a missing token `503 not_connected`, the same token twice `503
not_configured`. Messages name the secret, never hold it.

**Preview:** best effort. A `https://….workers.dev` URL found in the head's check runs (Workers
Builds' check names its preview) or the pull request's comments. None on a server.

## Checks

`.github/workflows/pikit-checks.yml` runs on every pull request (`pull_request`, so the proposed code
gets no secret and a read-only token): install with the project's lockfile (`npm ci` with
`package-lock.json`, else `bun install --frozen-lockfile`), `bun run typecheck` when package.json has
the script, `bun test`, and on Cloudflare (a `wrangler.jsonc`) `wrangler deploy --dry-run`, which also
builds the dashboard. Its job is `checks`: the status check to require in the ruleset.

`pikit doctor` is not in it: the pikit CLI is installed on a person's machine, not a dependency of the
project, and is not on npm yet, so CI cannot run it. Once it is, `npx pikit doctor` is one more step.

## Guarantees

Its tests run the routes against a fake GitHub on a local port (`fake-github.test-support.ts`, a
read token that cannot write and a merge token that can): `401` without an operator and GitHub never
asked; the list keeps only the prefix's branches of the repository itself (not a person's, not a
fork's), open first with checks and preview; a page's patches bounded; approve refused for failing,
pending or missing checks unless overridden, for a non-proposal, a fork, another base, a closed one, a
moved head, GitHub's own refusals; the merge done with the merge token alone, squashed at the
reviewed head, logged with the operator; reject comments and closes with the merge token; a missing
token, the same token twice, a rate limit, a refused token, GitHub down, each its answer and none
holding a token; dormant without a repository (`503 not_connected` everywhere, GitHub never asked);
the repository read from the setting at each request, the config's when the settings cannot be read;
the status of each part, the merge token never sent; no `admin.auth`, nobody. `configure.test.ts`
runs the `pikit configure` step with a scripted terminal.

## Remove it

`pikit remove admin-proposals` takes the routes, the view and the workflow away; the pull requests
stay on GitHub, to merge there. Remove the ruleset's required check too, or nothing merges.
