/**
 * A fake GitHub REST API for proposals-github's tests, served on a free local port: no token or network
 * needed. It keeps one repository's branches (their head commit and its message), pull requests, their
 * files, comments and checks, with GitHub's shapes for what the component reads, and two tokens:
 * `readToken` may read and open pull requests (a token without the merge permission), `mergeToken` may
 * also merge, comment and close. An open pull request's head follows its branch, as GitHub's does.
 * Every request is recorded with the token it carried.
 *
 * Test support: only tests import it (`*.test-support.ts`), so it never reaches a Worker's bundle.
 */

export interface FakePullInput {
  number: number;
  title?: string;
  body?: string;
  branch: string;
  /** The head's repository, `owner/name`: the fake's own unless a fork's. */
  headRepository?: string;
  base?: string;
  state?: "open" | "closed";
  merged?: boolean;
  draft?: boolean;
  sha?: string;
  author?: string;
}

export interface FakeCheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: string | null;
  summary?: string;
}

export interface FakeRequest {
  method: string;
  path: string;
  /** The bearer token it carried. */
  token: string | undefined;
  body: unknown;
}

export interface FakeGitHub {
  /** The `apiBase` to configure. */
  url: string;
  repository: string;
  readToken: string;
  mergeToken: string;
  requests: FakeRequest[];
  addPull(input: FakePullInput): void;
  /** A branch pushed at `sha`, whose head commit says `message`; `files` are what its pull request will list. */
  addBranch(branch: string, sha: string, message: string, files?: { filename: string; status?: string; additions?: number; deletions?: number; patch?: string }[]): void;
  pull(number: number): Record<string, unknown> | undefined;
  setChecks(sha: string, runs: FakeCheckRun[], statuses?: { context: string; state: string; target_url?: string }[]): void;
  setFiles(number: number, files: { filename: string; status?: string; additions?: number; deletions?: number; patch?: string }[]): void;
  /** Comments already on the pull request (a deploy bot's). */
  comments: Map<number, string[]>;
  /** The next answers to every request: GitHub's rate limit, or GitHub down. */
  failWith: "rate_limit" | "secondary_rate_limit" | "down" | undefined;
  /** What `PUT …/merge` answers instead of merging (405 not mergeable, 409 head moved). */
  mergeRefusal: { status: number; message: string } | undefined;
  /** The rules the rulesets apply to the default branch (`GET …/rules/branches/:branch`); none at first. */
  rules: { type: string }[];
  stop(): Promise<void>;
}

export function startFakeGitHub(repository = "ana/bot", defaultBranch = "main"): FakeGitHub {
  const readToken = "read-token-for-tests";
  const mergeToken = "merge-token-for-tests";
  const pulls = new Map<number, Record<string, unknown> & { head: { ref: string; sha: string; repo: { full_name: string } }; state: string }>();
  const checks = new Map<string, { runs: FakeCheckRun[]; statuses: { context: string; state: string; target_url?: string }[] }>();
  const files = new Map<number, Record<string, unknown>[]>();
  const branches = new Map<string, { sha: string; message: string; files: Record<string, unknown>[] }>();
  let numbers = 1000;
  /** An open pull request's head is its branch's. */
  const current = <T extends { head: { ref: string; sha: string }; state: string }>(pull: T): T => {
    const branch = branches.get(pull.head.ref);
    if (pull.state === "open" && branch !== undefined) pull.head.sha = branch.sha;
    return pull;
  };
  const toFiles = (list: { filename: string; status?: string; additions?: number; deletions?: number; patch?: string }[]) =>
    list.map((file) => ({ filename: file.filename, status: file.status ?? "modified", additions: file.additions ?? 1, deletions: file.deletions ?? 0, ...(file.patch !== undefined && { patch: file.patch }) }));
  const requests: FakeRequest[] = [];
  const at = "2026-10-01T10:00:00Z";
  let sequence = 0;

  const fail = (status: number, message: string, headers: Record<string, string> = {}) => Response.json({ message }, { status, headers });

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization") ?? "";
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
      const text = await request.text();
      const body = text === "" ? undefined : JSON.parse(text);
      requests.push({ method: request.method, path: `${url.pathname}${url.search}`, token, body });

      if (fake.failWith === "rate_limit") return fail(403, "API rate limit exceeded", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120) });
      if (fake.failWith === "secondary_rate_limit") return fail(403, "You have exceeded a secondary rate limit", { "retry-after": "30" });
      if (fake.failWith === "down") return fail(503, "Service unavailable");
      if (token !== readToken && token !== mergeToken) return fail(401, "Bad credentials");
      const prefix = `/repos/${repository}`;
      if (url.pathname === prefix && request.method === "GET") return Response.json({ full_name: repository, default_branch: defaultBranch, private: true });
      if (!url.pathname.startsWith(`${prefix}/`)) return fail(404, "Not Found");
      const path = url.pathname.slice(prefix.length);
      const opening = request.method === "POST" && path === "/pulls";
      if (request.method !== "GET" && !opening && token !== mergeToken) return fail(403, "Resource not accessible by personal access token");

      let match: RegExpExecArray | null;
      if (request.method === "GET" && path === `/rules/branches/${defaultBranch}`) return Response.json(fake.rules.map((rule) => ({ ...rule, ruleset_source_type: "Repository", ruleset_id: 1 })));
      if (request.method === "GET" && path === "/pulls") {
        const state = url.searchParams.get("state") ?? "open";
        const perPage = Number(url.searchParams.get("per_page") ?? 30);
        const head = url.searchParams.get("head");
        const owner = repository.split("/")[0];
        return Response.json(
          [...pulls.values()]
            .map(current)
            .filter((pull) => (state === "all" || pull.state === state) && (head === null || `${pull.head.repo.full_name.split("/")[0]}:${pull.head.ref}` === head || (head === `${owner}:${pull.head.ref}` && pull.head.repo.full_name === repository)))
            .reverse()
            .slice(0, perPage),
        );
      }
      if (opening) {
        const input = body as { head: string; base: string; title: string; body: string };
        const branch = branches.get(input.head);
        if (branch === undefined) return fail(422, "Validation Failed: head invalid");
        if ([...pulls.values()].some((pull) => pull.state === "open" && pull.head.ref === input.head)) return fail(422, "A pull request already exists");
        const number = ++numbers;
        files.set(number, branch.files);
        fake.addPull({ number, branch: input.head, base: input.base, title: input.title, body: input.body, sha: branch.sha });
        return Response.json(pulls.get(number), { status: 201 });
      }
      if (request.method === "GET" && path.startsWith("/git/matching-refs/heads/")) {
        const wanted = decodeURIComponent(path.slice("/git/matching-refs/heads/".length));
        return Response.json([...branches.entries()].filter(([name]) => name.startsWith(wanted)).map(([name, branch]) => ({ ref: `refs/heads/${name}`, object: { sha: branch.sha, type: "commit" } })));
      }
      if ((match = /^\/git\/commits\/([0-9a-f]+)$/.exec(path)) !== null) {
        const found = [...branches.values()].find((branch) => branch.sha === match?.[1]);
        return found === undefined ? fail(404, "Not Found") : Response.json({ sha: match[1], message: found.message });
      }
      if ((match = /^\/pulls\/(\d+)$/.exec(path)) !== null) {
        const found = pulls.get(Number(match[1]));
        if (found === undefined) return fail(404, "Not Found");
        const pull = current(found);
        if (request.method === "GET") return Response.json(pull);
        if (request.method === "PATCH" && (body as { state?: string }).state === "closed") {
          pull.state = "closed";
          pull.closed_at = at;
          return Response.json(pull);
        }
        return fail(422, "Validation Failed");
      }
      if ((match = /^\/pulls\/(\d+)\/files$/.exec(path)) !== null) return Response.json(files.get(Number(match[1])) ?? []);
      if ((match = /^\/pulls\/(\d+)\/merge$/.exec(path)) !== null && request.method === "PUT") {
        const found = pulls.get(Number(match[1]));
        if (found === undefined) return fail(404, "Not Found");
        const pull = current(found);
        if (fake.mergeRefusal !== undefined) return fail(fake.mergeRefusal.status, fake.mergeRefusal.message);
        if (pull.state !== "open") return fail(405, "Pull Request is not mergeable");
        if ((body as { sha?: string }).sha !== pull.head.sha) return fail(409, "Head branch was modified. Review and try the merge again.");
        pull.state = "closed";
        pull.merged = true;
        pull.merged_at = at;
        pull.closed_at = at;
        return Response.json({ sha: `${"f".repeat(39)}${++sequence}`, merged: true, message: "Pull Request successfully merged" });
      }
      if ((match = /^\/issues\/(\d+)\/comments$/.exec(path)) !== null) {
        const number = Number(match[1]);
        if (!pulls.has(number)) return fail(404, "Not Found");
        const list = fake.comments.get(number) ?? [];
        if (request.method === "POST") {
          list.push((body as { body: string }).body);
          fake.comments.set(number, list);
          return Response.json({ body: (body as { body: string }).body }, { status: 201 });
        }
        return Response.json(list.map((comment) => ({ body: comment })));
      }
      if ((match = /^\/commits\/([0-9a-f]+)\/check-runs$/.exec(path)) !== null) {
        const runs = checks.get(match[1] as string)?.runs ?? [];
        return Response.json({
          total_count: runs.length,
          check_runs: runs.map((run) => ({
            name: run.name,
            status: run.status,
            conclusion: run.conclusion ?? null,
            html_url: `https://github.com/${repository}/runs/1`,
            details_url: null,
            output: { title: null, summary: run.summary ?? null, text: null },
          })),
        });
      }
      if ((match = /^\/commits\/([0-9a-f]+)\/status$/.exec(path)) !== null) {
        const statuses = checks.get(match[1] as string)?.statuses ?? [];
        // GitHub says `pending` when there is no status at all.
        return Response.json({ state: statuses.length === 0 ? "pending" : statuses[0]?.state, total_count: statuses.length, statuses });
      }
      return fail(404, "Not Found");
    },
  });

  const fake: FakeGitHub = {
    url: `http://127.0.0.1:${server.port}`,
    repository,
    readToken,
    mergeToken,
    requests,
    comments: new Map(),
    failWith: undefined,
    mergeRefusal: undefined,
    rules: [],
    addPull(input) {
      pulls.set(input.number, {
        number: input.number,
        title: input.title ?? `Proposal ${input.number}`,
        body: input.body ?? "",
        state: input.state ?? "open",
        draft: input.draft ?? false,
        merged: input.merged ?? false,
        merged_at: input.merged === true ? at : null,
        created_at: at,
        updated_at: at,
        closed_at: input.state === "closed" ? at : null,
        html_url: `https://github.com/${repository}/pull/${input.number}`,
        user: { login: input.author ?? "pikit-agent" },
        head: { ref: input.branch, sha: input.sha ?? `${"a".repeat(39)}${input.number % 10}`, repo: { full_name: input.headRepository ?? repository } },
        base: { ref: input.base ?? defaultBranch, repo: { full_name: repository, default_branch: defaultBranch } },
        mergeable: true,
        mergeable_state: "clean",
        additions: 3,
        deletions: 1,
        changed_files: files.get(input.number)?.length ?? 0,
      });
    },
    pull: (number) => {
      const pull = pulls.get(number);
      return pull === undefined ? undefined : current(pull);
    },
    addBranch(branch, sha, message, list = []) {
      branches.set(branch, { sha, message, files: toFiles(list) });
    },
    setChecks(sha, runs, statuses = []) {
      checks.set(sha, { runs, statuses });
    },
    setFiles(number, list) {
      files.set(number, toFiles(list));
    },
    stop: () => server.stop(true),
  };
  return fake;
}
