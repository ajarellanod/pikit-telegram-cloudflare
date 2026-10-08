/**
 * admin-proposals' section of the Settings dialog, Self-improvement: connecting the agent's proposals
 * after deploying (features/self-improvement.md). Three parts:
 *
 * - **The repository**, `owner/name`: admin-proposals' setting (its default the config's), and
 *   execution-do's when installed (where the agent may push its branches): saved to both, each
 *   component reading only its own. A change applies to the next request and the next push.
 * - **The connection, checked live** (`GET /admin/api/admin-proposals/status`): the repository, the
 *   read token, the merge token, and whether a ruleset requires a pull request on the default branch.
 * - **The steps**: the two fine-grained tokens and their permissions, where to add them as secrets
 *   (never here: a setting is shown to every operator, a secret is not), and the ruleset to create.
 *
 * The status's JSON is admin-proposals' `ConnectionStatus` (`src/pikit/admin-proposals/api.ts`).
 */

import { GitPullRequest, OpenNewWindow, Refresh } from "iconoir-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/bui/Button";
import { type PillTone, StatePill } from "@/components/bui/FilterTable";
import { ErrorNote } from "@/components/pikit/error-note";
import { SettingsHeading, SettingsRow, storedOf, TextControl } from "@/components/pikit/settings";
import { useApi } from "@/lib/api";
import { defineSettings, useSettings } from "@/lib/settings";

/** admin-proposals' `ConnectionCheck` and `ConnectionStatus` (api.ts). */
interface ConnectionCheck {
  state: "ok" | "missing" | "failing" | "unknown";
  message: string;
}
interface ConnectionStatus {
  connected: boolean;
  repository: string;
  branchPrefix: string;
  tokenSecret: string;
  mergeTokenSecret: string;
  defaultBranch?: string;
  checks: { repository: ConnectionCheck; readToken: ConnectionCheck; mergeToken: ConnectionCheck; ruleset: ConnectionCheck };
}

const TONE: Record<ConnectionCheck["state"], PillTone> = { ok: "green", missing: "orange", failing: "red", unknown: "neutral" };
const LABEL: Record<ConnectionCheck["state"], string> = { ok: "ok", missing: "missing", failing: "failing", unknown: "not checked" };

/** `owner/name` of what was typed or pasted: a GitHub URL, a clone URL, or `owner/name` itself. */
function repositoryOf(text: string): string {
  return text
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

const linkClass = "inline-flex items-center gap-0.5 underline decoration-line-strong underline-offset-2 hover:text-ink";

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={linkClass} href={href} target="_blank" rel="noreferrer">
      {children}
      <OpenNewWindow width={11} height={11} strokeWidth={2} />
    </a>
  );
}

const Code = ({ children }: { children: ReactNode }) => <code className="rounded-[4px] bg-inset px-1 font-mono text-[12px] text-ink">{children}</code>;

/** One step of the instructions: a number, a title, what to do. */
function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 border-b border-line py-4 last:border-b-0">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-inset font-mono text-[12px] text-ink-2">{number}</span>
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-2">
        <div className="mb-1 text-[14px] text-ink">{title}</div>
        {children}
      </div>
    </li>
  );
}

function SelfImprovementSettings() {
  const proposals = useSettings("admin-proposals");
  // execution-do's (where the agent may push): absent on a server, or without it (404), and then not saved.
  const workspace = useSettings("execution-do");
  const status = useApi<ConnectionStatus>("/admin-proposals/status");
  const [failed, setFailed] = useState<Error>();

  if (proposals.error !== undefined && proposals.section === undefined) return <ErrorNote error={proposals.error} title="The self-improvement settings cannot be read" />;
  const section = proposals.section;
  if (section === undefined) return <p className="text-[13px] text-ink-3">Loading</p>;
  const repository = String(section.value.repository ?? "");
  const known = status.data;
  const read = known?.tokenSecret ?? "GITHUB_TOKEN";
  const merge = known?.mergeTokenSecret ?? "PIKIT_MERGE_TOKEN";
  const branch = known?.defaultBranch ?? "main";

  const save = (typed: string) => {
    const next = repositoryOf(typed);
    setFailed(undefined);
    (async () => {
      await proposals.save(storedOf({ repository: next }, section.defaults));
      if (workspace.section !== undefined) await workspace.save(storedOf({ repository: next }, workspace.section.defaults));
      status.reload();
    })().catch((thrown: unknown) => setFailed(thrown instanceof Error ? thrown : new Error(String(thrown))));
  };

  const checks: [string, ConnectionCheck | undefined][] = [
    ["Repository", known?.checks.repository],
    [`${read} (reads)`, known?.checks.readToken],
    [`${merge} (merges)`, known?.checks.mergeToken],
    [`Ruleset on ${branch}`, known?.checks.ruleset],
  ];

  return (
    <div>
      <p className="mb-6 text-[13px] leading-relaxed text-ink-2">
        Your agent can propose changes to itself as pull requests from <Code>{known?.branchPrefix ?? "pikit/self/"}…</Code> branches of your project's GitHub repository; you read each one in
        Proposals and approve it (merged, then deployed) or reject it. It stays off until it is connected: a repository here, two GitHub tokens as secrets, and a rule on GitHub that protects{" "}
        <Code>{branch}</Code>.
      </p>
      {failed !== undefined && (
        <div className="mb-4">
          <ErrorNote error={failed} title="Not saved" />
        </div>
      )}

      <SettingsHeading>Repository</SettingsHeading>
      <SettingsRow
        label="Repository"
        htmlFor="settings-proposals-repository"
        description={
          <>
            <Code>owner/name</Code> on GitHub (a URL works too). Deployed with the Deploy to Cloudflare button? It is the repository the button created in your GitHub account: Cloudflare names it under
            Workers &amp; Pages → your Worker → Settings → Build. Empty turns self-improvement off.
          </>
        }
      >
        <TextControl id="settings-proposals-repository" label="Repository" value={repository} onSave={save} disabled={proposals.saving || workspace.saving} />
      </SettingsRow>

      <SettingsHeading
        aside={
          <Button size="sm" variant="quiet" disabled={status.loading} onClick={status.reload}>
            <Refresh width={14} height={14} strokeWidth={2} />
            Check again
          </Button>
        }
      >
        {known === undefined ? "Connection" : known.connected ? "Connected" : "Not connected yet"}
      </SettingsHeading>
      {status.error !== undefined && known === undefined ? (
        <ErrorNote error={status.error} title="The connection cannot be checked" />
      ) : (
        checks.map(([label, check]) => (
          <SettingsRow key={label} label={label} description={check?.message ?? "Checking"}>
            {check !== undefined && <StatePill tone={TONE[check.state]}>{LABEL[check.state]}</StatePill>}
          </SettingsRow>
        ))
      )}

      <SettingsHeading>How to connect it</SettingsHeading>
      <ol>
        <Step number={1} title="The repository">
          Set it above. The agent pushes only to it, and only branches under <Code>{known?.branchPrefix ?? "pikit/self/"}</Code>.
        </Step>
        <Step number={2} title="Two GitHub tokens">
          Create two{" "}
          <Link href="https://github.com/settings/personal-access-tokens/new">fine-grained personal access tokens</Link>, each with Repository access: <em>Only select repositories</em>, this one
          only.
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <Code>{read}</Code>, the agent's: Contents <em>Read and write</em> (it pushes its branches), Pull requests <em>Read and write</em> (it opens them), Checks <em>Read-only</em>, Commit
              statuses <em>Read-only</em>.
            </li>
            <li>
              <Code>{merge}</Code>, yours, for Approve and Reject: Contents <em>Read and write</em>, Pull requests <em>Read and write</em>. Another token than the agent's: it is never given to it.
            </li>
          </ul>
        </Step>
        <Step number={3} title="Add them as secrets, not here">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              On Cloudflare: <Link href="https://dash.cloudflare.com/?to=/:account/workers-and-pages">Workers &amp; Pages</Link> → your Worker → Settings → Variables and Secrets → Add, type{" "}
              <em>Secret</em>, named <Code>{read}</Code>, then <Code>{merge}</Code>. They apply at once, and stay through every deploy.
            </li>
            <li>
              On a server: <Code>pikit configure</Code> (it offers to connect self-improvement), or both in <Code>.env</Code>; then <Code>pikit up</Code> again.
            </li>
          </ul>
        </Step>
        <Step number={4} title={`Protect ${branch} with a ruleset`}>
          On GitHub,{" "}
          {repository === "" ? (
            "the repository's Settings → Rules → Rulesets"
          ) : (
            <Link href={`https://github.com/${repository}/settings/rules`}>{`${repository}'s Settings → Rules → Rulesets`}</Link>
          )}{" "}
          → New ruleset → New branch ruleset: Enforcement <em>Active</em>, target the default branch, then <em>Require a pull request before merging</em>, <em>Require status checks to pass</em>{" "}
          with <Code>checks</Code> (the project's <Code>.github/workflows/pikit-checks.yml</Code>), and <em>Block force pushes</em>. Nothing then reaches <Code>{branch}</Code> but a pull request,
          even if the agent's token leaks.
        </Step>
      </ol>
    </div>
  );
}

export default defineSettings({
  id: "admin-proposals",
  title: "Self-improvement",
  icon: GitPullRequest,
  group: "Agents",
  order: 10,
  requires: ["settings"],
  keywords: ["proposals", "github", "repository", "token", "ruleset", "pull request", "connect"],
  component: SelfImprovementSettings,
});
