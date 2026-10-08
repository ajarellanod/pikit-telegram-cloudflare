# proposals-github

Self-improvement on Cloudflare (SPEC §6, `features/self-improvement.md`): the agent's changes to
itself as pull requests on the project's GitHub repository. The steward proposes as it does on every
target: it pushes a branch `pikit/self/<topic>` to `remote()` (execution-do's git, with the token kept
away from it). This component opens the branch's pull request itself, the first time it lists or
reads it (its head commit's first line the title, the rest the description); the operator reads it in
the dashboard (`admin-proposals`: the description, the diff, the checks, a preview) and approves it,
which squash-merges it, or rejects it, which closes it. Workers Builds deploys the merge. It is
**dormant until GitHub is connected**, after deploying ("Connect it" below).

- **Provides:** `proposals`.
- **Requires:** `github`: the repository and a short-lived token, from `github-app` (a GitHub App
  created and installed from the dashboard's Settings → GitHub) or `github-token` (a token you made).
- **Target:** `durable`. It goes in both Apps (`apps.worker: "default"`), with its config in both: the
  Worker's App answers the dashboard's routes, the objects' App the steward's guide (`remote`).
- **Installs to:** `src/pikit/proposals-github/`, and `.github/workflows/pikit-checks.yml`, the
  project's checks ("Checks" below).
- **npm dependencies:** `typebox`.

```sh
pikit add admin-proposals proposals-github github-app   # or: pikit new --target durable --preset telegram-cloudflare --with admin-proposals
```

## GitHub access, in one module

`github-access.ts` is the only file that reaches GitHub's access: the `github` contract, whichever
provider connects it. The repository is `github.repository(ctx)`, read at each call; the token is
`github.token(ctx)`, asked for every call to GitHub and never kept (the provider caches it if it
wants). Until GitHub is connected, everything but `status` is `not_connected` (503), pointing to the
dashboard's Settings → GitHub.

## Connect it

On Cloudflare, with `github-app` (the template's): the dashboard's Settings → GitHub → Connect creates
a GitHub App in your account from a manifest and installs it on the repository; the app mints its own
tokens. With `github-token`: a fine-grained token for the repository (Contents and Pull requests read
and write, Checks and Commit statuses read) as the `GITHUB_TOKEN` secret, and the repository as its
setting. `status()` (Settings → Self-improvement) checks the repository is readable and the token
accepted, and whether a ruleset protects the default branch.

**A ruleset is advised** (Settings → Rules on GitHub): a pull request required, the `checks` status
required, no force push. One token reads, opens and merges here: what keeps the agent from merging is
that no tool reads `github` for it (execution-do's git only clones and pushes branches under the
prefix); the ruleset holds even if a token leaks.

## Configure

```ts
"proposals-github": {
  branchPrefix: "pikit/self/",           // default
  apiBase: "https://api.github.com",     // default: GitHub's API (GitHub Enterprise Server, a test double)
}
```

The same entry goes in `config` and in `workerConfig`.

## What it does

- **A proposal** is a branch under `branchPrefix` of `repository` itself, its id the topic
  (`pikit/self/<topic>`), and its pull request (`number`). A fork's branch with the same name, or a
  person's pull request, is not one: not listed, `not_found` to read or act on.
- **Opening:** a pushed branch with no pull request, nor one closed at its head, gets one into the
  default branch (at most 5 per call). A rejected or merged branch the agent
  pushes again (a new head) gets a new one.
- **Approve refuses**, before anything is written: a pull request already merged or closed
  (`not_open`); a base other than the default branch (`wrong_base`); a head other than the one the
  operator read (`moved`); checks that fail, still run, or never ran (`checks_failing`), unless
  `override`; GitHub refusing the merge (`not_mergeable`). Each approval and rejection is logged with
  the operator.
- **Checks** are the head commit's check runs and commit statuses: `failing` when one fails, else
  `pending` while one runs, else `passing` when one passed, else `none`.
- **Bounds:** the list reads the last 100 open and 30 closed pull requests and the prefix's branches,
  lists 20 closed proposals, and reads the checks of the first 20 open ones (a Worker's subrequests are
  counted). A proposal's page shows its first 100 files, each patch cut at 60,000 characters and none
  past 400,000 in all.
- **GitHub's errors:** its rate limit is `rate_limited` (429) with `retryAfter`; a refused token is
  `unauthorized` or `forbidden` (502), a repository the token cannot see `missing_repository` (502),
  GitHub down or slow (15 s), or `github` failing to make a token, `unavailable` (502). Never a token.
- **Preview:** best effort, a `https://….workers.dev` URL in the head's check runs (Workers Builds')
  or the pull request's comments.

## Checks

`.github/workflows/pikit-checks.yml` runs on every pull request (`pull_request`, so the proposed code
gets no secret and a read-only token): install with the project's lockfile (`npm ci` with
`package-lock.json`, else `bun install --frozen-lockfile`), `bun run typecheck` when package.json has
the script, `bun test`, and `wrangler deploy --dry-run` with a `wrangler.jsonc`. Its job is `checks`:
the status check to require in the ruleset. `pikit doctor` is not in it: the pikit CLI is not a
dependency of the project nor on npm yet.

## Tests

`proposals-github.test.ts` runs the `proposals` conformance suite, then the component against a fake
GitHub on a local port (`fake-github.test-support.ts`) and a `github` in memory: dormant until GitHub
is connected, and the next call once it is; the token asked for every call, a rotated or refused one
and `github`'s own failure said, never a token; `remote()` authorized by trusted code; the status of
each part; a pushed branch's pull request opened once, titled from its head commit, never reopened at a
closed head; the list keeps only the prefix's branches of the repository itself; a page's patches
bounded; approve refused for failing, pending or missing checks unless overridden, for a non-proposal,
a fork, another base, a closed one, a moved head, GitHub's own refusals; the merge logged with the
operator; reject comments and closes; a rate limit, a refused token, GitHub down, a token that cannot
merge.

## Remove it

`pikit remove proposals-github` takes the provider, its section and the workflow away; the pull
requests stay on GitHub, to merge there. Remove the ruleset's required check too, or nothing merges.
