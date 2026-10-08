/**
 * One proposal: the agent's description (markdown), its checks, its deploy, its diff file by file, and
 * Approve / Reject, each behind a confirmation. Approve sends the head commit the page shows, so a
 * branch the agent pushed again since is not approved unread. Where checks run before an approval
 * (CI) and do not pass, the confirmation says so and approves anyway (`override`); where they run
 * after (the deployer), it says what the deployer does.
 */

import { Activity, GitPullRequest, InfoCircle, OpenNewWindow } from "iconoir-react";
import { useState } from "react";
import { Button } from "@/components/bui/Button";
import { ValuePill } from "@/components/bui/Chip";
import EmptyState from "@/components/bui/EmptyState";
import { Page, PageLoading, Section } from "@/components/bui/Page";
import RecordsTable, { type RecordColumn, RecordName, RecordTag } from "@/components/bui/RecordsTable";
import { ErrorNote } from "@/components/pikit/error-note";
import { Markdown } from "@/components/pikit/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { every } from "@/lib/activity";
import { post, useApi } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import { Link } from "@/lib/router";
import { BASE, ChecksLabel, StateLabel } from "./labels";
import type { ApproveBody, ApproveResponse, ProposalCheck, ProposalDetail, ProposalFile, RejectBody, RejectResponse } from "./types";

const CHECK_TONE = { passing: "green", failing: "red", pending: "orange", skipped: "neutral" } as const;
/** A file this long (lines changed) starts folded. */
const FOLDED = 400;

const linkClass = "inline-flex items-center gap-1 underline decoration-line-strong underline-offset-2 hover:text-ink";

/** A line of a unified diff, coloured by what it is. */
function lineClass(line: string): string {
  if (line.startsWith("@@")) return "bg-inset text-ink-3";
  if (line.startsWith("+")) return "bg-green-tint text-ink";
  if (line.startsWith("-")) return "bg-red-tint text-ink";
  return "text-ink-2";
}

function FileDiff({ file }: { file: ProposalFile }) {
  const lines = file.patch?.split("\n") ?? [];
  return (
    <details open={file.additions + file.deletions <= FOLDED} className="group overflow-hidden rounded-card bg-surface shadow-card">
      <summary className="flex h-11 cursor-pointer items-center gap-2 px-4 text-[12.5px] group-open:border-b group-open:border-line">
        <span className="min-w-0 truncate font-mono text-ink" title={file.path}>
          {file.previousPath !== undefined ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        <RecordTag>{file.status}</RecordTag>
        <span className="ml-auto shrink-0 font-mono text-[12px] text-green">+{file.additions}</span>
        <span className="shrink-0 font-mono text-[12px] text-red">-{file.deletions}</span>
      </summary>
      {file.patch === undefined ? (
        <p className="px-4 py-3 text-[12.5px] text-ink-3">
          {file.truncated ? "Not shown: the diff is too large for this page." : "No diff to show: a binary file."}
        </p>
      ) : (
        <div className="overflow-x-auto py-2 font-mono text-[12px] leading-[1.6]">
          {lines.map((line, i) => (
            <div key={i} className={`min-w-max px-4 whitespace-pre ${lineClass(line)}`}>
              {line === "" ? " " : line}
            </div>
          ))}
          {file.truncated && <div className="px-4 pt-2 font-sans text-[12.5px] text-ink-3">Cut here: the rest is too large for this page.</div>}
        </div>
      )}
    </details>
  );
}

const checkColumns: RecordColumn<ProposalCheck>[] = [
  {
    key: "name",
    label: "Check",
    icon: <Activity />,
    width: 320,
    title: (check) => check.name,
    cell: (check) =>
      check.url === undefined ? (
        <RecordName>{check.name}</RecordName>
      ) : (
        <a className="records-name hover:underline" href={check.url} target="_blank" rel="noreferrer">
          {check.name}
        </a>
      ),
  },
  {
    key: "state",
    label: "State",
    icon: <Activity />,
    width: 130,
    cell: (check) => <ValuePill tone={CHECK_TONE[check.state]}>{check.state}</ValuePill>,
  },
  { key: "detail", label: "Detail", icon: <InfoCircle />, width: 300, title: (check) => check.detail, cell: (check) => check.detail },
];

type Dialog = "approve" | "reject" | undefined;

export function ProposalPage({ params }: { params: Record<string, string> }) {
  // Its own state per proposal: another proposal's page starts afresh.
  return <Proposal key={params.id} id={params.id ?? ""} />;
}

function Proposal({ id }: { id: string }) {
  const path = `${BASE}/${encodeURIComponent(id)}`;
  const { data, error, reload } = useApi<ProposalDetail>(path, every(60_000));
  const [dialog, setDialog] = useState<Dialog>();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error>();
  const [done, setDone] = useState<string>();

  if (error !== undefined && data === undefined) {
    return (
      <Page eyebrow={`Proposal ${id}`}>
        <ErrorNote error={error} title="This proposal cannot be read" />
        <Link to={BASE} className="text-[13px] text-ink-2 underline underline-offset-2">
          Back to the proposals
        </Link>
      </Page>
    );
  }
  if (data === undefined) return <PageLoading eyebrow={`Proposal ${id}`} />;

  const name = data.number === undefined ? data.id : `#${data.number}`;
  const after = data.checksRun === "after-approval";
  // Checks that run after an approval are the deployer's: nothing to override.
  const passing = after || data.checks.state === "passing";
  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    setActionError(undefined);
    try {
      if (action === "approve") {
        const body: ApproveBody = { head: data.head, ...(!passing && { override: true }) };
        const answer = await post<ApproveResponse>(`${path}/approve`, body);
        setDone(answer.message);
      } else {
        const body: RejectBody = comment.trim() === "" ? {} : { comment: comment.trim() };
        const answer = await post<RejectResponse>(`${path}/reject`, body);
        setDone(answer.message);
        setComment("");
      }
      reload();
    } catch (thrown) {
      setActionError(thrown instanceof Error ? thrown : new Error(String(thrown)));
      reload();
    } finally {
      setBusy(false);
    }
  };

  const checksWord = data.checks.state === "failing" ? `${data.checks.failed} failing` : data.checks.state === "pending" ? `${data.checks.pending} still running` : "none ran";
  const wrongBase = data.base !== data.defaultBranch;

  return (
    <Page
      eyebrow={`Proposal ${name}`}
      title={data.title}
      aside={
        <>
          <StateLabel state={data.state} draft={data.draft} />
          {data.state === "open" && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDialog("reject")}>
                Reject
              </Button>
              <Button size="sm" variant="primary" disabled={busy || wrongBase} onClick={() => setDialog("approve")}>
                Approve
              </Button>
            </>
          )}
        </>
      }
      description={
        <>
          <span className="text-ink">{data.author}</span> proposes <ValuePill>{data.branch}</ValuePill> into <ValuePill>{data.base}</ValuePill>, updated{" "}
          {formatAgo(Date.parse(data.updatedAt))}: <span className="font-mono text-green">+{data.additions}</span> <span className="font-mono text-red">-{data.deletions}</span> in{" "}
          {data.changedFiles} {data.changedFiles === 1 ? "file" : "files"}.
          {data.url !== undefined && (
            <>
              {" "}
              <a className={linkClass} href={data.url} target="_blank" rel="noreferrer">
                Elsewhere <OpenNewWindow width={12} height={12} />
              </a>
            </>
          )}
          {data.previewUrl !== undefined && (
            <>
              {" · "}
              <a className={linkClass} href={data.previewUrl} target="_blank" rel="noreferrer">
                Preview <OpenNewWindow width={12} height={12} />
              </a>
            </>
          )}
          {" · "}
          <Link to={BASE} className={linkClass}>
            All proposals
          </Link>
        </>
      }
    >
      {done !== undefined && <p className="rounded-card bg-green-tint px-3 py-2.5 text-[13px] text-green">{done}</p>}
      {actionError !== undefined && <ErrorNote error={actionError} title="Not done" />}
      {error !== undefined && <ErrorNote error={error} title="Not read again" />}
      {wrongBase && (
        <p className="rounded-card bg-orange-tint px-3 py-2.5 text-[13px] text-orange">
          It merges into {data.base}, not {data.defaultBranch}, the default branch: it cannot be approved here.
        </p>
      )}
      {data.state === "open" && data.mergeable === false && (
        <p className="rounded-card bg-orange-tint px-3 py-2.5 text-[13px] text-orange">It cannot be merged as it is ({data.mergeableState}): ask the agent to bring it up to date.</p>
      )}
      {data.deploy !== undefined && (
        <p className={`rounded-card px-3 py-2.5 text-[13px] ${data.deploy.outcome === "deployed" ? "bg-green-tint text-green" : data.deploy.outcome === "rolled back" || data.deploy.outcome === "failed" ? "bg-red-tint text-red" : "bg-orange-tint text-orange"}`}>
          Deploy: {data.deploy.outcome}, {formatAgo(Date.parse(data.deploy.at))}. {data.deploy.message}
        </p>
      )}

      <Section title="Description" meta="the agent's">
        <div className="rounded-card bg-surface px-5 py-4 text-[14px] leading-relaxed shadow-card">
          {data.body.trim() === "" ? <span className="text-ink-3">No description.</span> : <Markdown text={data.body} />}
        </div>
      </Section>

      <Section title="Checks" meta={<ChecksLabel checks={data.checks} />}>
        <RecordsTable
          label="The checks of the proposal's head commit"
          columns={checkColumns}
          rows={data.checks.items}
          rowKey={(check) => `${check.name}#${check.url ?? ""}#${check.detail}`}
          empty={
            <EmptyState
              icon={<Activity />}
              title="No check ran"
              hint={after ? "The deployer runs the checks once you approve it, before it deploys: install, typecheck, tests." : "The project's workflow (.github/workflows/pikit-checks.yml) runs on every pull request."}
            />
          }
        />
      </Section>

      <Section title="Changes" meta={data.files.length < data.changedFiles ? `the first ${data.files.length} of ${data.changedFiles} files` : `${data.changedFiles} ${data.changedFiles === 1 ? "file" : "files"}`}>
        {data.files.length === 0 ? (
          <div className="rounded-card bg-surface shadow-card">
            <EmptyState icon={<GitPullRequest />} title="No file changed" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {data.files.map((file) => (
              <FileDiff key={file.path} file={file} />
            ))}
          </div>
        )}
      </Section>

      <AlertDialog open={dialog === "approve"} onOpenChange={(open) => !open && setDialog(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{passing ? `Approve ${name}?` : `Approve ${name} anyway?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {after
                ? `The deployer merges it into ${data.base}, runs the checks, rebuilds and restarts the app, and rolls back if it is unhealthy.`
                : passing
                  ? `It is merged into ${data.base}, and the deploy follows.`
                  : `Its checks did not pass (${checksWord}). Merged into ${data.base} as it is, it deploys untested: approve it only if you read the change.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className={passing ? undefined : "bg-red text-white hover:bg-red/90"} onClick={() => void act("approve")}>
              {after ? "Approve" : passing ? "Approve and merge" : "Approve anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "reject"} onOpenChange={(open) => !open && setDialog(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject {name}?</AlertDialogTitle>
            <AlertDialogDescription>It is closed, never deployed. A comment, if you write one, is kept with it for the agent to read.</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={10_000}
            rows={3}
            placeholder="Why (optional)"
            aria-label="A comment for the agent (optional)"
            className="w-full resize-y rounded-lg bg-field px-3 py-2 text-[13px] text-ink shadow-[var(--shadow-hairline)] outline-none placeholder:text-ink-3"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red text-white hover:bg-red/90" onClick={() => void act("reject")}>
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
