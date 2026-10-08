/**
 * admin-proposals: the gate of the agent's changes to itself (SPEC §6). The agent proposes a change as
 * a GitHub pull request from a branch under `branchPrefix` (`pikit/self/`) of the project's
 * repository; the operator reads it in the dashboard (its view, `view/`) and approves (merges) or
 * rejects (closes) it there. The deploy follows the merge: Workers Builds on Cloudflare.
 *
 * - **Dormant until connected.** It starts without a repository or a token. The repository is a
 *   setting (`settings`, when a provider is installed: the dashboard's Settings → Self-improvement,
 *   its section `settings/`), whose default is the config's `repository`; it is read at each request,
 *   so a change applies without a deploy. Until the repository and the read token are there, the
 *   routes answer `503 not_connected`, saying what is missing; `GET …/status` checks each part live.
 * - **Two tokens, never the agent's for a merge.** `tokenSecret` (`GITHUB_TOKEN`, the agent's own in
 *   execution-do) only reads: the pull requests, their files, their checks. `mergeTokenSecret`
 *   (`PIKIT_MERGE_TOKEN`) merges, comments and closes, and only these routes read it: nothing an agent
 *   can call. The same token in both is refused (`503 not_configured`). A ruleset on the default
 *   branch (a pull request required, no direct push) keeps the gate even if the agent's token leaks.
 *   Both are secrets, added where the deployment keeps them, never typed into the dashboard.
 * - **Only proposals.** A pull request whose head is not a branch under the prefix of this same
 *   repository (a fork's `pikit/self/x` is not) is no proposal: not listed, not shown, never merged
 *   or closed. Approve also refuses a base other than the default branch, a head that moved since the
 *   operator read it (`sha`), and failing, pending or missing checks unless `override` says so.
 * - **Every route asks `admin.auth` first** (without a provider, nobody is an operator), and answers
 *   JSON (`api.ts`), errors as `{ error, message }` that name a secret, never hold one. Approve and
 *   reject are logged with the operator and the number.
 * - **GitHub's REST API over `fetch`** (`github.ts`), so the same code serves a server and a Worker.
 *   Its rate limit is `429 rate_limited` with a `retry-after`; a refused token, a missing repository
 *   or GitHub down are `502`, saying which.
 *
 * Targets: `server` and `durable`. On Cloudflare it goes in both Apps (`apps.worker: "default"`): the
 * Worker's App serves its routes (reading the setting through settings-store's Worker half); the
 * objects' copy is never reached, and declares the same setting there (admin-api does the same).
 */

import { type AppContext, defineComponent } from "@pikit/core";
import type { Operator } from "@pikit/contracts";
import Type from "typebox";
import {
  type ApproveResponse,
  type ConnectionCheck,
  type ConnectionStatus,
  MAX_COMMENT,
  MAX_DIFF,
  MAX_FILES,
  MAX_PATCH,
  type ProposalChecks,
  type ProposalDetail,
  type ProposalFile,
  type ProposalList,
  type ProposalSummary,
  type RejectResponse,
} from "./api.ts";
import { createGitHub, findPreviewUrl, type GitHubClient, GitHubError, type GitHubFile, type GitHubPull } from "./github.ts";

export * from "./api.ts";

const NAME = "admin-proposals";
const SECRET_NAME = "^[A-Z][A-Z0-9_]*$";
/** `owner/name`, or empty: not connected. */
const REPOSITORY = "^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)?$";

const Config = Type.Object({
  /**
   * The project's repository on GitHub, `owner/name`, where the agent opens its pull requests: the
   * default of the Self-improvement setting. Empty (the default): not connected until an operator sets
   * it in the dashboard (or here).
   */
  repository: Type.String({ pattern: REPOSITORY, default: "" }),
  /** What a proposal's branch starts with: execution-do's `git.branchPrefix`. */
  branchPrefix: Type.String({ minLength: 1, default: "pikit/self/" }),
  /** The secret holding the token that reads (pull requests, files, checks): the agent's may do. */
  tokenSecret: Type.String({ pattern: SECRET_NAME, default: "GITHUB_TOKEN" }),
  /** The secret holding the token that merges and closes: never the agent's. */
  mergeTokenSecret: Type.String({ pattern: SECRET_NAME, default: "PIKIT_MERGE_TOKEN" }),
  /** GitHub's REST API. A value, for GitHub Enterprise Server or a test double. */
  apiBase: Type.String({ minLength: 1, default: "https://api.github.com" }),
});

/** Its settings: the repository, changed live from the dashboard's Settings → Self-improvement. */
export type ProposalsSettings = { repository: string };

const SettingsSchema = Type.Object(
  {
    repository: Type.String({
      pattern: REPOSITORY,
      title: "Repository",
      description: "The project's repository on GitHub, owner/name: where the agent opens its pull requests. Empty: self-improvement is off.",
    }),
  },
  { additionalProperties: false },
);

/** Recently closed pull requests read for the list, and closed proposals listed. */
const CLOSED_READ = 30;
const CLOSED_LISTED = 20;
/** Open proposals whose checks the list reads (two requests each: a Worker's subrequests are counted). */
const CHECKED = 20;
/** The largest body an action takes. */
const MAX_BODY = 64 * 1024;
const ROUTE = "/admin/api/admin-proposals";
/** Where an operator connects it: the dashboard's section (`settings/`). */
const WHERE = "the dashboard's Settings → Self-improvement";

/** An answer that is not a success. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message ?? code);
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

const stateOf = (pull: GitHubPull): ProposalSummary["state"] => (pull.state === "open" ? "open" : pull.merged_at !== null ? "merged" : "closed");

/** The repository a request works on, and GitHub's client of it. */
interface Connection {
  repository: string;
  github: GitHubClient;
  isProposal(pull: GitHubPull): boolean;
}

export default defineComponent({
  name: NAME,
  config: Config,
  setup(pikit, config) {
    if (config.tokenSecret === config.mergeTokenSecret) {
      throw new Error(`admin-proposals: mergeTokenSecret must name another secret than tokenSecret (both are ${config.tokenSecret}): the merge token is never the agent's`);
    }
    // Its routes answer operators only; without a provider, nobody.
    const auth = pikit.useOptional("admin.auth");
    const secrets = pikit.use("secrets");
    const settings = pikit.useOptional("settings");
    let declared = false;

    /** The repository now: the operator's setting, else the config's (also when the settings cannot be read). */
    const repositoryNow = async (ctx: AppContext): Promise<string> => {
      const store = settings.get();
      if (store === undefined || !declared) return config.repository;
      try {
        return (await store.get<ProposalsSettings>(NAME, ctx)).repository;
      } catch (error) {
        ctx.logger.warn("admin-proposals: its settings could not be read; the config's repository applies", { error: error instanceof Error ? error.message : String(error) });
        return config.repository;
      }
    };

    /** The repository a request works on; `503 not_connected` when there is none yet. */
    const connect = async (ctx: AppContext): Promise<Connection> => {
      const repository = await repositoryNow(ctx);
      if (repository === "") {
        throw new Refusal(503, "not_connected", `Self-improvement is not connected: no repository is set. Set the project's GitHub repository in ${WHERE}`);
      }
      const lower = repository.toLowerCase();
      return {
        repository,
        github: createGitHub(repository, config.apiBase, () => pikit.clock.now()),
        isProposal: (pull) => pull.head.ref.startsWith(config.branchPrefix) && pull.head.repo?.full_name.toLowerCase() === lower,
      };
    };

    const secret = async (name: string, purpose: string): Promise<string> => {
      const value = await secrets.get().get(name);
      if (value === undefined || value === "") {
        throw new Refusal(503, "not_connected", `Self-improvement is not connected: ${name} is not set, the GitHub token admin-proposals ${purpose} with. Add it as a secret: ${WHERE} says how`);
      }
      return value;
    };
    const readToken = () => secret(config.tokenSecret, "reads the proposals");
    /** The merge token, and the read token for the reads around it; refused when they are the same. */
    const tokens = async () => {
      const read = await readToken();
      const merge = await secret(config.mergeTokenSecret, "merges and closes proposals");
      if (merge === read) {
        throw new Refusal(503, "not_configured", `${config.mergeTokenSecret} holds the same token as ${config.tokenSecret}: give merging a token of its own, which the agent never holds`);
      }
      return { read, merge };
    };

    /** `error` from GitHub as an answer; `notFound` for a 404 that means something to the caller. */
    const fromGitHub = (error: GitHubError, secretName: string, repository: string, notFound?: Refusal): Refusal => {
      if (error.retryAfter !== undefined) {
        return new Refusal(429, "rate_limited", `GitHub's rate limit for ${secretName}: try again in ${error.retryAfter} s`, { "retry-after": String(error.retryAfter) });
      }
      if (error.status === 401) return new Refusal(502, "github_unauthorized", `GitHub refused ${secretName}: it is wrong, expired or revoked`);
      if (error.status === 403) return new Refusal(502, "github_forbidden", `GitHub refused ${secretName} on ${repository}: ${error.message}. It lacks a permission (admin-proposals' README, "Tokens")`);
      if (error.status === 404) return notFound ?? new Refusal(502, "github_not_found", `GitHub has no ${repository} that ${secretName} can read: check the repository in ${WHERE}, and the token's repositories`);
      if (error.status === 0 || error.status >= 500) return new Refusal(502, "github_unavailable", `GitHub did not answer well (${error.status === 0 ? error.message : `HTTP ${error.status}`}): try again`);
      return new Refusal(502, "github_refused", `GitHub refused (${error.status}): ${error.message}`);
    };

    const notFound = (repository: string, number: number) => new Refusal(404, "not_found", `${repository} has no pull request #${number}`);
    const notProposal = (repository: string, number: number, status: number) =>
      new Refusal(status, "not_a_proposal", `#${number} is not a proposal: its branch is not under ${config.branchPrefix} of ${repository}`);

    const summaryOf = (pull: GitHubPull, checks?: ProposalChecks, previewUrl?: string): ProposalSummary => ({
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

    /** The operator, or a `401`; then `work`'s answer, a refusal as JSON. */
    const route =
      (work: (request: Request, ctx: AppContext, operator: Operator) => Promise<Response>) =>
      async (request: Request, ctx: AppContext): Promise<Response> => {
        const operator = await auth.get()?.verify(request, ctx);
        if (operator === undefined) return json({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer realm="pikit"' });
        try {
          return await work(request, ctx, operator);
        } catch (error) {
          if (error instanceof Refusal) return json({ error: error.code, message: error.message }, error.status, error.headers);
          throw error;
        }
      };

    /** `:number` of the request's path. */
    const numberOf = (request: Request): number => {
      const segment = new URL(request.url).pathname.split("/")[4] ?? "";
      if (!/^[1-9][0-9]{0,9}$/.test(segment)) throw new Refusal(404, "not_found", "a proposal is named by its pull request's number");
      return Number(segment);
    };

    /** The request's JSON object (`{}` when it has no body). */
    const bodyOf = async (request: Request): Promise<Record<string, unknown>> => {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw new Refusal(413, "too_large");
      const text = await request.text();
      if (text.length > MAX_BODY) throw new Refusal(413, "too_large");
      if (text.trim() === "") return {};
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Refusal(400, "invalid_request", "the body is not JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Refusal(400, "invalid_request", "the body is a JSON object");
      return body as Record<string, unknown>;
    };

    /** GitHub's answer to `call`, a refusal saying why it failed. */
    const ask = async <T>(call: () => Promise<T>, secretName: string, repository: string, notFoundAs?: Refusal): Promise<T> => {
      try {
        return await call();
      } catch (error) {
        if (error instanceof GitHubError) throw fromGitHub(error, secretName, repository, notFoundAs);
        throw error;
      }
    };

    /** The open proposal `number`, read with `token`: refused when it is not one, or not open. */
    const openProposal = async ({ repository, github, isProposal }: Connection, number: number, token: string, signal: AbortSignal | undefined) => {
      const pull = await ask(() => github.pull(token, number, signal), config.tokenSecret, repository, notFound(repository, number));
      if (!isProposal(pull)) throw notProposal(repository, number, 409);
      if (pull.state !== "open") throw new Refusal(409, "not_open", `#${number} is already ${stateOf(pull)}`);
      return pull;
    };

    /** Each part of the connection, checked now: what the Settings section shows. */
    const status = async (ctx: AppContext): Promise<ConnectionStatus> => {
      const repository = await repositoryNow(ctx);
      const read = await secrets.get().get(config.tokenSecret);
      const merge = await secrets.get().get(config.mergeTokenSecret);
      const has = (value: string | undefined): value is string => value !== undefined && value !== "";
      const check = (state: ConnectionCheck["state"], message: string): ConnectionCheck => ({ state, message });
      let defaultBranch: string | undefined;

      let repositoryCheck = repository === "" ? check("missing", "No repository is set.") : check("unknown", `Not checked: ${config.tokenSecret} is not set, to read ${repository} with.`);
      let readCheck = has(read) ? check("unknown", "Not checked: no repository to read.") : check("missing", `${config.tokenSecret} is not set.`);
      let rulesetCheck = check("unknown", "Not checked: the repository is not read yet.");
      if (repository !== "" && has(read)) {
        const github = createGitHub(repository, config.apiBase, () => pikit.clock.now());
        try {
          const found = await github.repository(read, ctx.abortSignal);
          defaultBranch = found.default_branch;
          repositoryCheck = check("ok", `${found.full_name}, default branch ${found.default_branch}.`);
          readCheck = check("ok", `It reads ${found.full_name}.`);
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          if (error.status === 401) readCheck = check("failing", `GitHub refused ${config.tokenSecret}: it is wrong, expired or revoked.`);
          else if (error.status === 404) {
            repositoryCheck = check("failing", `GitHub has no ${repository} that ${config.tokenSecret} can read: check the name, and that the token's repositories include it.`);
            readCheck = check("unknown", `It cannot read ${repository} (GitHub answers the same when the repository does not exist).`);
          } else {
            const why = error.retryAfter !== undefined ? `GitHub's rate limit: try again in ${error.retryAfter} s` : error.status === 0 ? `GitHub did not answer (${error.message})` : `GitHub answered ${error.status}: ${error.message}`;
            repositoryCheck = check("unknown", `Not checked: ${why}.`);
            readCheck = check("unknown", `Not checked: ${why}.`);
          }
        }
        if (defaultBranch !== undefined) {
          const branch = defaultBranch;
          // Best effort: what the rulesets apply to the default branch (a classic branch protection is not listed).
          rulesetCheck = await github.branchRules(read, branch, ctx.abortSignal).then(
            (rules) => {
              const types = new Set(rules.map((rule) => rule.type));
              if (!types.has("pull_request")) return check("missing", `No ruleset requires a pull request on ${branch}: the agent's token could push to it.`);
              return check("ok", `A ruleset requires a pull request on ${branch}${types.has("required_status_checks") ? ", and status checks" : ""}.`);
            },
            (error: unknown) => check("unknown", `${branch}'s rules could not be read (${error instanceof Error ? error.message : String(error)}).`),
          );
        }
      }
      const mergeCheck = !has(merge)
        ? check("missing", `${config.mergeTokenSecret} is not set: proposals can be read, not approved or rejected.`)
        : merge === read
          ? check("failing", `${config.mergeTokenSecret} holds the same token as ${config.tokenSecret}: give merging a token of its own.`)
          : check("ok", `Set, and another token than ${config.tokenSecret}. It is used only when you approve or reject.`);
      return {
        connected: repositoryCheck.state === "ok" && readCheck.state === "ok" && mergeCheck.state === "ok",
        repository,
        branchPrefix: config.branchPrefix,
        tokenSecret: config.tokenSecret,
        mergeTokenSecret: config.mergeTokenSecret,
        ...(defaultBranch !== undefined && { defaultBranch }),
        checks: { repository: repositoryCheck, readToken: readCheck, mergeToken: mergeCheck, ruleset: rulesetCheck },
      };
    };

    pikit.provideKeyed(
      "http.route",
      `GET ${ROUTE}/status`,
      route(async (_request, ctx) => json(await status(ctx))),
    );

    pikit.provideKeyed(
      "http.route",
      `GET ${ROUTE}`,
      route(async (_request, ctx) => {
        const connection = await connect(ctx);
        const { repository, github, isProposal } = connection;
        const token = await readToken();
        const signal = ctx.abortSignal;
        const [open, closed] = await Promise.all([
          ask(() => github.pulls(token, "open", 100, signal), config.tokenSecret, repository),
          ask(() => github.pulls(token, "closed", CLOSED_READ, signal), config.tokenSecret, repository),
        ]);
        const proposals = open.filter(isProposal);
        // Best effort: a proposal whose checks cannot be read is listed without them.
        const checked = await Promise.all(proposals.slice(0, CHECKED).map((pull) => github.checks(token, pull.head.sha, signal).catch(() => undefined)));
        const list: ProposalList = {
          repository,
          branchPrefix: config.branchPrefix,
          proposals: [
            ...proposals.map((pull, i) => summaryOf(pull, checked[i]?.checks, checked[i] === undefined ? undefined : findPreviewUrl(checked[i].texts))),
            ...closed
              .filter(isProposal)
              .slice(0, CLOSED_LISTED)
              .map((pull) => summaryOf(pull)),
          ],
        };
        return json(list);
      }),
    );

    pikit.provideKeyed(
      "http.route",
      `GET ${ROUTE}/:number`,
      route(async (request, ctx) => {
        const number = numberOf(request);
        const { repository, github, isProposal } = await connect(ctx);
        const token = await readToken();
        const signal = ctx.abortSignal;
        const pull = await ask(() => github.pull(token, number, signal), config.tokenSecret, repository, notFound(repository, number));
        if (!isProposal(pull)) throw notProposal(repository, number, 404);
        const [files, head, comments] = await Promise.all([
          ask(() => github.files(token, number, signal), config.tokenSecret, repository),
          ask(() => github.checks(token, pull.head.sha, signal), config.tokenSecret, repository),
          // Only where a preview may be named: best effort.
          github.comments(token, number, signal).catch(() => [] as string[]),
        ]);
        const detail: ProposalDetail = {
          ...summaryOf(pull, head.checks, findPreviewUrl([...head.texts, ...comments])),
          checks: head.checks,
          body: pull.body ?? "",
          base: pull.base.ref,
          defaultBranch: pull.base.repo.default_branch,
          headSha: pull.head.sha,
          mergeable: pull.mergeable ?? null,
          mergeableState: pull.mergeable_state ?? "unknown",
          additions: pull.additions ?? 0,
          deletions: pull.deletions ?? 0,
          changedFiles: pull.changed_files ?? files.length,
          files: filesOf(files),
        };
        return json(detail);
      }),
    );

    pikit.provideKeyed(
      "http.route",
      `POST ${ROUTE}/:number/approve`,
      route(async (request, ctx, operator) => {
        const number = numberOf(request);
        const body = await bodyOf(request);
        if (body.override !== undefined && typeof body.override !== "boolean") throw new Refusal(400, "invalid_request", "override is true or false");
        if (body.sha !== undefined && (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha))) throw new Refusal(400, "invalid_request", "sha is a commit's 40 hexadecimal digits");
        const override = body.override === true;
        const connection = await connect(ctx);
        const { repository, github } = connection;
        const { read, merge } = await tokens();
        const signal = ctx.abortSignal;
        const pull = await openProposal(connection, number, read, signal);
        if (pull.base.ref !== pull.base.repo.default_branch) {
          throw new Refusal(409, "wrong_base", `#${number} would merge into ${pull.base.ref}, not ${pull.base.repo.default_branch}, the default branch`);
        }
        if (body.sha !== undefined && body.sha !== pull.head.sha) throw new Refusal(409, "changed", `#${number} changed since you read it: read it again`);
        const { checks } = await ask(() => github.checks(read, pull.head.sha, signal), config.tokenSecret, repository);
        if (checks.state !== "passing" && !override) {
          const why = checks.state === "failing" ? `${checks.failed} failing` : checks.state === "pending" ? `${checks.pending} still running` : "none ran";
          throw new Refusal(409, "checks_failing", `#${number}'s checks: ${why}. Approve it anyway only if you read the change`);
        }
        let sha: string;
        try {
          sha = await github.merge(merge, number, pull.head.sha, `${pull.title} (#${number})`, signal);
        } catch (error) {
          if (!(error instanceof GitHubError)) throw error;
          if (error.status === 409) throw new Refusal(409, "changed", `#${number} changed since it was checked: read it again`);
          if (error.status === 405 || error.status === 422) throw new Refusal(409, "not_mergeable", `GitHub cannot merge #${number}: ${error.message}`);
          throw fromGitHub(error, config.mergeTokenSecret, repository, notFound(repository, number));
        }
        ctx.logger.info("admin-proposals: approved and merged", { operator: operator.id, number, head: pull.head.sha, checks: checks.state, override: override && checks.state !== "passing" });
        const answer: ApproveResponse = { number, merged: true, sha };
        return json(answer);
      }),
    );

    pikit.provideKeyed(
      "http.route",
      `POST ${ROUTE}/:number/reject`,
      route(async (request, ctx, operator) => {
        const number = numberOf(request);
        const body = await bodyOf(request);
        if (body.comment !== undefined && (typeof body.comment !== "string" || body.comment.length > MAX_COMMENT)) {
          throw new Refusal(400, "invalid_request", `comment is text of at most ${MAX_COMMENT} characters`);
        }
        const comment = typeof body.comment === "string" ? body.comment.trim() : "";
        const connection = await connect(ctx);
        const { repository, github } = connection;
        const { read, merge } = await tokens();
        const signal = ctx.abortSignal;
        await openProposal(connection, number, read, signal);
        if (comment !== "") await ask(() => github.comment(merge, number, comment, signal), config.mergeTokenSecret, repository, notFound(repository, number));
        await ask(() => github.close(merge, number, signal), config.mergeTokenSecret, repository, notFound(repository, number));
        ctx.logger.info("admin-proposals: rejected and closed", { operator: operator.id, number, commented: comment !== "" });
        const answer: RejectResponse = { number, closed: true };
        return json(answer);
      }),
    );

    return {
      start() {
        const store = settings.get();
        if (store === undefined) return;
        store.declare(NAME, SettingsSchema, { repository: config.repository });
        declared = true;
      },
      stop() {
        declared = false;
      },
    };
  },
});
