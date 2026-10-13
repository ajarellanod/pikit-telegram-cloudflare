/**
 * What admin-proposals' routes answer (`/admin/api/admin-proposals/*`), as JSON: the `proposals`
 * contract's shapes (`@pikit/contracts`), and the bodies of its actions. The view
 * (`src/dashboard/src/views/admin-proposals/types.ts`) keeps an identical copy: change both together.
 */

import type { ProposalsErrorCode } from "@pikit/contracts";

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
 * provider's failures (`ProposalsError`), each with its status in `PROVIDER_STATUS`. Never a secret.
 */
export interface ProposalError {
  error: string;
  message?: string;
}

/**
 * The HTTP status a provider's failure (`ProposalsError`'s code) answers with: `not_connected` 503 (not
 * set up yet: the message says what to do), `rate_limited` 429 (with `retry-after`), `not_found` 404;
 * where proposals live refusing or failing (`unauthorized`, `forbidden`, `missing_repository`,
 * `unavailable`, `refused`) 502, the gateway's failure, not the operator's.
 */
export const PROVIDER_STATUS: Record<ProposalsErrorCode, number> = {
  not_found: 404,
  not_connected: 503,
  rate_limited: 429,
  unauthorized: 502,
  forbidden: 502,
  missing_repository: 502,
  unavailable: 502,
  refused: 502,
};

/** The longest comment a rejection leaves. */
export const MAX_COMMENT = 10_000;
