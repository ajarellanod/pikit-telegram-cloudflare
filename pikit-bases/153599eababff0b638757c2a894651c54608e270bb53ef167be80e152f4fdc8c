/**
 * The few GitHub REST API calls proposals-github makes (https://docs.github.com/rest), over `fetch`, so
 * the same code runs on a server and in a Worker. A thin client of our own: a handful of endpoints.
 *
 * Each call is given its token: the read token for reads, the merge token for the merge, the comment
 * and the close (`index.ts` chooses). A token goes only in the `authorization` header of a request to
 * `apiBase`; `GitHubError` carries GitHub's status and message, never a header or a token.
 */

import type { ProposalCheck, ProposalChecks } from "@pikit/contracts";

/** How long one call to GitHub may take. */
const TIMEOUT_MS = 15_000;

/** A call to GitHub that failed: GitHub's status (0 when it was not reached) and message. */
export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds until GitHub's rate limit lets the token in again, when that is why. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }

  /** Whether GitHub refused because of a rate limit (primary or secondary). */
  get rateLimited(): boolean {
    return this.retryAfter !== undefined;
  }
}

export interface GitHubPull {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft?: boolean;
  merged_at: string | null;
  merged?: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  user: { login: string } | null;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string; default_branch: string } };
  mergeable?: boolean | null;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface GitHubFile {
  filename: string;
  status: string;
  previous_filename?: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GitHubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string | null;
  details_url?: string | null;
  output?: { title?: string | null; summary?: string | null; text?: string | null } | null;
}

interface GitHubStatus {
  context: string;
  state: string;
  description?: string | null;
  target_url?: string | null;
}

/** The head commit's checks, and the texts a preview's URL may be found in. */
export interface HeadChecks {
  checks: ProposalChecks;
  /** The check runs' output and links, the statuses' links: where Workers Builds names its preview. */
  texts: string[];
}

/** The repository, as GitHub answers it. */
export interface GitHubRepository {
  full_name: string;
  default_branch: string;
}

/** One rule that applies to a branch (a ruleset's): `pull_request`, `required_status_checks`, `non_fast_forward`… */
export interface GitHubBranchRule {
  type: string;
}

export interface GitHubClient {
  /** The repository itself: whether the token reads it, and its default branch. */
  repository(token: string, signal?: AbortSignal): Promise<GitHubRepository>;
  /** The rules the repository's rulesets apply to `branch` (not a classic branch protection's). */
  branchRules(token: string, branch: string, signal?: AbortSignal): Promise<GitHubBranchRule[]>;
  pulls(token: string, state: "open" | "closed", perPage: number, signal?: AbortSignal): Promise<GitHubPull[]>;
  /** The pull requests whose head is `branch` of the repository itself, newest first (open and closed). */
  pullsOf(token: string, branch: string, signal?: AbortSignal): Promise<GitHubPull[]>;
  /** The branches starting with `prefix`, with their head commits. */
  branches(token: string, prefix: string, signal?: AbortSignal): Promise<{ branch: string; sha: string }[]>;
  /** A commit's message. */
  message(token: string, sha: string, signal?: AbortSignal): Promise<string>;
  /** Opens a pull request from `head` into `base`. */
  open(token: string, input: { head: string; base: string; title: string; body: string }, signal?: AbortSignal): Promise<GitHubPull>;
  pull(token: string, number: number, signal?: AbortSignal): Promise<GitHubPull>;
  files(token: string, number: number, signal?: AbortSignal): Promise<GitHubFile[]>;
  checks(token: string, sha: string, signal?: AbortSignal): Promise<HeadChecks>;
  /** The pull request's comments' bodies (the first page): where a deploy bot names its preview. */
  comments(token: string, number: number, signal?: AbortSignal): Promise<string[]>;
  /** Squash-merges the pull request if its head is still `sha`; resolves with the new commit. */
  merge(token: string, number: number, sha: string, title: string, signal?: AbortSignal): Promise<string>;
  comment(token: string, number: number, body: string, signal?: AbortSignal): Promise<void>;
  close(token: string, number: number, signal?: AbortSignal): Promise<void>;
}

/** Conclusions of a completed check run that do not block: it ran and found nothing wrong. */
const PASSING = new Set(["success", "neutral"]);
const SKIPPED = new Set(["skipped"]);

/** `runs` and `statuses` as one summary (`ProposalChecks`). */
export function summarizeChecks(runs: readonly GitHubCheckRun[], statuses: readonly GitHubStatus[]): ProposalChecks {
  const items: ProposalCheck[] = [
    ...runs.map((run): ProposalCheck => {
      const url = run.html_url ?? run.details_url ?? undefined;
      const base = { name: run.name, ...(url !== undefined && { url }) };
      if (run.status !== "completed") return { ...base, state: "pending", detail: run.status };
      const conclusion = run.conclusion ?? "unknown";
      return { ...base, state: PASSING.has(conclusion) ? "passing" : SKIPPED.has(conclusion) ? "skipped" : "failing", detail: conclusion };
    }),
    ...statuses.map((status): ProposalCheck => {
      const base = { name: status.context, ...(status.target_url != null && { url: status.target_url }) };
      const state = status.state === "success" ? "passing" : status.state === "pending" ? "pending" : "failing";
      return { ...base, state, detail: status.description ?? status.state };
    }),
  ];
  const count = (state: ProposalCheck["state"]) => items.filter((item) => item.state === state).length;
  const passed = count("passing");
  const failed = count("failing");
  const pending = count("pending");
  const state = failed > 0 ? "failing" : pending > 0 ? "pending" : passed > 0 ? "passing" : "none";
  return { state, passed, failed, pending, items };
}

/** A Cloudflare Worker's preview URL (`https://<…>.workers.dev/…`) in `texts`, the first one found. */
export function findPreviewUrl(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    const found = /https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.workers\.dev(?:\/[^\s)"'<>\]`|]*)?/.exec(text);
    if (found !== null) return found[0];
  }
  return undefined;
}

/** GitHub's `message`, cut short: it says why, and never holds a token. */
async function messageOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return typeof body?.message === "string" ? body.message.slice(0, 300) : `HTTP ${response.status}`;
}

/** Seconds to wait when `response` is GitHub's rate limit (a 429, or a 403 with no requests left or a `retry-after`). */
function retryAfterOf(response: Response, now: number): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined;
  const retry = Number(response.headers.get("retry-after"));
  if (response.headers.has("retry-after") && Number.isFinite(retry)) return Math.max(1, Math.ceil(retry));
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    return Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil(reset - now / 1000)) : 60;
  }
  return response.status === 429 ? 60 : undefined;
}

/** A GitHub client of `repository` (`owner/name`) at `apiBase`. */
export function createGitHub(repository: string, apiBase: string, now: () => number = Date.now, fetcher: typeof fetch = fetch): GitHubClient {
  const root = `${apiBase.replace(/\/+$/, "")}/repos/${repository}`;

  async function call<T>(token: string, method: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<T> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher(`${root}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "pikit-proposals-github",
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      // Not reached: the network, a timeout. The URL and the headers are not repeated.
      throw new GitHubError(0, error instanceof Error && error.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : "unreachable");
    }
    if (!response.ok) throw new GitHubError(response.status, await messageOf(response), retryAfterOf(response, now()));
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  return {
    repository: (token, signal) => call<GitHubRepository>(token, "GET", "", undefined, signal),
    branchRules: (token, branch, signal) => call<GitHubBranchRule[]>(token, "GET", `/rules/branches/${encodeURIComponent(branch)}?per_page=100`, undefined, signal),
    pulls: (token, state, perPage, signal) =>
      call<GitHubPull[]>(token, "GET", `/pulls?state=${state}&sort=${state === "open" ? "created" : "updated"}&direction=desc&per_page=${perPage}`, undefined, signal),
    pull: (token, number, signal) => call<GitHubPull>(token, "GET", `/pulls/${number}`, undefined, signal),
    pullsOf: (token, branch, signal) =>
      call<GitHubPull[]>(token, "GET", `/pulls?state=all&head=${encodeURIComponent(`${repository.split("/")[0]}:${branch}`)}&sort=created&direction=desc&per_page=10`, undefined, signal),
    async branches(token, prefix, signal) {
      const refs = await call<{ ref: string; object: { sha: string } }[]>(token, "GET", `/git/matching-refs/heads/${prefix.split("/").map(encodeURIComponent).join("/")}`, undefined, signal);
      return refs.map((ref) => ({ branch: ref.ref.replace(/^refs\/heads\//, ""), sha: ref.object.sha }));
    },
    message: async (token, sha, signal) => (await call<{ message: string }>(token, "GET", `/git/commits/${sha}`, undefined, signal)).message,
    open: (token, input, signal) => call<GitHubPull>(token, "POST", "/pulls", input, signal),
    files: (token, number, signal) => call<GitHubFile[]>(token, "GET", `/pulls/${number}/files?per_page=100`, undefined, signal),
    async checks(token, sha, signal) {
      const [runs, combined] = await Promise.all([
        call<{ check_runs: GitHubCheckRun[] }>(token, "GET", `/commits/${sha}/check-runs?per_page=100`, undefined, signal),
        call<{ statuses: GitHubStatus[] }>(token, "GET", `/commits/${sha}/status?per_page=100`, undefined, signal),
      ]);
      const texts = [
        ...runs.check_runs.flatMap((run) => [run.output?.summary, run.output?.text, run.output?.title, run.details_url]),
        ...combined.statuses.flatMap((status) => [status.target_url, status.description]),
      ].filter((text): text is string => typeof text === "string" && text !== "");
      return { checks: summarizeChecks(runs.check_runs, combined.statuses), texts };
    },
    async comments(token, number, signal) {
      const comments = await call<{ body?: string | null }[]>(token, "GET", `/issues/${number}/comments?per_page=100`, undefined, signal);
      return comments.map((comment) => comment.body ?? "").filter((body) => body !== "");
    },
    async merge(token, number, sha, title, signal) {
      const merged = await call<{ sha: string }>(token, "PUT", `/pulls/${number}/merge`, { merge_method: "squash", sha, commit_title: title }, signal);
      return merged.sha;
    },
    async comment(token, number, body, signal) {
      await call(token, "POST", `/issues/${number}/comments`, { body }, signal);
    },
    async close(token, number, signal) {
      await call(token, "PATCH", `/pulls/${number}`, { state: "closed" }, signal);
    },
  };
}
