/**
 * admin-proposals' tests: its routes over a `proposals` in memory, which records what it was asked.
 * What a provider does with GitHub or a repository is its own tests' (proposals-github,
 * proposals-local). They are copied with the component and keep running in your project.
 */

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, defineApp, defineComponent, type KeyedHandle, type Logger, silentLogger } from "@pikit/core";
import { type AdminAuth, type HttpRoute, type ProposalDetail, type ProposalList, type Proposals, ProposalsError } from "@pikit/contracts";
import adminProposals, { type ProposalError } from "./index.ts";

const OPERATOR = { authorization: "Bearer ops" };
const HEAD = "1234567890abcdef1234567890abcdef12345678";

const LIST: ProposalList = { where: "this server's proposals repository", branchPrefix: "pikit/self/", checksRun: "after-approval", proposals: [] };

/** A `proposals` in memory: `calls` records what it was asked; `failWith` makes every call throw. */
function memoryProposals() {
  const calls: unknown[][] = [];
  const state = { failWith: undefined as ProposalsError | undefined, calls };
  const fail = () => {
    if (state.failWith !== undefined) throw state.failWith;
  };
  const proposals: Proposals = {
    async status() {
      calls.push(["status"]);
      fail();
      return { connected: true, where: LIST.where, branchPrefix: "pikit/self/", checks: [{ id: "deployer", label: "Deployer", state: "ok", message: "Running." }] };
    },
    async list() {
      calls.push(["list"]);
      fail();
      return LIST;
    },
    async get(id) {
      calls.push(["get", id]);
      fail();
      if (id !== "tools/calendar") throw new ProposalsError("not_found", 404, `no proposal ${id}`);
      return { id } as ProposalDetail;
    },
    async approve(id, request) {
      calls.push(["approve", id, request]);
      fail();
      if (id !== "tools/calendar") return { ok: false, code: "not_found", message: `no proposal ${id}` };
      if (request.head !== undefined && request.head !== HEAD) return { ok: false, code: "moved", message: "it moved" };
      return { ok: true, id, head: HEAD, merged: false, message: "Approved: the deployer merges it." };
    },
    async reject(id, request) {
      calls.push(["reject", id, request]);
      fail();
      return id === "tools/calendar" ? { ok: true, id, message: "Rejected." } : { ok: false, code: "not_open", message: "already rejected" };
    },
    async remote() {
      return undefined;
    },
  };
  return { proposals, state };
}

async function started(options: { auth?: false } = {}) {
  const memory = memoryProposals();
  const auth: AdminAuth = { verify: async (request) => (request.headers.get("authorization") === "Bearer ops" ? { id: "ops" } : undefined) };
  const logged: { message: string; fields: unknown }[] = [];
  const logger: Logger = { ...silentLogger, info: (message: string, fields?: unknown) => void logged.push({ message, fields }) } as Logger;
  let routes: KeyedHandle<HttpRoute> | undefined;
  const providers = defineComponent({
    name: "providers-test",
    setup(pikit) {
      if (options.auth !== false) pikit.provide("admin.auth", auth);
      pikit.provide("proposals", memory.proposals);
    },
  });
  const server = defineComponent({ name: "server-test", setup: (pikit) => void (routes = pikit.useKeyed("http.route")) });
  const app = await defineApp({ components: [providers, adminProposals, server], logger }).create();
  await app.start();
  const call = async (method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = OPERATOR) => {
    const key =
      method === "GET"
        ? path === ""
          ? "GET /admin/api/admin-proposals"
          : path === "/status"
            ? "GET /admin/api/admin-proposals/status"
            : "GET /admin/api/admin-proposals/:id"
        : `POST /admin/api/admin-proposals/:id/${path.split("/").at(-1)}`;
    const request = new Request(`http://pikit.test/admin/api/admin-proposals${path}`, {
      method,
      headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const response = await (routes?.get(key) as HttpRoute)(request, app.context(BACKGROUND_CONTEXT));
    return { status: response.status, headers: response.headers, body: (await response.json()) as unknown };
  };
  return { app, call, logged, state: memory.state };
}

const ID = encodeURIComponent("tools/calendar");

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const alone = await defineApp({ components: [adminProposals], logger: silentLogger }).create().catch((error: unknown) => error);
  expect(String(alone)).toContain("proposals");
  const { app } = await started();
  expect(app.describe().components.find((component) => component.name === "admin-proposals")).toEqual({
    name: "admin-proposals",
    provides: ["http.route"],
    requires: ["proposals"],
    optional: ["admin.auth"],
  });
  await app.stop();
});

test("every route answers 401 without an operator, and proposals is never asked; without an admin.auth nobody is one", async () => {
  for (const options of [{}, { auth: false as const }]) {
    const { call, app, state } = await started(options);
    for (const [method, path] of [
      ["GET", ""],
      ["GET", "/status"],
      ["GET", `/${ID}`],
      ["POST", `/${ID}/approve`],
      ["POST", `/${ID}/reject`],
    ] as const) {
      const answer = await call(method, path, method === "POST" ? {} : undefined, { authorization: "Bearer intruder" });
      expect([path, answer.status, answer.body]).toEqual([path, 401, { error: "unauthorized" }]);
    }
    expect(state.calls).toEqual([]);
    await app.stop();
  }
});

test("status, the list and a proposal are the provider's answers; an id is decoded, a topic's slash included", async () => {
  const { call, app, state } = await started();
  expect((await call("GET", "/status")).body).toMatchObject({ connected: true, checks: [{ id: "deployer", state: "ok" }] });
  expect((await call("GET", "")).body).toEqual(LIST);
  expect(await call("GET", `/${ID}`)).toMatchObject({ status: 200, body: { id: "tools/calendar" } });
  const missing = await call("GET", "/nothing");
  expect([missing.status, (missing.body as ProposalError).error]).toEqual([404, "not_found"]);
  expect(state.calls).toEqual([["status"], ["list"], ["get", "tools/calendar"], ["get", "nothing"]]);
  await app.stop();
});

test("approve passes the head the operator read and the operator, answers the outcome, and logs who", async () => {
  const { call, app, state, logged } = await started();
  const approved = await call("POST", `/${ID}/approve`, { head: HEAD });
  expect(approved).toMatchObject({ status: 200, body: { id: "tools/calendar", head: HEAD, merged: false, message: "Approved: the deployer merges it." } });
  expect(state.calls.at(-1)).toEqual(["approve", "tools/calendar", { operator: { id: "ops" }, head: HEAD }]);
  expect(logged).toContainEqual({ message: "admin-proposals: approved", fields: { operator: "ops", id: "tools/calendar", head: HEAD, merged: false } });

  const moved = await call("POST", `/${ID}/approve`, { head: "9".repeat(40), override: true });
  expect([moved.status, moved.body]).toEqual([409, { error: "moved", message: "it moved" }]);
  expect(state.calls.at(-1)).toEqual(["approve", "tools/calendar", { operator: { id: "ops" }, head: "9".repeat(40), override: true }]);
  expect((await call("POST", "/other/approve", {})).status).toBe(404);

  const before = state.calls.length;
  for (const body of [{ override: "yes" }, { head: "HEAD" }, [1]]) {
    const answer = await call("POST", `/${ID}/approve`, body);
    expect([answer.status, (answer.body as ProposalError).error]).toEqual([400, "invalid_request"]);
  }
  expect(state.calls.length).toBe(before);
  await app.stop();
});

test("reject passes the comment, trimmed and bounded; a refusal is 409", async () => {
  const { call, app, state, logged } = await started();
  expect(await call("POST", `/${ID}/reject`, { comment: "  Not now.  " })).toMatchObject({ status: 200, body: { id: "tools/calendar", closed: true } });
  expect(state.calls.at(-1)).toEqual(["reject", "tools/calendar", { operator: { id: "ops" }, comment: "Not now." }]);
  expect(logged.at(-1)).toEqual({ message: "admin-proposals: rejected", fields: { operator: "ops", id: "tools/calendar", commented: true } });
  const refused = await call("POST", "/other/reject");
  expect([refused.status, (refused.body as ProposalError).error]).toEqual([409, "not_open"]);
  const long = await call("POST", `/${ID}/reject`, { comment: "x".repeat(10_001) });
  expect(long.status).toBe(400);
  await app.stop();
});

test("a provider's failure is its status and code, a rate limit with retry-after", async () => {
  const { call, app, state } = await started();
  state.failWith = new ProposalsError("not_connected", 503, "Self-improvement is not connected: no repository is set.");
  expect(await call("GET", "")).toMatchObject({ status: 503, body: { error: "not_connected", message: "Self-improvement is not connected: no repository is set." } });
  state.failWith = new ProposalsError("rate_limited", 429, "try again in 30 s", 30);
  const limited = await call("POST", `/${ID}/approve`, {});
  expect([limited.status, limited.headers.get("retry-after"), (limited.body as ProposalError).error]).toEqual([429, "30", "rate_limited"]);
  await app.stop();
});
