/**
 * What admin-proposals' routes answer (`/admin/api/admin-proposals/*`), as JSON. The view
 * (`src/dashboard/src/views/admin-proposals/types.ts`) keeps an identical copy: change both together.
 *
 * A proposal is a pull request of the project's repository whose head branch starts with the prefix
 * (`pikit/self/`) and lives in that same repository (never a fork's).
 */

/** Where a proposal is: still open, merged (approved), or closed without merging (rejected). */
export type ProposalState = "open" | "merged" | "closed";

/** One check of the proposal's head commit: a check run (GitHub Actions, Workers Builds) or a commit status. */
export interface ProposalCheck {
  name: string;
  state: "passing" | "failing" | "pending" | "skipped";
  /** GitHub's conclusion or status (`failure`, `in_progress`, `success`…). */
  detail: string;
  url?: string;
}

/**
 * Every check of the head commit, summed up: `failing` when one fails, else `pending` while one runs,
 * else `passing` when at least one passed, else `none` (no check ran: the project's workflow is missing).
 */
export interface ProposalChecks {
  state: "passing" | "failing" | "pending" | "none";
  passed: number;
  failed: number;
  pending: number;
  items: ProposalCheck[];
}

export interface ProposalSummary {
  number: number;
  title: string;
  /** Who opened the pull request (the agent's token's account). */
  author: string;
  /** The head branch, under the prefix. */
  branch: string;
  /** ISO 8601, as GitHub gives them. */
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  state: ProposalState;
  draft: boolean;
  /** The head commit's checks; read for open proposals only. */
  checks?: ProposalChecks;
  /** The pull request on GitHub. */
  url: string;
  /** A preview of the change when one is found (a Workers Builds preview's `*.workers.dev` URL). */
  previewUrl?: string;
}

/** `GET /admin/api/admin-proposals`: the open proposals, then the recently closed ones, newest first. */
export interface ProposalList {
  repository: string;
  branchPrefix: string;
  proposals: ProposalSummary[];
}

/** One changed file; `patch` is cut at `MAX_PATCH` characters, and left out once the whole diff is past `MAX_DIFF`. */
export interface ProposalFile {
  path: string;
  /** `added`, `removed`, `modified`, `renamed`… (GitHub's). */
  status: string;
  previousPath?: string;
  additions: number;
  deletions: number;
  /** The unified diff's hunks; absent for a binary file, a file GitHub does not diff, or past the bound. */
  patch?: string;
  /** Whether `patch` was cut or left out by the bound. */
  truncated: boolean;
}

/** `GET /admin/api/admin-proposals/:number`. */
export interface ProposalDetail extends ProposalSummary {
  /** The agent's description of the change (markdown). */
  body: string;
  /** The branch it merges into, and the repository's default branch: Approve needs them equal. */
  base: string;
  defaultBranch: string;
  /** The head commit: Approve sends it back, so a branch moved since it was read is not merged. */
  headSha: string;
  /** GitHub's: `null` while it is computing it. */
  mergeable: boolean | null;
  /** GitHub's `mergeable_state` (`clean`, `dirty`, `blocked`, `unstable`, `unknown`…). */
  mergeableState: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** The first `MAX_FILES` files. */
  files: ProposalFile[];
  checks: ProposalChecks;
}

/** `POST /admin/api/admin-proposals/:number/approve`'s body. */
export interface ApproveRequest {
  /** The head commit the operator reviewed: refused (`409 changed`) when the branch moved since. */
  sha?: string;
  /** Merge although the checks fail, are pending or never ran. */
  override?: boolean;
}

/** `POST /admin/api/admin-proposals/:number/reject`'s body. */
export interface RejectRequest {
  /** Left on the pull request before it is closed (markdown, at most `MAX_COMMENT` characters). */
  comment?: string;
}

export interface ApproveResponse {
  number: number;
  merged: true;
  /** The squashed commit on the default branch. */
  sha: string;
}

export interface RejectResponse {
  number: number;
  closed: true;
}

/** One part of the connection, as `GET /admin/api/admin-proposals/status` checks it. */
export interface ConnectionCheck {
  /** `ok`; `missing` (not set yet); `failing` (set, and wrong); `unknown` (not checked, or GitHub did not say). */
  state: "ok" | "missing" | "failing" | "unknown";
  /** What was found, or what to do: names a secret, never holds one. */
  message: string;
}

/**
 * `GET /admin/api/admin-proposals/status`: whether self-improvement is connected, checked live. It is
 * when the repository is set and the read token reads it, and the merge token is set and another
 * token. The ruleset is best effort: GitHub's rules for the default branch, read with the read token.
 */
export interface ConnectionStatus {
  connected: boolean;
  /** `owner/name`, the setting's (or the config's); empty when none. */
  repository: string;
  branchPrefix: string;
  /** The secrets' names: `GITHUB_TOKEN`, `PIKIT_MERGE_TOKEN` unless the config says otherwise. */
  tokenSecret: string;
  mergeTokenSecret: string;
  /** The repository's default branch, when it was read. */
  defaultBranch?: string;
  checks: {
    /** The repository is set, and GitHub has it. */
    repository: ConnectionCheck;
    /** The read token is set, and reads the repository. */
    readToken: ConnectionCheck;
    /** The merge token is set, and is not the read token (it is never sent to check it). */
    mergeToken: ConnectionCheck;
    /** A ruleset requires a pull request on the default branch. */
    ruleset: ConnectionCheck;
  };
}

/**
 * An error: `unauthorized` 401; `invalid_request` 400; `not_found` 404 (no such pull request);
 * `not_a_proposal` 404 to a read, 409 to an action (its head is not a branch under the prefix of the
 * repository); `not_open`, `wrong_base`, `checks_failing`, `changed`, `not_mergeable` 409;
 * `too_large` 413; `rate_limited` 429 (with `retry-after`); `not_connected` 503 (no repository, or a
 * token missing: self-improvement is not connected yet, and the message says what to set);
 * `not_configured` 503 (the same token in both secrets); `github_unauthorized`, `github_forbidden`,
 * `github_not_found`, `github_unavailable`, `github_refused` 502. Never a token.
 */
export interface ProposalError {
  error: string;
  message?: string;
}

/** The most files a proposal's page lists (GitHub's page). */
export const MAX_FILES = 100;
/** One file's patch is cut past this many characters. */
export const MAX_PATCH = 60_000;
/** Once the patches sent add up to this many characters, the next ones are left out. */
export const MAX_DIFF = 400_000;
/** The longest comment a rejection leaves. */
export const MAX_COMMENT = 10_000;
