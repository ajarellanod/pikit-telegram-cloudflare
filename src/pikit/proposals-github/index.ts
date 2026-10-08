/**
 * proposals-github: `proposals` as GitHub pull requests (SPEC §6), for Cloudflare. The agent proposes
 * a change as it does on every target: it pushes a branch under `branchPrefix` (`pikit/self/`) to
 * `remote()`, the project's repository. This opens the pull request itself, the first time it lists
 * or reads a branch that has none (its head commit's first line the title, the rest the description);
 * approving squash-merges it through GitHub's API, rejecting comments and closes it. The deploy follows
 * the merge: Workers Builds. A proposal's id is its branch's topic (`pikit/self/<topic>`), the pull
 * request's number beside it.
 *
 * - **GitHub access is the `github` contract's** (`github-access.ts`): the repository and a token,
 *   whichever provider connects them (github-app, github-token). Until GitHub is connected, `list`,
 *   `get` and the actions throw `ProposalsError("not_connected")`, pointing to the dashboard's
 *   Settings → GitHub; `status` checks each part live. The token is asked for each call, never kept.
 *   A ruleset on the default branch (a pull request required, no direct push) is advised: `status`
 *   says whether one applies.
 * - **Only proposals.** A pull request whose head is not a branch under the prefix of this same
 *   repository (a fork's `pikit/self/x` is not) is no proposal: not listed, not read, never merged or
 *   closed. Approve also refuses a base other than the default branch, a head that moved since the
 *   operator read it, and failing, pending or missing checks unless `override` says so.
 * - **GitHub's REST API over `fetch`** (`github.ts`). Its rate limit is `rate_limited` with a
 *   `retryAfter`; a refused token, a missing repository or GitHub down are `502`, saying which.
 * - **`remote`** is `https://github.com/<repository>.git`, authorized with `github`'s token by trusted
 *   code: where the steward clones from and pushes to.
 *
 * Targets: `durable`. On Cloudflare it goes in both Apps (`apps.worker: "default"`): the Worker's App
 * answers the dashboard's routes (admin-proposals there), the objects' App the steward's guide.
 */

import { type AppContext, defineComponent } from "@pikit/core";
import {
  type ApproveOutcome,
  type ProposalChecks,
  type ProposalDetail,
  type ProposalFile,
  type ProposalList,
  type Proposals,
  type ProposalsCheck,
  ProposalsError,
  type ProposalsRemote,
  type ProposalsStatus,
  type ProposalSummary,
  type RejectOutcome,
} from "@pikit/contracts";
import Type from "typebox";
import { CONNECT, createGitHubAccess } from "./github-access.ts";
import { createGitHub, findPreviewUrl, type GitHubClient, GitHubError, type GitHubFile, type GitHubPull } from "./github.ts";

/** Pull requests opened in one call, at most (a Worker's subrequests are counted). */
const OPENED = 5;

/** The most files a proposal lists (GitHub's page). */
export const MAX_FILES = 100;
/** One file's patch is cut past this many characters. */
export const MAX_PATCH = 60_000;
/** Once the patches sent add up to this many characters, the next ones are left out. */
export const MAX_DIFF = 400_000;
/** The longest comment a rejection leaves. */
export const MAX_COMMENT = 10_000;

const Config = Type.Object({
  /** What a proposal's branch starts with. */
  branchPrefix: Type.String({ minLength: 1, default: "pikit/self/" }),
  /** GitHub's REST API. A value, for GitHub Enterprise Server or a test double. */
  apiBase: Type.String({ minLength: 1, default: "https://api.github.com" }),
});

/** Recently closed pull requests read for the list, and closed proposals listed. */
const CLOSED_READ = 30;
const CLOSED_LISTED = 20;
/** Open proposals whose checks the list reads (two requests each: a Worker's subrequests are counted). */
const CHECKED = 20;

const stateOf = (pull: GitHubPull): ProposalSummary["state"] => (pull.state === "open" ? "open" : pull.merged_at !== null ? "merged" : "closed");

/** The repository a call works on, and GitHub's client of it. */
interface Connection {
  repository: string;
  github: GitHubClient;
  isProposal(pull: GitHubPull): boolean;
}

type Refused = { ok: false; code: "not_found" | "not_open" | "moved" | "checks_failing" | "wrong_base" | "not_mergeable"; message: string };
const refused = (code: Refused["code"], message: string): Refused => ({ ok: false, code, message });

/** A head commit's message as a pull request: its first line the title, the rest the description. */
export function pullOfMessage(message: string, branch: string): { title: string; body: string } {
  const [first = "", ...rest] = message.split("\n");
  return { title: first.trim() || branch, body: rest.join("\n").trim() };
}

export default defineComponent({
  name: "proposals-github",
  config: Config,
  setup(pikit, config) {
    const access = createGitHubAccess(pikit);
    /** How every message names the token: the provider's, never a secret's name. */
    const TOKEN = "GitHub's token";
    const prefix = config.branchPrefix;
    const validTopic = (topic: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(topic) && !topic.includes("..") && !topic.endsWith("/");

    /** The repository a call works on; `not_connected` when there is none yet. */
    const connect = async (ctx: AppContext): Promise<Connection> => {
      const repository = await access.repository(ctx);
      if (repository === undefined) {
        throw new ProposalsError("not_connected", 503, `Self-improvement is not connected: GitHub is not. Connect the project's repository in ${CONNECT}`);
      }
      const lower = repository.toLowerCase();
      return {
        repository,
        github: createGitHub(repository, config.apiBase, () => pikit.clock.now()),
        isProposal: (pull) => pull.head.ref.startsWith(prefix) && validTopic(pull.head.ref.slice(prefix.length)) && pull.head.repo?.full_name.toLowerCase() === lower,
      };
    };

    /** `error` from GitHub as a `ProposalsError`; `notFound` for a 404 that means something to the caller. */
    const fromGitHub = (error: GitHubError, secretName: string, repository: string, notFound?: ProposalsError): ProposalsError => {
      if (error.retryAfter !== undefined) return new ProposalsError("rate_limited", 429, `GitHub's rate limit for ${secretName}: try again in ${error.retryAfter} s`, error.retryAfter);
      if (error.status === 401) return new ProposalsError("unauthorized", 502, `GitHub refused ${secretName}: it is wrong, expired or revoked`);
      if (error.status === 403) return new ProposalsError("forbidden", 502, `GitHub refused ${secretName} on ${repository}: ${error.message}. It lacks a permission (proposals-github's README, "Permissions")`);
      if (error.status === 404) return notFound ?? new ProposalsError("missing_repository", 502, `GitHub has no ${repository} that ${secretName} can read: check the repository and its access in ${CONNECT}`);
      if (error.status === 0 || error.status >= 500) return new ProposalsError("unavailable", 502, `GitHub did not answer well (${error.status === 0 ? error.message : `HTTP ${error.status}`}): try again`);
      return new ProposalsError("refused", 502, `GitHub refused (${error.status}): ${error.message}`);
    };

    /** GitHub's answer to `call`, a `ProposalsError` saying why it failed. */
    const ask = async <T>(call: () => Promise<T>, secretName: string, repository: string, notFoundAs?: ProposalsError): Promise<T> => {
      try {
        return await call();
      } catch (error) {
        if (error instanceof GitHubError) throw fromGitHub(error, secretName, repository, notFoundAs);
        throw error;
      }
    };

    const notFound = (repository: string, id: string) => new ProposalsError("not_found", 404, `${repository} has no proposal ${id}: no branch ${prefix}${id}`);
    const topicOf = (pull: GitHubPull) => pull.head.ref.slice(prefix.length);

    const summaryOf = (pull: GitHubPull, checks?: ProposalChecks, previewUrl?: string): ProposalSummary => ({
      id: topicOf(pull),
      number: pull.number,
      title: pull.title,
      author: pull.user?.login ?? "unknown",
      branch: pull.head.ref,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      ...(pull.closed_at !== null && { closedAt: pull.closed_at }),
      state: stateOf(pull),
      draft: pull.draft === true,
      ...(checks !== undefined && { checks }),
      url: pull.html_url,
      ...(previewUrl !== undefined && { previewUrl }),
    });

    /** The files with their patches bounded: each cut at `MAX_PATCH`, none past `MAX_DIFF` in all. */
    const filesOf = (files: readonly GitHubFile[]): ProposalFile[] => {
      let sent = 0;
      return files.slice(0, MAX_FILES).map((file) => {
        const base = {
          path: file.filename,
          status: file.status,
          ...(file.previous_filename !== undefined && { previousPath: file.previous_filename }),
          additions: file.additions,
          deletions: file.deletions,
        };
        if (file.patch === undefined) return { ...base, truncated: false };
        if (sent >= MAX_DIFF) return { ...base, truncated: true };
        const patch = file.patch.slice(0, Math.min(MAX_PATCH, MAX_DIFF - sent));
        sent += patch.length;
        return { ...base, patch, truncated: patch.length < file.patch.length };
      });
    };

    /**
     * Opens the pull request of `branch` at `sha`, from its head commit's message: the agent pushed a
     * branch, which is the proposal. Resolves `undefined` when GitHub refuses (one exists already, or
     * the branch has nothing new): it is opened at a later call, or never.
     */
    const openPull = async ({ repository, github }: Connection, token: string, branch: string, sha: string, base: () => Promise<string>, signal: AbortSignal | undefined, ctx: AppContext) => {
      const { title, body } = pullOfMessage(await ask(() => github.message(token, sha, signal), TOKEN, repository), branch);
      try {
        const pull = await github.open(token, { head: branch, base: await base(), title, body }, signal);
        ctx.logger.info("proposals-github: opened a pull request for a pushed branch", { branch, number: pull.number });
        return pull;
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        if (error.status === 422) return undefined;
        throw fromGitHub(error, TOKEN, repository);
      }
    };

    /** The repository's default branch, read once per call. */
    const defaultBranchOf = (connection: Connection, token: string, signal: AbortSignal | undefined) => {
      let read: Promise<string> | undefined;
      return () => (read ??= ask(() => connection.github.repository(token, signal), TOKEN, connection.repository).then((found) => found.default_branch));
    };

    /**
     * The pull request of proposal `id`: its open one; else, when its branch has a head no pull request
     * was closed at, a new one; else its newest closed one. `undefined` for no proposal.
     */
    const pullOf = async (connection: Connection, id: string, token: string, signal: AbortSignal | undefined, ctx: AppContext): Promise<GitHubPull | undefined> => {
      if (!validTopic(id)) return undefined;
      const { repository, github, isProposal } = connection;
      const branch = `${prefix}${id}`;
      const pulls = (await ask(() => github.pullsOf(token, branch, signal), TOKEN, repository)).filter((pull) => isProposal(pull) && pull.head.ref === branch);
      const open = pulls.find((pull) => pull.state === "open");
      if (open !== undefined) return open;
      const head = (await ask(() => github.branches(token, branch, signal), TOKEN, repository)).find((found) => found.branch === branch);
      if (head !== undefined && !pulls.some((pull) => pull.head.sha === head.sha)) {
        const opened = await openPull(connection, token, branch, head.sha, defaultBranchOf(connection, token, signal), signal, ctx);
        if (opened !== undefined) return opened;
      }
      return pulls[0];
    };

    /** The open proposal `id`, read with `token`, or why it is not one. */
    const openProposal = async (connection: Connection, id: string, token: string, signal: AbortSignal | undefined, ctx: AppContext): Promise<GitHubPull | Refused> => {
      const pull = await pullOf(connection, id, token, signal, ctx);
      if (pull === undefined) return refused("not_found", notFound(connection.repository, id).message);
      if (pull.state !== "open") return refused("not_open", `${id} is already ${stateOf(pull) === "merged" ? "merged" : "rejected"}`);
      return pull;
    };

    const status = async (ctx: AppContext): Promise<ProposalsStatus> => {
      const check = (id: string, label: string, state: ProposalsCheck["state"], message: string): ProposalsCheck => ({ id, label, state, message });
      const repository = await access.repository(ctx);
      if (repository === undefined) {
        return {
          connected: false,
          where: "GitHub (not connected)",
          branchPrefix: prefix,
          checks: [
            check("repository", "Repository", "missing", `GitHub is not connected: connect the project's repository in ${CONNECT}.`),
            check("token", "Token", "unknown", "Not checked: no repository."),
            check("ruleset", "Ruleset (advised)", "unknown", "Not checked: no repository."),
          ],
        };
      }
      let token: string | undefined;
      let tokenCheck: ProposalsCheck;
      try {
        token = await access.token(ctx);
        tokenCheck = check("token", "Token", "unknown", "Not checked yet.");
      } catch (error) {
        tokenCheck = check("token", "Token", error instanceof ProposalsError && error.code === "not_connected" ? "missing" : "failing", error instanceof Error ? error.message : String(error));
      }
      let repositoryCheck = check("repository", "Repository", "unknown", `${repository}: not read without a token.`);
      let rulesetCheck = check("ruleset", "Ruleset (advised)", "unknown", "Not checked: the repository is not read yet.");
      if (token !== undefined) {
        const github = createGitHub(repository, config.apiBase, () => pikit.clock.now());
        try {
          const found = await github.repository(token, ctx.abortSignal);
          repositoryCheck = check("repository", "Repository", "ok", `${found.full_name}, default branch ${found.default_branch}.`);
          tokenCheck = check("token", "Token", "ok", `GitHub accepts it for ${found.full_name}.`);
          const branch = found.default_branch;
          // Best effort: what the rulesets apply to the default branch (a classic branch protection is not listed).
          rulesetCheck = await github.branchRules(token, branch, ctx.abortSignal).then(
            (rules) => {
              const types = new Set(rules.map((rule) => rule.type));
              if (!types.has("pull_request")) return check("ruleset", `Ruleset on ${branch} (advised)`, "missing", `No ruleset requires a pull request on ${branch}: whoever holds a token could push to it. Advised, not needed.`);
              return check("ruleset", `Ruleset on ${branch} (advised)`, "ok", `A ruleset requires a pull request on ${branch}${types.has("required_status_checks") ? ", and status checks" : ""}.`);
            },
            (error: unknown) => check("ruleset", `Ruleset on ${branch} (advised)`, "unknown", `${branch}'s rules could not be read (${error instanceof Error ? error.message : String(error)}).`),
          );
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          if (error.status === 401) tokenCheck = check("token", "Token", "failing", "GitHub refused the token: reconnect GitHub.");
          else if (error.status === 404) repositoryCheck = check("repository", "Repository", "failing", `GitHub has no ${repository} that the token can read: check it in ${CONNECT}.`);
          else {
            const why = error.retryAfter !== undefined ? `GitHub's rate limit: try again in ${error.retryAfter} s` : error.status === 0 ? `GitHub did not answer (${error.message})` : `GitHub answered ${error.status}: ${error.message}`;
            repositoryCheck = check("repository", "Repository", "unknown", `Not checked: ${why}.`);
            tokenCheck = check("token", "Token", "unknown", `Not checked: ${why}.`);
          }
        }
      }
      return {
        connected: repositoryCheck.state === "ok" && tokenCheck.state === "ok",
        where: `${repository} on GitHub`,
        branchPrefix: prefix,
        checks: [repositoryCheck, tokenCheck, rulesetCheck],
      };
    };

    const proposals: Proposals = {
      status,

      async list(ctx) {
        const connection = await connect(ctx);
        const { repository, github, isProposal } = connection;
        const token = await access.token(ctx);
        const signal = ctx.abortSignal;
        const [open, closed, branches] = await Promise.all([
          ask(() => github.pulls(token, "open", 100, signal), TOKEN, repository),
          ask(() => github.pulls(token, "closed", CLOSED_READ, signal), TOKEN, repository),
          ask(() => github.branches(token, prefix, signal), TOKEN, repository),
        ]);
        const found = open.filter(isProposal);
        const closedFound = closed.filter(isProposal);
        // A pushed branch without a pull request, nor one closed at its head, is a proposal to open.
        const base = defaultBranchOf(connection, token, signal);
        const unopened = branches.filter(
          (each) => validTopic(each.branch.slice(prefix.length)) && !found.some((pull) => pull.head.ref === each.branch) && !closedFound.some((pull) => pull.head.ref === each.branch && pull.head.sha === each.sha),
        );
        for (const each of unopened.slice(0, OPENED)) {
          const pull = await openPull(connection, token, each.branch, each.sha, base, signal, ctx);
          if (pull !== undefined) found.unshift(pull);
        }
        // Best effort: a proposal whose checks cannot be read is listed without them.
        const checked = await Promise.all(found.slice(0, CHECKED).map((pull) => github.checks(token, pull.head.sha, signal).catch(() => undefined)));
        const live = new Set(found.map((pull) => pull.head.ref));
        const seen = new Set<string>();
        const list: ProposalList = {
          where: `${repository} on GitHub`,
          url: `https://github.com/${repository}/pulls`,
          branchPrefix: prefix,
          checksRun: "before-approval",
          proposals: [
            ...found.map((pull, i) => summaryOf(pull, checked[i]?.checks, checked[i] === undefined ? undefined : findPreviewUrl(checked[i].texts))),
            // The newest closed pull request of each branch that has no open one: one entry per id.
            ...closedFound
              .filter((pull) => {
                if (live.has(pull.head.ref) || seen.has(pull.head.ref)) return false;
                seen.add(pull.head.ref);
                return true;
              })
              .slice(0, CLOSED_LISTED)
              .map((pull) => summaryOf(pull)),
          ],
        };
        return list;
      },

      async get(id, ctx) {
        const connection = await connect(ctx);
        const { repository, github } = connection;
        const token = await access.token(ctx);
        const signal = ctx.abortSignal;
        const pull = await pullOf(connection, id, token, signal, ctx);
        if (pull === undefined) throw notFound(repository, id);
        const number = pull.number;
        const [full, files, head, comments] = await Promise.all([
          // The pull request alone has its mergeable state and its counts.
          ask(() => github.pull(token, number, signal), TOKEN, repository, notFound(repository, id)),
          ask(() => github.files(token, number, signal), TOKEN, repository),
          ask(() => github.checks(token, pull.head.sha, signal), TOKEN, repository),
          // Only where a preview may be named: best effort.
          github.comments(token, number, signal).catch(() => [] as string[]),
        ]);
        const detail: ProposalDetail = {
          ...summaryOf(full, head.checks, findPreviewUrl([...head.texts, ...comments])),
          checks: head.checks,
          checksRun: "before-approval",
          body: full.body ?? "",
          base: full.base.ref,
          defaultBranch: full.base.repo.default_branch,
          head: full.head.sha,
          mergeable: full.mergeable ?? null,
          mergeableState: full.mergeable_state ?? "unknown",
          additions: full.additions ?? 0,
          deletions: full.deletions ?? 0,
          changedFiles: full.changed_files ?? files.length,
          files: filesOf(files),
        };
        return detail;
      },

      async approve(id, request, ctx): Promise<ApproveOutcome> {
        const connection = await connect(ctx);
        const { repository, github } = connection;
        const token = await access.token(ctx);
        const signal = ctx.abortSignal;
        const pull = await openProposal(connection, id, token, signal, ctx);
        if ("ok" in pull) return pull;
        const number = pull.number;
        if (pull.base.ref !== pull.base.repo.default_branch) {
          return refused("wrong_base", `#${number} would merge into ${pull.base.ref}, not ${pull.base.repo.default_branch}, the default branch`);
        }
        if (request.head !== undefined && request.head !== pull.head.sha) return refused("moved", `${id} changed since you read it: read it again`);
        const { checks } = await ask(() => github.checks(token, pull.head.sha, signal), TOKEN, repository);
        const override = request.override === true;
        if (checks.state !== "passing" && !override) {
          const why = checks.state === "failing" ? `${checks.failed} failing` : checks.state === "pending" ? `${checks.pending} still running` : "none ran";
          return refused("checks_failing", `${id}'s checks: ${why}. Approve it anyway only if you read the change`);
        }
        try {
          await github.merge(token, number, pull.head.sha, `${pull.title} (#${number})`, signal);
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          if (error.status === 409) return refused("moved", `${id} changed since it was checked: read it again`);
          if (error.status === 405 || error.status === 422) return refused("not_mergeable", `GitHub cannot merge #${number}: ${error.message}`);
          throw fromGitHub(error, TOKEN, repository, notFound(repository, id));
        }
        ctx.logger.info("proposals-github: approved and merged", { operator: request.operator.id, number, head: pull.head.sha, checks: checks.state, override: override && checks.state !== "passing" });
        return { ok: true, id, head: pull.head.sha, merged: true, message: `Merged into ${pull.base.ref}: the deploy follows.` };
      },

      async reject(id, request, ctx): Promise<RejectOutcome> {
        const connection = await connect(ctx);
        const { repository, github } = connection;
        const token = await access.token(ctx);
        const signal = ctx.abortSignal;
        const pull = await openProposal(connection, id, token, signal, ctx);
        if ("ok" in pull) return pull;
        const comment = (request.comment ?? "").trim().slice(0, MAX_COMMENT);
        if (comment !== "") await ask(() => github.comment(token, pull.number, comment, signal), TOKEN, repository, notFound(repository, id));
        await ask(() => github.close(token, pull.number, signal), TOKEN, repository, notFound(repository, id));
        ctx.logger.info("proposals-github: rejected and closed", { operator: request.operator.id, number: pull.number, commented: comment !== "" });
        return { ok: true, id, message: "Closed, unmerged." };
      },

      async remote(ctx): Promise<ProposalsRemote | undefined> {
        const repository = await access.repository(ctx);
        if (repository === undefined) return undefined;
        return {
          kind: "https",
          url: `https://github.com/${repository}.git`,
          mainBranch: "main",
          branchPrefix: prefix,
          authorization: async () => {
            const token = await access.token(ctx).catch(() => undefined);
            return token === undefined ? undefined : `Basic ${btoa(`x-access-token:${token}`)}`;
          },
        };
      },
    };
    pikit.provide("proposals", proposals);

  },
});
