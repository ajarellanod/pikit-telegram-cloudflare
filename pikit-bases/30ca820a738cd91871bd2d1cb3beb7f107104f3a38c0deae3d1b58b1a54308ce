# admin-proposals

The dashboard's side of the agent's changes to itself (SPEC §6, `features/self-improvement.md`):
its routes and its Proposals view list, show, approve and reject the proposals that `proposals`
holds, and its Settings section shows whether they can be made and approved now. It is the same on
every target: where proposals live and what approving does are the provider's.

| Provider | Target | A proposal is | Approve |
|---|---|---|---|
| `proposals-local` | server | a branch `pikit/self/<topic>` of a repository on the server | recorded; the deployer next to the app merges, checks, deploys, rolls back |
| `proposals-github` | Cloudflare | that branch's pull request on GitHub, opened by the provider | squash-merged through GitHub's API; Workers Builds deploys |

The steward proposes the same way on both: it pushes the branch to `proposals.remote()`
(`extension-pikit-self` tells it how).

- **Provides:** `http.route`: the five routes below, the view's data and actions.
- **Requires:** `proposals`. **Uses, if installed:** `admin.auth` (who is an operator;
  `admin-auth-token`; without it, its routes answer nobody). A server (`server-bun`, or the Worker on
  Cloudflare) serves the routes.
- **View:** `view/`, the dashboard's Proposals page and a page per proposal: installed to
  `src/dashboard/src/views/admin-proposals/` when the project has a UI. Choosing it in `pikit new`
  (the Self-improvement feature) gives the project its UI.
- **Settings:** `settings/`, the Settings dialog's Self-improvement: each part the provider checks
  (on a server: the proposals repository, the deployer running, the project's checkout; on GitHub: the
  repository readable, the token accepted, a ruleset advised), the last deploy, rollback and failure
  when the provider knows them, and a link to where it is set up when a component brings a section for
  it (Settings → GitHub, on Cloudflare).
- **Targets:** `server` and `durable`. On Cloudflare it goes in both Apps (`apps.worker: "default"`):
  the Worker's App serves the routes, the objects' copy is never reached (as admin-api's).
- **Installs to:** `src/pikit/admin-proposals/`.

```sh
pikit add admin-proposals proposals-local    # a server
pikit add admin-proposals proposals-github   # Cloudflare
```

## API

Every route asks `admin.auth` first: without an operator's credential, `401` and `proposals` is not
asked. JSON, the contract's shapes (`api.ts`; the view keeps a copy, `view/types.ts`); an error is
`{ error, message? }`.

| Route | Answers |
|---|---|
| `GET /admin/api/admin-proposals/status` | `ProposalsStatus`: whether it is ready, each part checked, the deploys |
| `GET /admin/api/admin-proposals` | `ProposalList`: where proposals live, whether checks run before or after an approval, the open proposals, then the last closed ones |
| `GET /admin/api/admin-proposals/:id` | `ProposalDetail`: the description (markdown), the files with their patches, the checks, the deploy |
| `POST /admin/api/admin-proposals/:id/approve` | `{ head?, override? }` → `{ id, head, merged, message }` |
| `POST /admin/api/admin-proposals/:id/reject` | `{ comment? }` → `{ id, closed: true, message }` |

`:id` is the branch's topic (`pikit/self/<topic>`), its `/` encoded. A refusal is `409` (`not_open`,
`moved`, `checks_failing`, `wrong_base`, `not_mergeable`), `404` for `not_found`; a body that is not
one is `400 invalid_request`, a large one `413`. A provider's failure (`ProposalsError`) answers its
own status: `503 not_connected` while it is not set up (the message says what to do), `429
rate_limited` with `retry-after`, `502` when GitHub refuses or is down. Each approval and rejection is
logged with the operator and the id.

## The view

The list says where proposals live and, from `checksRun`, what Approve does: on GitHub, checks run
before (CI) and Approve with failing checks asks "anyway" (`override`); on a server, checks run after
(the deployer), so Approve says the deployer merges, checks, deploys and rolls back. A proposal's page
shows its description, its checks, its deploy (waiting, deploying, deployed, rolled back, failed), its
diff file by file, and Approve / Reject behind a confirmation; Approve sends the head the page shows.

## Security

What an approval is worth is the provider's. On Cloudflare (`proposals-github`) no tool gives the agent
GitHub's token (execution-do's git only pushes branches under the prefix), and a ruleset can protect
the default branch. On a server (`proposals-local`) an
approval is the operator's decision, not a lock: the agent's shell runs in the app's container and
could forge one; the deployer checks, waits for `/health` and rolls back whatever it deploys
(proposals-local's README; `features/sandboxed-execution.md` for a real lock).

## Tests

`admin-proposals.test.ts` runs the routes over a `proposals` in memory: `401` without an operator (and
without `admin.auth`) and the provider never asked; status, list and a proposal passed through, a
topic's `/` decoded; approve passing the head and the operator, its outcome as `200`, `409` or `404`,
a malformed body refused before the provider; reject's comment trimmed and bounded; a provider's
failure as its status, a rate limit with `retry-after`. The providers' own tests hold what each does.

## Remove it

`pikit remove admin-proposals` takes the routes, the view and the section away; the provider and its
proposals stay.
