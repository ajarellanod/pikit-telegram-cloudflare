/**
 * What admin-proposals' routes answer (`/admin/api/admin-proposals/*`), as JSON: the `proposals`
 * contract's shapes (`@pikit/contracts`, `proposals.ts`) and admin-proposals' bodies
 * (`src/pikit/admin-proposals/api.ts`), copied here because the dashboard is a project of its own.
 * Change them together.
 */

/** `open`; `approved` (its deploy waits or runs); `merged`; `failed` (approved, its deploy failed); `closed` (rejected). */
export type ProposalState = "open" | "approved" | "merged" | "failed" | "closed";

export interface ProposalCheck {
  name: string;
  state: "passing" | "failing" | "pending" | "skipped";
  detail: string;
  url?: string;
}

export interface ProposalChecks {
  state: "passing" | "failing" | "pending" | "none";
  passed: number;
  failed: number;
  pending: number;
  items: ProposalCheck[];
}

export interface ProposalDeploy {
  outcome: "waiting" | "deploying" | "deployed" | "rolled back" | "failed";
  message: string;
  at: string;
}

export interface ProposalSummary {
  id: string;
  number?: number;
  title: string;
  author: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  state: ProposalState;
  draft: boolean;
  checks?: ProposalChecks;
  url?: string;
  previewUrl?: string;
  deploy?: ProposalDeploy;
}

export interface ProposalList {
  where: string;
  url?: string;
  branchPrefix: string;
  checksRun: "before-approval" | "after-approval";
  proposals: ProposalSummary[];
}

export interface ProposalFile {
  path: string;
  status: string;
  previousPath?: string;
  additions: number;
  deletions: number;
  patch?: string;
  truncated: boolean;
}

export interface ProposalDetail extends ProposalSummary {
  body: string;
  base: string;
  defaultBranch: string;
  head: string;
  mergeable: boolean | null;
  mergeableState: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: ProposalFile[];
  checks: ProposalChecks;
  checksRun: ProposalList["checksRun"];
}

export interface ProposalsCheck {
  id: string;
  label: string;
  state: "ok" | "missing" | "failing" | "unknown";
  message: string;
}

export interface DeployRecord {
  head: string;
  id?: string;
  message: string;
  at: string;
}

export interface ProposalsStatus {
  connected: boolean;
  where: string;
  branchPrefix: string;
  checks: ProposalsCheck[];
  deploys?: { lastDeploy?: DeployRecord; lastRollback?: DeployRecord; lastFailure?: DeployRecord; deploying?: string };
}

export interface ApproveBody {
  head?: string;
  override?: boolean;
}

export interface RejectBody {
  comment?: string;
}

export interface ApproveResponse {
  id: string;
  head: string;
  merged: boolean;
  message: string;
}

export interface RejectResponse {
  id: string;
  closed: true;
  message: string;
}

export interface ProposalError {
  error: string;
  message?: string;
}
