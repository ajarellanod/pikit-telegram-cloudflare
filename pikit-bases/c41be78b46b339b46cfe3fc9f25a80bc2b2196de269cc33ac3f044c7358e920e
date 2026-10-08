/**
 * What admin-proposals' routes answer (`/admin/api/admin-proposals/*`), as JSON: the `proposals`
 * contract's shapes (`@pikit/contracts`), and the bodies of its actions. The view
 * (`src/dashboard/src/views/admin-proposals/types.ts`) keeps an identical copy: change both together.
 */

export type {
  ProposalCheck,
  ProposalChecks,
  ProposalDeploy,
  ProposalDetail,
  ProposalFile,
  ProposalList,
  ProposalsCheck,
  ProposalsStatus,
  ProposalState,
  ProposalSummary,
} from "@pikit/contracts";

/** `POST /admin/api/admin-proposals/:id/approve`'s body. */
export interface ApproveBody {
  /** The head commit the operator read: refused (`409 moved`) when the branch moved since. */
  head?: string;
  /** Approve although the checks that run before an approval do not pass. */
  override?: boolean;
}

/** `POST /admin/api/admin-proposals/:id/reject`'s body. */
export interface RejectBody {
  /** Left for the agent to read (markdown, at most `MAX_COMMENT` characters). */
  comment?: string;
}

export interface ApproveResponse {
  id: string;
  head: string;
  /** In the main branch now (GitHub's merge), or waiting for the deployer that merges it. */
  merged: boolean;
  /** What happens next. */
  message: string;
}

export interface RejectResponse {
  id: string;
  closed: true;
  message: string;
}

/**
 * An error: `unauthorized` 401; `invalid_request` 400; `not_found` 404 (no such proposal);
 * `not_open`, `moved`, `checks_failing`, `wrong_base`, `not_mergeable` 409; `too_large` 413; and the
 * provider's failures (`ProposalsError`): `not_connected` 503 (not set up yet: the message says what
 * to do), `not_configured` 503, `rate_limited` 429 (with `retry-after`), `unauthorized`, `forbidden`,
 * `missing_repository`, `unavailable`, `refused` 502. Never a secret.
 */
export interface ProposalError {
  error: string;
  message?: string;
}

/** The longest comment a rejection leaves. */
export const MAX_COMMENT = 10_000;
