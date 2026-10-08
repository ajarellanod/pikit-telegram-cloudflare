/**
 * admin-proposals' section of the Settings dialog, Self-improvement: whether the agent can propose
 * changes to itself and an operator approve them now, part by part, as the `proposals` provider checks
 * them (`GET /admin/api/admin-proposals/status`), and the deploys that follow approvals when the
 * provider runs them (the deployer on a server: running or not, the last deploy, the last rollback).
 * What is set up where is the provider's: a component with settings of its own for it brings its own
 * section (GitHub's, github-app's or github-token's, on Cloudflare), which this one opens.
 */

import { GitPullRequest, Refresh } from "iconoir-react";
import { Button } from "@/components/bui/Button";
import { type PillTone, StatePill } from "@/components/bui/FilterTable";
import { ErrorNote } from "@/components/pikit/error-note";
import { SettingsHeading, SettingsRow } from "@/components/pikit/settings";
import { useApi } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import { defineSettings, settingsSections, useOpenSettingsSection } from "@/lib/settings";

/** The `proposals` contract's status (`@pikit/contracts`; admin-proposals' view has the same, `types.ts`). */
interface ProposalsCheck {
  id: string;
  label: string;
  state: "ok" | "missing" | "failing" | "unknown";
  message: string;
}
interface DeployRecord {
  head: string;
  id?: string;
  message: string;
  at: string;
}
interface ProposalsStatus {
  connected: boolean;
  where: string;
  branchPrefix: string;
  checks: ProposalsCheck[];
  deploys?: { lastDeploy?: DeployRecord; lastRollback?: DeployRecord; lastFailure?: DeployRecord; deploying?: string };
}

const TONE: Record<ProposalsCheck["state"], PillTone> = { ok: "green", missing: "orange", failing: "red", unknown: "neutral" };
const LABEL: Record<ProposalsCheck["state"], string> = { ok: "ok", missing: "missing", failing: "failing", unknown: "not checked" };

function Deploy({ label, record }: { label: string; record: DeployRecord | undefined }) {
  return (
    <SettingsRow label={label} description={record === undefined ? "None yet." : `${record.head.slice(0, 7)}${record.id === undefined ? "" : ` (${record.id})`}, ${formatAgo(Date.parse(record.at))}: ${record.message}`}>
      {null}
    </SettingsRow>
  );
}

function SelfImprovementSettings() {
  const status = useApi<ProposalsStatus>("/admin-proposals/status");
  const open = useOpenSettingsSection();
  const known = status.data;
  // Where it is set up, when a component brings a section for it: a proposals provider's, or GitHub's (`github-*`).
  const providers = settingsSections.filter((section) => section.id.startsWith("proposals-") || section.id.startsWith("github-"));

  return (
    <div>
      <p className="mb-6 text-[13px] leading-relaxed text-ink-2">
        Your agent can propose changes to itself, which you read in Proposals and approve (then deployed) or reject. This checks, now, each part it needs
        {known === undefined ? "." : `: proposals live in ${known.where}.`}
      </p>
      <SettingsHeading
        aside={
          <Button size="sm" variant="quiet" disabled={status.loading} onClick={status.reload}>
            <Refresh width={14} height={14} strokeWidth={2} />
            Check again
          </Button>
        }
      >
        {known === undefined ? "Checking" : known.connected ? "Ready" : "Not ready yet"}
      </SettingsHeading>
      {status.error !== undefined && known === undefined ? (
        <ErrorNote error={status.error} title="Self-improvement cannot be checked" />
      ) : (
        known?.checks.map((check) => (
          <SettingsRow key={check.id} label={check.label} description={check.message}>
            <StatePill tone={TONE[check.state]}>{LABEL[check.state]}</StatePill>
          </SettingsRow>
        ))
      )}
      {known?.deploys !== undefined && (
        <>
          <SettingsHeading>Deploys</SettingsHeading>
          {known.deploys.deploying !== undefined && <SettingsRow label="Now" description={`Deploying ${known.deploys.deploying}.`}>{null}</SettingsRow>}
          <Deploy label="Last deploy" record={known.deploys.lastDeploy} />
          <Deploy label="Last rollback" record={known.deploys.lastRollback} />
          <Deploy label="Last failure" record={known.deploys.lastFailure} />
        </>
      )}
      {providers.map((section) => (
        <div key={section.id} className="mt-6">
          <Button size="sm" variant="secondary" onClick={() => open(section.id)}>
            Set up: {section.title}
          </Button>
        </div>
      ))}
    </div>
  );
}

export default defineSettings({
  id: "admin-proposals",
  title: "Self-improvement",
  icon: GitPullRequest,
  group: "Agents",
  order: 10,
  requires: ["proposals"],
  keywords: ["proposals", "deploy", "deployer", "rollback", "github", "repository"],
  component: SelfImprovementSettings,
});
