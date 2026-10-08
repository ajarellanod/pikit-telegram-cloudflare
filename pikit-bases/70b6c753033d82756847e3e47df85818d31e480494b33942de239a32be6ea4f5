/** What the list and a proposal's page both show: a proposal's state and its checks, as pills. */

import { type PillTone, StatePill } from "@/components/bui/FilterTable";
import type { ProposalChecks, ProposalState } from "./types";

export const BASE = "/admin-proposals";

export const STATE_TONE: Record<ProposalState, PillTone> = { open: "blue", approved: "orange", merged: "green", failed: "red", closed: "neutral" };
const STATE_LABEL: Record<ProposalState, string> = { open: "open", approved: "approved", merged: "merged", failed: "failed", closed: "rejected" };
export const CHECKS_TONE: Record<ProposalChecks["state"], PillTone> = { passing: "green", failing: "red", pending: "orange", none: "neutral" };

/** A state as the view says it: a closed proposal was rejected; an approved one waits for its deploy. */
export function StateLabel({ state, draft = false }: { state: ProposalState; draft?: boolean }) {
  return (
    <StatePill tone={STATE_TONE[state]}>
      {STATE_LABEL[state]}
      {draft && state === "open" && " · draft"}
    </StatePill>
  );
}

/** The checks in a word and a count: `passing 3/3`, `failing 1`. */
export function ChecksLabel({ checks }: { checks: ProposalChecks }) {
  const total = checks.passed + checks.failed + checks.pending;
  const figure = checks.state === "failing" ? `${checks.failed} of ${total}` : checks.state === "pending" ? `${checks.pending} of ${total}` : checks.state === "passing" ? `${checks.passed}` : "";
  return (
    <StatePill tone={CHECKS_TONE[checks.state]} title={checks.items.map((item) => `${item.name}: ${item.detail}`).join("\n") || "No check ran on this change"}>
      {checks.state === "none" ? "no checks" : checks.state}
      {figure !== "" && ` · ${figure}`}
    </StatePill>
  );
}
