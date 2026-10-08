/**
 * proposals-github's tests, against a fake GitHub on a local port (`fake-github.test-support.ts`): the
 * `proposals` conformance suite, then what it does with GitHub. They are copied with the component and
 * keep running in your project.
 */

import { afterEach, expect, test } from "bun:test";
import { defineApp, defineComponent, type Handle, type Logger, silentLogger } from "@pikit/core";
import { GitHubNotConnectedError, type Proposals, ProposalsError } from "@pikit/contracts";
import { createProposalsConformance } from "@pikit/contracts/testing";
import { type FakeGitHub, startFakeGitHub } from "./fake-github.test-support.ts";
import proposalsGithub, { MAX_PATCH } from "./index.ts";

const OPERATOR = { id: "ops" };
const SHA = "1234567890abcdef1234567890abcdef12345678";

let fakes: FakeGitHub[] = [];
afterEach(async () => {
  await Promise.all(fakes.map((fake) => fake.stop()));
  fakes = [];
});

/**
 * A `github` connected to `state.repository` (none: not connected), whose token is `state.token`,
 * read at each call; `state.asked` counts the tokens asked.
 */
function githubOf(state: { repository: string | undefined; token: string; asked?: number; failing?: string }) {
  return defineComponent({
    name: "github-test",
    setup: (pikit) =>
      pikit.provide("github", {
        repository: async () => state.repository,
        async token() {
          state.asked = (state.asked ?? 0) + 1;
          if (state.failing !== undefined) throw new Error(state.failing);
          if (state.repository === undefined) throw new GitHubNotConnectedError("GitHub is not connected: connect it in the dashboard's Settings → GitHub");
          return state.token;
        },
      }),
  });
}

const hex = (n: number) => n.toString(16).padStart(40, "0");

// The contract, against the fake GitHub: the steward pushes a branch, whose pull request this opens.
for (const c of createProposalsConformance(() => {
  const github = startFakeGitHub();
  let commits = 100;
  const pushed = new Map<string, { message: string; files: { filename: string; status: string; additions: number; patch: string }[] }>();
  return {
    components: () => [githubOf({ repository: github.repository, token: github.mergeToken }), proposalsGithub],
    config: { "proposals-github": { apiBase: github.url } },
    target: "durable",
    async propose({ topic, title, body, file, text }) {
      const head = hex(commits++);
      const files = [{ filename: file, status: "added", additions: text.split("\n").length - 1, patch: `@@ -0,0 +1 @@\n${text.split("\n").filter((line) => line !== "").map((line) => `+${line}`).join("\n")}` }];
      pushed.set(topic, { message: `${title}\n\n${body}`, files });
      github.addBranch(`pikit/self/${topic}`, head, `${title}\n\n${body}`, files);
      return { id: topic, head };
    },
    async pushAgain(id) {
      const head = hex(commits++);
      const before = pushed.get(id);
      github.addBranch(`pikit/self/${id}`, head, before?.message ?? "Again", before?.files ?? []);
      return head;
    },
    async other(branch) {
      github.addBranch(branch, hex(commits++), "Not a proposal");
    },
    dispose: () => github.stop(),
  };
})) {
  test(`proposals-github ${c.group}: ${c.name}`, () => c.run());
}

/** A started App with proposals-github over a fake GitHub, connected through `github` (`access`, which a test may change). */
async function started(options: { github?: FakeGitHub; repository?: string | null; token?: string } = {}) {
  const github = options.github ?? startFakeGitHub();
  fakes.push(github);
  const access: { repository: string | undefined; token: string; asked?: number; failing?: string } = {
    repository: options.repository === null ? undefined : (options.repository ?? github.repository),
    token: options.token ?? github.mergeToken,
  };
  const logged: { message: string; fields: unknown }[] = [];
  const record = (message: string, fields?: unknown) => void logged.push({ message, fields });
  const logger: Logger = { ...silentLogger, info: record, warn: record } as Logger;
  let handle: Handle<Proposals> | undefined;
  const consumer = defineComponent({ name: "consumer-test", setup: (pikit) => void (handle = pikit.use("proposals")) });
  const config = { "proposals-github": { apiBase: github.url } };
  const app = await defineApp({ components: [githubOf(access), proposalsGithub, consumer], config, logger }).create();
  await app.start();
  const proposals = handle?.get() as Proposals;
  const ctx = app.context();
  return { github, app, proposals, ctx, logged, access };
}

/** What `work` rejected with: its code and status, or `ok`. */
async function failure(work: Promise<unknown>): Promise<[string, number] | "ok"> {
  try {
    await work;
    return "ok";
  } catch (error) {
    if (error instanceof ProposalsError) return [error.code, error.status];
    throw error;
  }
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const alone = await defineApp({ components: [proposalsGithub], logger: silentLogger }).create().catch((error: unknown) => error);
  // It requires github: alone it does not compose, and says what is missing.
  expect(String(alone)).toContain("github");
  const { app } = await started();
  expect(app.describe().components.find((component) => component.name === "proposals-github")).toEqual({ name: "proposals-github", provides: ["proposals"], requires: ["github"], optional: [] });
  await app.stop();
});

test("dormant until GitHub is connected: every call but status is not_connected, pointing to Settings → GitHub; no remote", async () => {
  const { github, proposals, ctx, app, access } = await started({ repository: null });
  for (const work of [proposals.list(ctx), proposals.get("a", ctx), proposals.approve("a", { operator: OPERATOR }, ctx), proposals.reject("a", { operator: OPERATOR }, ctx)]) {
    const error = (await work.then(
      () => undefined,
      (thrown: unknown) => thrown,
    )) as ProposalsError | undefined;
    expect([error?.code, error?.status]).toEqual(["not_connected", 503]);
    expect(error?.message).toContain("Settings → GitHub");
  }
  expect(await proposals.remote(ctx)).toBeUndefined();
  expect(github.requests).toEqual([]);

  // Connected through github: the next call reads it.
  access.repository = github.repository;
  github.addPull({ number: 1, branch: "pikit/self/a" });
  expect((await proposals.list(ctx)).proposals.map((proposal) => proposal.id)).toEqual(["a"]);
  await app.stop();
});

test("the token is github's, asked for every call and never kept; github's own failure is said, never the token", async () => {
  const { github, proposals, ctx, app, access } = await started();
  github.addPull({ number: 1, branch: "pikit/self/a" });
  await proposals.list(ctx);
  await proposals.list(ctx);
  expect(access.asked).toBe(2);
  access.token = "rotated-token";
  expect(await failure(proposals.list(ctx))).toEqual(["unauthorized", 502]);
  access.failing = "the installation's token could not be made";
  const error = (await proposals.list(ctx).catch((thrown: unknown) => thrown)) as ProposalsError;
  expect([error.code, error.status, error.message]).toEqual(["unavailable", 502, "GitHub's access failed: the installation's token could not be made"]);
  await app.stop();
});

test("remote: the repository's clone URL, authorized with github's token by trusted code", async () => {
  const { github, proposals, ctx, app } = await started();
  const remote = await proposals.remote(ctx);
  if (remote?.kind !== "https") throw new Error("an https remote");
  expect(remote).toMatchObject({ url: "https://github.com/ana/bot.git", branchPrefix: "pikit/self/", mainBranch: "main" });
  expect(await remote.authorization()).toBe(`Basic ${btoa(`x-access-token:${github.mergeToken}`)}`);
  expect(JSON.stringify(remote)).not.toContain(github.mergeToken);
  await app.stop();
});

test("status: the repository readable, the token accepted, a ruleset advised", async () => {
  const { github, proposals, ctx, app, access } = await started();
  const parts = async () => {
    const status = await proposals.status(ctx);
    return { status, states: status.checks.map((check) => [check.id, check.state]) };
  };
  const first = await parts();
  expect(first.status).toMatchObject({ connected: true, where: "ana/bot on GitHub", branchPrefix: "pikit/self/" });
  expect(first.states).toEqual([
    ["repository", "ok"],
    ["token", "ok"],
    ["ruleset", "missing"],
  ]);
  expect(first.status.checks[2]?.message).toContain("No ruleset requires a pull request on main");

  github.rules = [{ type: "pull_request" }, { type: "required_status_checks" }];
  expect((await parts()).status.checks[2]).toEqual({ id: "ruleset", label: "Ruleset on main (advised)", state: "ok", message: "A ruleset requires a pull request on main, and status checks." });
  github.failWith = "down";
  const down = await parts();
  expect([down.status.connected, ...down.states.map(([, state]) => state)]).toEqual([false, "unknown", "unknown", "unknown"]);
  github.failWith = undefined;

  access.token = "expired-token";
  const refused = await parts();
  expect([refused.status.connected, refused.states[1]?.[1]]).toEqual([false, "failing"]);
  expect(JSON.stringify(refused.status)).not.toContain("expired-token");
  access.repository = "ana/other";
  access.token = github.mergeToken;
  expect((await parts()).states[0]).toEqual(["repository", "failing"]);

  access.repository = undefined;
  const none = await parts();
  expect(none.status.connected).toBe(false);
  expect(none.states).toEqual([
    ["repository", "missing"],
    ["token", "unknown"],
    ["ruleset", "unknown"],
  ]);
  await app.stop();
});

test("the list: open proposals with their checks and preview, then the closed ones; other branches and forks left out", async () => {
  const { github, proposals, ctx, app } = await started();
  github.addPull({ number: 1, branch: "pikit/self/calendar", sha: SHA, title: "A calendar tool" });
  github.addPull({ number: 2, branch: "feature/by-a-person" });
  github.addPull({ number: 3, branch: "pikit/self/from-a-fork", headRepository: "mallory/bot" });
  github.addPull({ number: 4, branch: "pikit/self/merged", state: "closed", merged: true });
  github.addPull({ number: 5, branch: "pikit/self/rejected", state: "closed" });
  github.setChecks(SHA, [
    { name: "checks", status: "completed", conclusion: "success" },
    { name: "Workers Builds: pikit-bot", status: "completed", conclusion: "success", summary: "| Preview URL | https://8a3b2c1d-pikit-bot.ana.workers.dev |" },
  ]);

  const list = await proposals.list(ctx);
  expect(list).toMatchObject({ where: "ana/bot on GitHub", url: "https://github.com/ana/bot/pulls", branchPrefix: "pikit/self/", checksRun: "before-approval" });
  expect(list.proposals.map((proposal) => [proposal.id, proposal.state])).toEqual([
    ["calendar", "open"],
    ["rejected", "closed"],
    ["merged", "merged"],
  ]);
  expect(list.proposals[0]).toMatchObject({
    id: "calendar",
    number: 1,
    title: "A calendar tool",
    author: "pikit-agent",
    branch: "pikit/self/calendar",
    url: "https://github.com/ana/bot/pull/1",
    previewUrl: "https://8a3b2c1d-pikit-bot.ana.workers.dev",
    checks: { state: "passing", passed: 2, failed: 0, pending: 0 },
  });
  expect(list.proposals[1]?.checks).toBeUndefined();
  // With github's token.
  expect(new Set(github.requests.map((request) => request.token))).toEqual(new Set([github.mergeToken]));
  await app.stop();
});

test("a pushed branch without a pull request gets one, titled from its head commit; one closed at its head is never opened again", async () => {
  const { github, proposals, ctx, app, logged } = await started();
  github.addBranch("pikit/self/shorter", SHA, "Shorter answers\n\nWhy: people read on phones.\n");
  github.addBranch("pikit/self/rejected", "9".repeat(40), "Rejected once");
  github.addPull({ number: 4, branch: "pikit/self/rejected", state: "closed", sha: "9".repeat(40) });
  github.addBranch("feature/person", "8".repeat(40), "A person's");

  const list = await proposals.list(ctx);
  expect(list.proposals.map((proposal) => [proposal.id, proposal.state, proposal.title])).toEqual([
    ["shorter", "open", "Shorter answers"],
    ["rejected", "closed", "Proposal 4"],
  ]);
  const opened = github.requests.filter((request) => request.method === "POST");
  expect(opened.map((request) => [request.path, request.token, request.body])).toEqual([
    ["/repos/ana/bot/pulls", github.mergeToken, { head: "pikit/self/shorter", base: "main", title: "Shorter answers", body: "Why: people read on phones." }],
  ]);
  expect(logged.map((line) => line.message)).toContain("proposals-github: opened a pull request for a pushed branch");
  // Listed again: nothing more is opened.
  await proposals.list(ctx);
  expect(github.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect((await proposals.get("shorter", ctx)).body).toBe("Why: people read on phones.");

  // The agent pushes the rejected branch again: a new head, a new pull request.
  github.addBranch("pikit/self/rejected", "7".repeat(40), "Better this time");
  expect((await proposals.get("rejected", ctx)).title).toBe("Better this time");
  await app.stop();
});

test("a proposal: the description, files with bounded patches, checks, mergeable state; a non-proposal is not_found", async () => {
  const { github, proposals, ctx, app } = await started();
  github.setFiles(7, [
    { filename: "src/pikit/tool-calendar/index.ts", status: "added", additions: 40, patch: "@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;" },
    { filename: "big.txt", additions: 9000, patch: `@@ -1 +1 @@\n${"+x\n".repeat(30_000)}` },
    { filename: "logo.png", status: "added" },
  ]);
  github.addPull({ number: 7, branch: "pikit/self/calendar", sha: SHA, body: "Adds **a calendar tool**.\n\nTests: `bun test` passes." });
  github.addPull({ number: 8, branch: "main-fix" });
  github.setChecks(SHA, [{ name: "checks", status: "in_progress" }], [{ context: "ci/other", state: "success" }]);
  github.comments.set(7, ["Deploying with Cloudflare Workers: https://pikit-calendar-pikit-bot.ana.workers.dev"]);

  const detail = await proposals.get("calendar", ctx);
  expect(detail).toMatchObject({
    id: "calendar",
    number: 7,
    body: "Adds **a calendar tool**.\n\nTests: `bun test` passes.",
    base: "main",
    defaultBranch: "main",
    head: SHA,
    mergeable: true,
    mergeableState: "clean",
    changedFiles: 3,
    previewUrl: "https://pikit-calendar-pikit-bot.ana.workers.dev",
    checks: { state: "pending", passed: 1, pending: 1, failed: 0 },
  });
  expect(detail.files.map((file) => [file.path, file.status, file.truncated])).toEqual([
    ["src/pikit/tool-calendar/index.ts", "added", false],
    ["big.txt", "modified", true],
    ["logo.png", "added", false],
  ]);
  expect(detail.files[1]?.patch?.length).toBe(MAX_PATCH);
  expect(detail.files[2]?.patch).toBeUndefined();

  expect(await failure(proposals.get("main-fix", ctx))).toEqual(["not_found", 404]);
  expect(await failure(proposals.get("nothing", ctx))).toEqual(["not_found", 404]);
  expect(await failure(proposals.get("../main", ctx))).toEqual(["not_found", 404]);
  await app.stop();
});

test("approve merges a proposal whose checks pass (squash, its reviewed head), and logs who", async () => {
  const { github, proposals, ctx, app, logged } = await started();
  github.addPull({ number: 3, branch: "pikit/self/prompt", sha: SHA, title: "Shorter answers" });
  github.setChecks(SHA, [{ name: "checks", status: "completed", conclusion: "success" }]);

  expect(await proposals.approve("prompt", { head: SHA, operator: OPERATOR }, ctx)).toMatchObject({ ok: true, id: "prompt", head: SHA, merged: true });
  expect(github.pull(3)).toMatchObject({ state: "closed", merged: true });

  const writes = github.requests.filter((request) => request.method !== "GET");
  expect(writes.map((request) => [request.method, request.path, request.token])).toEqual([["PUT", "/repos/ana/bot/pulls/3/merge", github.mergeToken]]);
  expect(writes[0]?.body).toEqual({ merge_method: "squash", sha: SHA, commit_title: "Shorter answers (#3)" });
  expect(logged).toContainEqual({ message: "proposals-github: approved and merged", fields: { operator: "ops", number: 3, head: SHA, checks: "passing", override: false } });
  expect(JSON.stringify(logged)).not.toContain(github.mergeToken);
  expect(JSON.stringify(logged)).not.toContain(github.readToken);
  await app.stop();
});

test("approve refuses failing, pending or missing checks unless overridden", async () => {
  const { github, proposals, ctx, app, logged } = await started();
  const failing = "1".repeat(40);
  const pending = "2".repeat(40);
  const none = "3".repeat(40);
  github.addPull({ number: 1, branch: "pikit/self/a", sha: failing });
  github.addPull({ number: 2, branch: "pikit/self/b", sha: pending });
  github.addPull({ number: 3, branch: "pikit/self/c", sha: none });
  github.setChecks(failing, [{ name: "checks", status: "completed", conclusion: "failure" }]);
  github.setChecks(pending, [], [{ context: "ci", state: "pending" }]);

  for (const id of ["a", "b", "c"]) {
    expect([id, await proposals.approve(id, { operator: OPERATOR }, ctx)]).toEqual([id, expect.objectContaining({ ok: false, code: "checks_failing" })]);
  }
  expect(github.requests.some((request) => request.method === "PUT")).toBe(false);

  expect((await proposals.approve("a", { override: true, operator: OPERATOR }, ctx)).ok).toBe(true);
  expect(github.pull(1)?.merged).toBe(true);
  expect(logged.at(-1)?.fields).toMatchObject({ number: 1, checks: "failing", override: true });
  await app.stop();
});

test("approve refuses what is not an open proposal into the default branch, or a head that moved", async () => {
  const { github, proposals, ctx, app } = await started();
  github.addPull({ number: 1, branch: "feature/x", sha: SHA });
  github.addPull({ number: 2, branch: "pikit/self/fork", headRepository: "mallory/bot", sha: SHA });
  github.addPull({ number: 3, branch: "pikit/self/elsewhere", base: "release", sha: SHA });
  github.addPull({ number: 4, branch: "pikit/self/done", state: "closed", merged: true, sha: SHA });
  github.addPull({ number: 5, branch: "pikit/self/moved", sha: SHA });
  github.setChecks(SHA, [{ name: "checks", status: "completed", conclusion: "success" }]);

  const refusal = async (id: string, head?: string) => {
    const outcome = await proposals.approve(id, { override: true, operator: OPERATOR, ...(head !== undefined && { head }) }, ctx);
    return outcome.ok ? "approved" : outcome.code;
  };
  expect(await refusal("x")).toBe("not_found");
  expect(await refusal("fork")).toBe("not_found");
  expect(await refusal("elsewhere")).toBe("wrong_base");
  expect(await refusal("done")).toBe("not_open");
  expect(await refusal("moved", "9".repeat(40))).toBe("moved");
  expect(await refusal("nothing")).toBe("not_found");
  expect(github.requests.some((request) => request.method !== "GET")).toBe(false);

  github.mergeRefusal = { status: 405, message: "Pull Request is not mergeable" };
  expect(await refusal("moved")).toBe("not_mergeable");
  github.mergeRefusal = { status: 409, message: "Head branch was modified." };
  expect(await refusal("moved")).toBe("moved");
  await app.stop();
});

test("reject closes the proposal with the operator's comment", async () => {
  const { github, proposals, ctx, app, logged } = await started();
  github.addPull({ number: 6, branch: "pikit/self/risky" });
  github.addPull({ number: 7, branch: "feature/person" });

  expect(await proposals.reject("risky", { comment: "Not now: it reads every file.", operator: OPERATOR }, ctx)).toMatchObject({ ok: true, id: "risky" });
  expect(github.pull(6)).toMatchObject({ state: "closed", merged: false });
  expect(github.comments.get(6)).toEqual(["Not now: it reads every file."]);
  const writes = github.requests.filter((request) => request.method !== "GET");
  expect(writes.map((request) => [request.method, request.path, request.token])).toEqual([
    ["POST", "/repos/ana/bot/issues/6/comments", github.mergeToken],
    ["PATCH", "/repos/ana/bot/pulls/6", github.mergeToken],
  ]);
  expect(logged.at(-1)).toEqual({ message: "proposals-github: rejected and closed", fields: { operator: "ops", number: 6, commented: true } });

  // Without a comment, closed only; a person's pull request is not the dashboard's to close.
  github.addPull({ number: 8, branch: "pikit/self/other" });
  expect((await proposals.reject("other", { operator: OPERATOR }, ctx)).ok).toBe(true);
  expect(github.comments.get(8)).toBeUndefined();
  expect(await proposals.reject("person", { operator: OPERATOR }, ctx)).toMatchObject({ ok: false, code: "not_found" });
  expect(github.pull(7)?.state).toBe("open");
  await app.stop();
});

test("GitHub's errors: a rate limit is 429 with retry-after, a refused token or GitHub down 502, never a token", async () => {
  const { github, proposals, ctx, app } = await started();
  github.failWith = "rate_limit";
  const limited = await proposals.list(ctx).catch((error: unknown) => error as ProposalsError);
  expect([(limited as ProposalsError).code, (limited as ProposalsError).status]).toEqual(["rate_limited", 429]);
  expect((limited as ProposalsError).retryAfter).toBeGreaterThan(60);

  github.failWith = "secondary_rate_limit";
  const secondary = await proposals.get("a", ctx).catch((error: unknown) => error as ProposalsError);
  expect([(secondary as ProposalsError).status, (secondary as ProposalsError).retryAfter]).toEqual([429, 30]);

  github.failWith = "down";
  expect(await failure(proposals.list(ctx))).toEqual(["unavailable", 502]);
  github.failWith = undefined;
  await app.stop();

  const wrong = await started({ token: "expired-token" });
  const refused = await wrong.proposals.list(wrong.ctx).catch((error: unknown) => error as ProposalsError);
  expect([(refused as ProposalsError).code, (refused as ProposalsError).status]).toEqual(["unauthorized", 502]);
  expect((refused as ProposalsError).message).not.toContain("expired-token");
  await wrong.app.stop();
});

test("a token GitHub lets read but not merge: its 403 is forbidden, and nothing is merged", async () => {
  const github = startFakeGitHub();
  const { proposals, ctx, app } = await started({ github, token: github.readToken });
  github.addPull({ number: 2, branch: "pikit/self/b", sha: SHA });
  github.setChecks(SHA, [{ name: "checks", status: "completed", conclusion: "success" }]);
  const error = await proposals.approve("b", { operator: OPERATOR }, ctx).catch((thrown: unknown) => thrown as ProposalsError);
  expect([(error as ProposalsError).code, (error as ProposalsError).status]).toEqual(["forbidden", 502]);
  expect((error as ProposalsError).message).toContain("GitHub's token");
  expect(github.pull(2)?.state).toBe("open");
  await app.stop();
});
