/**
 * admin-proposals' tests, against a fake GitHub on a local port (`fake-github.test-support.ts`). They
 * are copied with the component and keep running in your project.
 */

import { afterEach, expect, test } from "bun:test";
import { type AppContext, BACKGROUND_CONTEXT, defineApp, defineComponent, type KeyedHandle, type Logger, silentLogger } from "@pikit/core";
import { type AdminAuth, type HttpRoute, type Settings, SettingsError, type SettingsSchema, type SettingsValue } from "@pikit/contracts";
import { type FakeGitHub, startFakeGitHub } from "./fake-github.test-support.ts";
import adminProposals, { type ConnectionStatus, MAX_PATCH, type ProposalDetail, type ProposalError, type ProposalList } from "./index.ts";

const OPERATOR = { authorization: "Bearer ops" };
const SHA = "1234567890abcdef1234567890abcdef12345678";

let fakes: FakeGitHub[] = [];
afterEach(async () => {
  await Promise.all(fakes.map((fake) => fake.stop()));
  fakes = [];
});

/**
 * A `settings` in memory, as the contract says (stored keys over the defaults, kept while the schema's
 * `pattern`s accept them, enough here); `unreadable` makes `get` reject, as an unreachable store does.
 */
function memorySettings() {
  const declared = new Map<string, { schema: SettingsSchema; defaults: SettingsValue }>();
  const stored = new Map<string, SettingsValue>();
  const store = {
    unreadable: false,
    declared,
    settings: {
      declare(component, schema, defaults) {
        if (declared.has(component)) throw new Error(`${component} declared already`);
        declared.set(component, { schema, defaults });
      },
      async get<T extends SettingsValue>(component: string, _ctx: AppContext): Promise<T> {
        if (store.unreadable) throw new Error("the settings object could not be reached");
        const found = declared.get(component);
        if (found === undefined) throw new SettingsError("unknown_component", component);
        return { ...found.defaults, ...stored.get(component) } as T;
      },
      async set(component, value) {
        const found = declared.get(component);
        if (found === undefined) throw new SettingsError("unknown_component", component);
        const properties = (found.schema as { properties: Record<string, { pattern?: string }> }).properties;
        for (const [key, each] of Object.entries(value)) {
          const pattern = properties[key]?.pattern;
          if (pattern !== undefined && !new RegExp(pattern).test(String(each))) throw new SettingsError("invalid_value", `/${key}`);
        }
        stored.set(component, value);
        return { ...found.defaults, ...value };
      },
      sections: async () => [],
    } as Settings,
  };
  return store;
}

/** A started App with admin-proposals over a fake GitHub, its secrets, and an operator `ops` (`auth: false`: no admin.auth). */
async function started(options: { github?: FakeGitHub; secrets?: Record<string, string>; config?: Record<string, unknown>; settings?: Settings; auth?: false } = {}) {
  const github = options.github ?? startFakeGitHub();
  fakes.push(github);
  const values: Record<string, string> = options.secrets ?? { GITHUB_TOKEN: github.readToken, PIKIT_MERGE_TOKEN: github.mergeToken };
  const auth: AdminAuth = { verify: async (request) => (request.headers.get("authorization") === "Bearer ops" ? { id: "ops" } : undefined) };
  const logged: { message: string; fields: unknown }[] = [];
  const record = (message: string, fields?: unknown) => void logged.push({ message, fields });
  const logger: Logger = { ...silentLogger, info: record, warn: record } as Logger;
  let routes: KeyedHandle<HttpRoute> | undefined;
  const providers = defineComponent({
    name: "providers-test",
    setup(pikit) {
      if (options.auth !== false) pikit.provide("admin.auth", auth);
      pikit.provide("secrets", { get: async (name) => values[name] });
      if (options.settings !== undefined) pikit.provide("settings", options.settings);
    },
  });
  const server = defineComponent({ name: "server-test", setup: (pikit) => void (routes = pikit.useKeyed("http.route")) });
  const config = { "admin-proposals": { repository: github.repository, apiBase: github.url, ...options.config } };
  const app = await defineApp({ components: [providers, adminProposals, server], config, logger }).create();
  await app.start();
  const call = async (method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = OPERATOR) => {
    const key =
      method === "GET"
        ? path === ""
          ? "GET /admin/api/admin-proposals"
          : path === "/status"
            ? "GET /admin/api/admin-proposals/status"
            : "GET /admin/api/admin-proposals/:number"
        : `POST /admin/api/admin-proposals/:number/${path.split("/")[2]}`;
    const request = new Request(`http://pikit.test/admin/api/admin-proposals${path}`, {
      method,
      headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const response = await (routes?.get(key) as HttpRoute)(request, app.context(BACKGROUND_CONTEXT));
    return { status: response.status, headers: response.headers, body: (await response.json()) as unknown };
  };
  return { github, app, call, logged };
}

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const app = await defineApp({ components: [adminProposals], config: { "admin-proposals": { repository: "ana/bot" } }, logger: silentLogger }).create().catch((error: unknown) => error);
  // It requires secrets: alone it does not compose, and says what is missing.
  expect(String(app)).toContain("secrets");

  const { app: whole } = await started();
  expect(whole.describe().components.find((component) => component.name === "admin-proposals")).toEqual({
    name: "admin-proposals",
    provides: ["http.route"],
    requires: ["secrets"],
    optional: ["admin.auth", "settings"],
  });
  await whole.stop();
  // A repository is owner/name, or nothing.
  await expect(started({ config: { repository: "not a repository" } })).rejects.toThrow("repository");
});

test("dormant until connected: without a repository it starts, and its routes answer 503 not_connected, saying what to set", async () => {
  const { github, call, app } = await started({ config: { repository: "" }, secrets: {} });
  for (const [method, path] of [
    ["GET", ""],
    ["GET", "/1"],
    ["POST", "/1/approve"],
    ["POST", "/1/reject"],
  ] as const) {
    const answer = await call(method, path, method === "POST" ? {} : undefined);
    expect([path, answer.status, (answer.body as ProposalError).error]).toEqual([path, 503, "not_connected"]);
    expect((answer.body as ProposalError).message).toContain("Settings → Self-improvement");
  }
  expect(github.requests).toEqual([]);
  await app.stop();

  // A repository and no token: the token is what is missing.
  const noToken = await started({ secrets: {} });
  const list = await noToken.call("GET", "");
  expect([list.status, (list.body as ProposalError).error]).toEqual([503, "not_connected"]);
  expect((list.body as ProposalError).message).toContain("GITHUB_TOKEN is not set");
  await noToken.app.stop();
});

test("the repository is a setting: its default the config's, changed from the dashboard and used by the next request", async () => {
  const store = memorySettings();
  const { github, call, app } = await started({ settings: store.settings, config: { repository: "" } });
  github.addPull({ number: 1, branch: "pikit/self/a" });
  const declared = store.declared.get("admin-proposals");
  expect(declared?.defaults).toEqual({ repository: "" });
  expect(Object.keys((declared?.schema as { properties: object }).properties)).toEqual(["repository"]);

  expect((await call("GET", "")).status).toBe(503);
  await expect(store.settings.set("admin-proposals", { repository: "no slash" }, { id: "ops" }, app.context())).rejects.toThrow("/repository");
  await store.settings.set("admin-proposals", { repository: github.repository }, { id: "ops" }, app.context());
  const listed = await call("GET", "");
  expect(listed.status).toBe(200);
  expect((listed.body as ProposalList).proposals.map((proposal) => proposal.number)).toEqual([1]);
  // Another repository: GitHub is asked for that one.
  await store.settings.set("admin-proposals", { repository: "ana/other" }, { id: "ops" }, app.context());
  expect(((await call("GET", "")).body as ProposalError).error).toBe("github_not_found");
  await app.stop();

  // A store that cannot be read: the config's repository applies, logged.
  const unreadable = memorySettings();
  unreadable.unreadable = true;
  const fallback = await started({ settings: unreadable.settings });
  expect((await fallback.call("GET", "")).status).toBe(200);
  expect(fallback.logged.map((line) => line.message)).toContain("admin-proposals: its settings could not be read; the config's repository applies");
  await fallback.app.stop();
});

test("status: each part of the connection checked live, the merge token never sent", async () => {
  const { github, call, app } = await started();
  const first = (await call("GET", "/status")).body as ConnectionStatus;
  expect(first).toMatchObject({ connected: true, repository: "ana/bot", branchPrefix: "pikit/self/", tokenSecret: "GITHUB_TOKEN", mergeTokenSecret: "PIKIT_MERGE_TOKEN", defaultBranch: "main" });
  expect([first.checks.repository.state, first.checks.readToken.state, first.checks.mergeToken.state, first.checks.ruleset.state]).toEqual(["ok", "ok", "ok", "missing"]);
  expect(first.checks.ruleset.message).toContain("No ruleset requires a pull request on main");

  github.rules = [{ type: "pull_request" }, { type: "required_status_checks" }, { type: "non_fast_forward" }];
  const ruled = (await call("GET", "/status")).body as ConnectionStatus;
  expect(ruled.checks.ruleset).toEqual({ state: "ok", message: "A ruleset requires a pull request on main, and status checks." });
  expect(github.requests.map((request) => [request.path, request.token])).toEqual([
    ["/repos/ana/bot", github.readToken],
    ["/repos/ana/bot/rules/branches/main?per_page=100", github.readToken],
    ["/repos/ana/bot", github.readToken],
    ["/repos/ana/bot/rules/branches/main?per_page=100", github.readToken],
  ]);
  github.failWith = "down";
  const down = (await call("GET", "/status")).body as ConnectionStatus;
  expect([down.connected, down.checks.repository.state, down.checks.ruleset.state]).toEqual([false, "unknown", "unknown"]);
  github.failWith = undefined;
  await app.stop();

  const nothing = await started({ config: { repository: "" }, secrets: {} });
  const none = (await nothing.call("GET", "/status")).body as ConnectionStatus;
  expect(none.connected).toBe(false);
  expect([none.checks.repository.state, none.checks.readToken.state, none.checks.mergeToken.state, none.checks.ruleset.state]).toEqual(["missing", "missing", "missing", "unknown"]);
  expect(nothing.github.requests).toEqual([]);
  await nothing.app.stop();

  const wrong = await started({ secrets: { GITHUB_TOKEN: "expired-token", PIKIT_MERGE_TOKEN: "expired-token" } });
  const refused = (await wrong.call("GET", "/status")).body as ConnectionStatus;
  expect([refused.checks.readToken.state, refused.checks.mergeToken.state]).toEqual(["failing", "failing"]);
  expect(JSON.stringify(refused)).not.toContain("expired-token");
  await wrong.app.stop();

  const elsewhere = await started({ config: { repository: "ana/other" } });
  const missing = (await elsewhere.call("GET", "/status")).body as ConnectionStatus;
  expect([missing.connected, missing.checks.repository.state]).toEqual([false, "failing"]);
  await elsewhere.app.stop();
});

test("without an admin.auth nobody is an operator: every route answers 401", async () => {
  const { github, call, app } = await started({ auth: false });
  for (const path of ["", "/status", "/1"]) expect((await call("GET", path)).status).toBe(401);
  expect(github.requests).toEqual([]);
  await app.stop();
});

test("every route answers 401 without an operator, and asks GitHub nothing", async () => {
  const { github, call, app } = await started();
  github.addPull({ number: 1, branch: "pikit/self/a" });
  for (const [method, path] of [
    ["GET", ""],
    ["GET", "/status"],
    ["GET", "/1"],
    ["POST", "/1/approve"],
    ["POST", "/1/reject"],
  ] as const) {
    const answer = await call(method, path, method === "POST" ? {} : undefined, { authorization: "Bearer intruder" });
    expect([path, answer.status, answer.body]).toEqual([path, 401, { error: "unauthorized" }]);
  }
  expect(github.requests).toEqual([]);
  expect(github.pull(1)?.state).toBe("open");
  await app.stop();
});

test("the list: open proposals with their checks and preview, then the closed ones; other branches and forks left out", async () => {
  const { github, call, app } = await started();
  github.addPull({ number: 1, branch: "pikit/self/calendar", sha: SHA, title: "A calendar tool" });
  github.addPull({ number: 2, branch: "feature/by-a-person" });
  github.addPull({ number: 3, branch: "pikit/self/from-a-fork", headRepository: "mallory/bot" });
  github.addPull({ number: 4, branch: "pikit/self/merged", state: "closed", merged: true });
  github.addPull({ number: 5, branch: "pikit/self/rejected", state: "closed" });
  github.setChecks(SHA, [
    { name: "checks", status: "completed", conclusion: "success" },
    { name: "Workers Builds: pikit-bot", status: "completed", conclusion: "success", summary: "| Preview URL | https://8a3b2c1d-pikit-bot.ana.workers.dev |" },
  ]);

  const { status, body } = await call("GET", "");
  const list = body as ProposalList;
  expect(status).toBe(200);
  expect(list.repository).toBe("ana/bot");
  expect(list.branchPrefix).toBe("pikit/self/");
  expect(list.proposals.map((proposal) => [proposal.number, proposal.state])).toEqual([
    [1, "open"],
    [5, "closed"],
    [4, "merged"],
  ]);
  expect(list.proposals[0]).toMatchObject({
    title: "A calendar tool",
    author: "pikit-agent",
    branch: "pikit/self/calendar",
    url: "https://github.com/ana/bot/pull/1",
    previewUrl: "https://8a3b2c1d-pikit-bot.ana.workers.dev",
    checks: { state: "passing", passed: 2, failed: 0, pending: 0 },
  });
  expect(list.proposals[1]?.checks).toBeUndefined();
  // Read with the read token only.
  expect(new Set(github.requests.map((request) => request.token))).toEqual(new Set([github.readToken]));
  await app.stop();
});

test("a proposal's page: the description, files with bounded patches, checks, mergeable state; a non-proposal is 404", async () => {
  const { github, call, app } = await started();
  github.setFiles(7, [
    { filename: "src/pikit/tool-calendar/index.ts", status: "added", additions: 40, patch: "@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;" },
    { filename: "big.txt", additions: 9000, patch: `@@ -1 +1 @@\n${"+x\n".repeat(30_000)}` },
    { filename: "logo.png", status: "added" },
  ]);
  github.addPull({ number: 7, branch: "pikit/self/calendar", sha: SHA, body: "Adds **a calendar tool**.\n\nTests: `bun test` passes." });
  github.addPull({ number: 8, branch: "main-fix" });
  github.setChecks(SHA, [{ name: "checks", status: "in_progress" }], [{ context: "ci/other", state: "success" }]);
  github.comments.set(7, ["Deploying with Cloudflare Workers: https://pikit-calendar-pikit-bot.ana.workers.dev"]);

  const { status, body } = await call("GET", "/7");
  const detail = body as ProposalDetail;
  expect(status).toBe(200);
  expect(detail).toMatchObject({
    number: 7,
    body: "Adds **a calendar tool**.\n\nTests: `bun test` passes.",
    base: "main",
    defaultBranch: "main",
    headSha: SHA,
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

  const other = await call("GET", "/8");
  expect(other.status).toBe(404);
  expect((other.body as ProposalError).error).toBe("not_a_proposal");
  const missing = await call("GET", "/99");
  expect([missing.status, (missing.body as ProposalError).error]).toEqual([404, "not_found"]);
  const nonsense = await call("GET", "/abc");
  expect(nonsense.status).toBe(404);
  await app.stop();
});

test("approve merges a proposal whose checks pass (squash, its reviewed head), with the merge token only, and logs who", async () => {
  const { github, call, app, logged } = await started();
  github.addPull({ number: 3, branch: "pikit/self/prompt", sha: SHA, title: "Shorter answers" });
  github.setChecks(SHA, [{ name: "checks", status: "completed", conclusion: "success" }]);

  const { status, body } = await call("POST", "/3/approve", { sha: SHA });
  expect(status).toBe(200);
  expect(body).toMatchObject({ number: 3, merged: true });
  expect(github.pull(3)).toMatchObject({ state: "closed", merged: true });

  const writes = github.requests.filter((request) => request.method !== "GET");
  expect(writes.map((request) => [request.method, request.path, request.token])).toEqual([["PUT", "/repos/ana/bot/pulls/3/merge", github.mergeToken]]);
  expect(writes[0]?.body).toEqual({ merge_method: "squash", sha: SHA, commit_title: "Shorter answers (#3)" });
  // The read token never writes; the merge token never reads.
  expect(github.requests.filter((request) => request.method === "GET").every((request) => request.token === github.readToken)).toBe(true);
  expect(logged).toContainEqual({ message: "admin-proposals: approved and merged", fields: { operator: "ops", number: 3, head: SHA, checks: "passing", override: false } });
  expect(JSON.stringify(logged)).not.toContain(github.mergeToken);
  expect(JSON.stringify(logged)).not.toContain(github.readToken);
  await app.stop();
});

test("approve refuses failing, pending or missing checks unless overridden", async () => {
  const { github, call, app, logged } = await started();
  const failing = "1".repeat(40);
  const pending = "2".repeat(40);
  const none = "3".repeat(40);
  github.addPull({ number: 1, branch: "pikit/self/a", sha: failing });
  github.addPull({ number: 2, branch: "pikit/self/b", sha: pending });
  github.addPull({ number: 3, branch: "pikit/self/c", sha: none });
  github.setChecks(failing, [{ name: "checks", status: "completed", conclusion: "failure" }]);
  github.setChecks(pending, [], [{ context: "ci", state: "pending" }]);

  for (const number of [1, 2, 3]) {
    const refused = await call("POST", `/${number}/approve`, {});
    expect([number, refused.status, (refused.body as ProposalError).error]).toEqual([number, 409, "checks_failing"]);
  }
  expect(github.requests.some((request) => request.method === "PUT")).toBe(false);

  const anyway = await call("POST", "/1/approve", { override: true });
  expect(anyway.status).toBe(200);
  expect(github.pull(1)?.merged).toBe(true);
  expect(logged.at(-1)?.fields).toMatchObject({ number: 1, checks: "failing", override: true });
  await app.stop();
});

test("approve refuses what is not an open proposal into the default branch, or a head that moved", async () => {
  const { github, call, app } = await started();
  github.addPull({ number: 1, branch: "feature/x", sha: SHA });
  github.addPull({ number: 2, branch: "pikit/self/fork", headRepository: "mallory/bot", sha: SHA });
  github.addPull({ number: 3, branch: "pikit/self/elsewhere", base: "release", sha: SHA });
  github.addPull({ number: 4, branch: "pikit/self/done", state: "closed", merged: true, sha: SHA });
  github.addPull({ number: 5, branch: "pikit/self/moved", sha: SHA });
  github.setChecks(SHA, [{ name: "checks", status: "completed", conclusion: "success" }]);

  const refusal = async (path: string, body: unknown = { override: true }) => {
    const answer = await call("POST", path, body);
    return [answer.status, (answer.body as ProposalError).error];
  };
  expect(await refusal("/1/approve")).toEqual([409, "not_a_proposal"]);
  expect(await refusal("/2/approve")).toEqual([409, "not_a_proposal"]);
  expect(await refusal("/3/approve")).toEqual([409, "wrong_base"]);
  expect(await refusal("/4/approve")).toEqual([409, "not_open"]);
  expect(await refusal("/5/approve", { sha: "9".repeat(40) })).toEqual([409, "changed"]);
  expect(await refusal("/99/approve")).toEqual([404, "not_found"]);
  expect(await refusal("/5/approve", { override: "yes" })).toEqual([400, "invalid_request"]);
  expect(await refusal("/5/approve", { sha: "HEAD" })).toEqual([400, "invalid_request"]);
  expect(github.requests.some((request) => request.method !== "GET")).toBe(false);

  github.mergeRefusal = { status: 405, message: "Pull Request is not mergeable" };
  expect(await refusal("/5/approve", {})).toEqual([409, "not_mergeable"]);
  github.mergeRefusal = { status: 409, message: "Head branch was modified." };
  expect(await refusal("/5/approve", {})).toEqual([409, "changed"]);
  await app.stop();
});

test("reject closes the proposal with the operator's comment, with the merge token", async () => {
  const { github, call, app, logged } = await started();
  github.addPull({ number: 6, branch: "pikit/self/risky" });
  github.addPull({ number: 7, branch: "feature/person" });

  const { status, body } = await call("POST", "/6/reject", { comment: "Not now: it reads every file." });
  expect(status).toBe(200);
  expect(body).toEqual({ number: 6, closed: true });
  expect(github.pull(6)).toMatchObject({ state: "closed", merged: false });
  expect(github.comments.get(6)).toEqual(["Not now: it reads every file."]);
  const writes = github.requests.filter((request) => request.method !== "GET");
  expect(writes.map((request) => [request.method, request.path, request.token])).toEqual([
    ["POST", "/repos/ana/bot/issues/6/comments", github.mergeToken],
    ["PATCH", "/repos/ana/bot/pulls/6", github.mergeToken],
  ]);
  expect(logged.at(-1)).toEqual({ message: "admin-proposals: rejected and closed", fields: { operator: "ops", number: 6, commented: true } });

  // Without a comment, closed only; a person's pull request is not the dashboard's to close.
  github.addPull({ number: 8, branch: "pikit/self/other" });
  expect((await call("POST", "/8/reject")).status).toBe(200);
  expect(github.comments.get(8)).toBeUndefined();
  const refused = await call("POST", "/7/reject", {});
  expect([refused.status, (refused.body as ProposalError).error]).toEqual([409, "not_a_proposal"]);
  expect(github.pull(7)?.state).toBe("open");
  await app.stop();
});

test("tokens: a missing one is 503 not_connected, the same in both secrets 503 not_configured, naming the secret and never the token", async () => {
  const shared = await started({ secrets: { GITHUB_TOKEN: "same-token", PIKIT_MERGE_TOKEN: "same-token" } });
  shared.github.addPull({ number: 1, branch: "pikit/self/a" });
  const same = await shared.call("POST", "/1/approve", { override: true });
  expect(same.status).toBe(503);
  expect(same.body).toMatchObject({ error: "not_configured" });
  expect(JSON.stringify(same.body)).toContain("PIKIT_MERGE_TOKEN");
  expect(JSON.stringify(same.body)).not.toContain("same-token");
  await shared.app.stop();

  const readOnly = await started({ secrets: { GITHUB_TOKEN: "read-token-for-tests" } });
  readOnly.github.addPull({ number: 1, branch: "pikit/self/a" });
  expect((await readOnly.call("GET", "")).status).toBe(200);
  const noMerge = await readOnly.call("POST", "/1/reject", {});
  expect([noMerge.status, (noMerge.body as ProposalError).error]).toEqual([503, "not_connected"]);
  expect((noMerge.body as ProposalError).message).toContain("PIKIT_MERGE_TOKEN is not set");
  expect(readOnly.github.pull(1)?.state).toBe("open");
  await readOnly.app.stop();

  const none = await started({ secrets: {} });
  const list = await none.call("GET", "");
  expect(list.status).toBe(503);
  expect((list.body as ProposalError).message).toContain("GITHUB_TOKEN");

  await none.app.stop();
  await expect(started({ config: { mergeTokenSecret: "GITHUB_TOKEN" } })).rejects.toThrow("mergeTokenSecret must name another secret");
});

test("GitHub's errors: a rate limit is 429 with retry-after, a refused token or GitHub down 502, never a token", async () => {
  const { github, call, app } = await started();
  github.failWith = "rate_limit";
  const limited = await call("GET", "");
  expect(limited.status).toBe(429);
  expect((limited.body as ProposalError).error).toBe("rate_limited");
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(60);

  github.failWith = "secondary_rate_limit";
  const secondary = await call("GET", "/1");
  expect([secondary.status, secondary.headers.get("retry-after")]).toEqual([429, "30"]);

  github.failWith = "down";
  const down = await call("GET", "");
  expect([down.status, (down.body as ProposalError).error]).toEqual([502, "github_unavailable"]);
  github.failWith = undefined;
  await app.stop();

  const wrong = await started({ secrets: { GITHUB_TOKEN: "expired-token", PIKIT_MERGE_TOKEN: "other-token" } });
  const refused = await wrong.call("GET", "");
  expect([refused.status, (refused.body as ProposalError).error]).toEqual([502, "github_unauthorized"]);
  expect(JSON.stringify(refused.body)).not.toContain("expired-token");
  await wrong.app.stop();

  const elsewhere = await started({ config: { repository: "ana/other" } });
  const missing = await elsewhere.call("GET", "");
  expect([missing.status, (missing.body as ProposalError).error]).toEqual([502, "github_not_found"]);
  await elsewhere.app.stop();
});

test("a read-only token in the merge secret: GitHub's 403 is 502 github_forbidden, and nothing is merged", async () => {
  const github = startFakeGitHub();
  const { call, app } = await started({ github, secrets: { GITHUB_TOKEN: github.mergeToken, PIKIT_MERGE_TOKEN: github.readToken } });
  github.addPull({ number: 2, branch: "pikit/self/b", sha: SHA });
  github.setChecks(SHA, [{ name: "checks", status: "completed", conclusion: "success" }]);
  const answer = await call("POST", "/2/approve", {});
  expect([answer.status, (answer.body as ProposalError).error]).toEqual([502, "github_forbidden"]);
  expect((answer.body as ProposalError).message).toContain("PIKIT_MERGE_TOKEN");
  expect(github.pull(2)?.state).toBe("open");
  await app.stop();
});
