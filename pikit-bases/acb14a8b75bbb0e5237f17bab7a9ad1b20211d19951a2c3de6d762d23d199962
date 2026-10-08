/**
 * admin-api's tests. They are copied with the component and keep running in your project.
 *
 * Every contract it uses is a double here; the routes are picked the way a server picks them
 * (`compareHttpRoutes`), so the most specific key serves each request.
 */

import { afterEach, expect, test } from "bun:test";
import { type App, type ComponentDefinition, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { ADMIN_CLIENT_HEADER, type AgentCommand, type CompletionRequest, type ConversationRef, type DeliveryReceipt, type OutboundQueue, type PendingPiece, type SqlDatabase } from "@pikit/contracts";
import { createAgentCommandConformance } from "@pikit/contracts/testing";
import { sqliteStorage } from "@pikit/pi-adapter/testing";
import Type from "typebox";
import { MAX_IMAGE_BYTES, OPERATOR_NOTE } from "./api.ts";
import { TITLE_SYSTEM, TITLE_TOKENS } from "./titles.ts";
import { CSP } from "./assets.ts";
import adminApi from "./index.ts";
import { agents, AUTH, auth, imageOf, PIXEL, Runtime, type Served, SESSION, serve, sse, ZERO } from "./runtime.test-support.ts";

type Subject = Served & { runtime: Runtime };

const running: App[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.stop().catch(() => {});
});

/**
 * admin-api on a server over `runtime` (made empty when not given: what it holds before the start is
 * what the index is filled from), once the index is filled.
 */
async function started(config: Record<string, unknown> = {}, extra: ComponentDefinition[] = [], runtime = new Runtime(), appConfig: Record<string, unknown> = {}): Promise<Subject> {
  const served = await serve([auth, agents, sqliteStorage(), runtime.component(), adminApi, ...extra], { "admin-api": config, ...appConfig });
  running.push(served.app);
  const deadline = Date.now() + 5_000;
  while (!served.logged.some((each) => each.message.includes("the conversation index has every conversation")) && Date.now() < deadline) await Bun.sleep(5);
  runtime.pages.length = 0;
  return { ...served, runtime };
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { ...AUTH, "content-type": "application/json" },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

/** The ids of the list's first page. */
const listed = async (s: Subject, query = ""): Promise<string[]> =>
  ((await (await s.fetch(`/admin/api/conversations${query}`, { headers: AUTH })).json()) as { items: { conversationId: string }[] }).items.map((each) => each.conversationId);

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const runtime = new Runtime();
  const app = await defineApp({ components: [auth, sqliteStorage(), runtime.component(), adminApi], logger: silentLogger }).create();

  expect(app.describe().components.find((c) => c.name === "admin-api")).toEqual({
    name: "admin-api",
    provides: ["http.route", "agent.command"],
    requires: ["admin.auth", "agent.observe", "agent.runtime", "conversations.registry", "storage.sql"],
    optional: ["outbound.queue", "actor.inbox", "actor.mailbox", "agent.definition", "agent.command", "model.complete"],
  });
});

test("every API route answers 401 without an operator, and reads nothing", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  // The session's routes take the credential itself (below).
  const api = s.keys().filter((key) => key.includes("/admin/api") && !key.endsWith("/admin/api/session"));
  expect(api.length).toBeGreaterThan(9);

  for (const key of api) {
    const [method = "GET", pattern = "/"] = key.split(" ");
    const path = pattern.replace(":id", "c1").replace("*", "anything");
    for (const headers of [{}, { authorization: "Bearer wrong" }]) {
      const response = await s.fetch(path, { method, headers, ...(method === "POST" && { body: JSON.stringify({ text: "hi" }) }) });
      expect({ key, status: response.status }).toEqual({ key, status: 401 });
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    }
  }
  expect(s.runtime.dispatched).toEqual([]);
  expect(s.runtime.aborted).toEqual([]);
  expect(s.runtime.pages).toEqual([]);
});

test("GET /admin/api/app: the composition the App describes, admin-api in it", async () => {
  const s = await started();

  const response = await s.fetch("/admin/api/app", { headers: AUTH });
  const body = (await response.json()) as { version: number; components: { name: string }[]; config: Record<string, unknown> };

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body.version).toBe(1);
  expect(body.components.map((c) => c.name)).toContain("admin-api");
  expect(body.config["admin-api"]).toMatchObject({ heartbeatMs: 15_000 });
});

test("GET /admin/api/app never sends a config value that looks like a secret", async () => {
  const leaky = defineComponent({
    name: "leaky-test",
    config: Type.Object({ botToken: Type.String(), tokenSecret: Type.String(), url: Type.String(), retries: Type.Integer() }),
    setup() {},
  });
  const config = { botToken: "123456789:AAEabcdefghijklmnopqrstuvwxyz012345", tokenSecret: "TELEGRAM_BOT_TOKEN", url: "https://user:hunter2@example.com/", retries: 3 };
  const s = await started({}, [leaky], undefined, { "leaky-test": config });

  const text = await (await s.fetch("/admin/api/app", { headers: AUTH })).text();

  expect((JSON.parse(text) as { config: Record<string, unknown> }).config["leaky-test"]).toEqual({ botToken: "[redacted]", tokenSecret: "TELEGRAM_BOT_TOKEN", url: "[redacted]", retries: 3 });
  expect(text).not.toContain("AAEabcdef");
  expect(text).not.toContain("hunter2");
});

test("GET /admin/api/conversations: what the runtime held at start, newest activity first, each saying whether its key points to it now", async () => {
  const runtime = new Runtime();
  runtime.add({ conversationId: "c0", key: "telegram:1", agent: "assistant", lastActivity: 1 }, false);
  runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant", busy: true, lastActivity: 5 });
  runtime.add({ conversationId: "c2", key: "http:a", agent: "assistant", lastActivity: 3 });
  // No message reached it: no key, nothing to index (it can be read by its id).
  runtime.add({ conversationId: "c3" });
  const s = await started({}, [], runtime);

  const response = await s.fetch("/admin/api/conversations?limit=2", { headers: AUTH });
  const body = (await response.json()) as { items: Record<string, unknown>[]; next?: string };

  expect(response.status).toBe(200);
  expect(body.items).toEqual([
    { conversationId: "c1", key: "telegram:1", agent: "assistant", busy: true, lastActivity: 5, usage: ZERO, current: true },
    { conversationId: "c2", key: "http:a", agent: "assistant", busy: false, lastActivity: 3, usage: ZERO, current: true },
  ]);
  const last = (await (await s.fetch(`/admin/api/conversations?limit=2&cursor=${encodeURIComponent(body.next as string)}`, { headers: AUTH })).json()) as { items: Record<string, unknown>[]; next?: string };
  expect(last).toEqual({ items: [{ conversationId: "c0", key: "telegram:1", agent: "assistant", busy: false, lastActivity: 1, usage: ZERO, current: false }] });
  expect((await s.fetch("/admin/api/conversations/c3", { headers: AUTH })).status).toBe(200);
});

test("the list follows activity: a message dispatched, a run settled or failed, a reset move a conversation to the front; a duplicate does not", async () => {
  const runtime = new Runtime();
  for (const [id, at] of [["c1", 10], ["c2", 20], ["c3", 30]] as const) runtime.add({ conversationId: id, key: `telegram:${id}`, agent: "assistant", lastActivity: at });
  const s = await started({}, [], runtime);
  expect(await listed(s)).toEqual(["c3", "c2", "c1"]);
  const ctx = s.app.context();
  const ref = (id: string) => ({ key: `telegram:${id}`, agent: "assistant", conversationId: id });

  await ctx.emit("agent.dispatched", { conversation: ref("c1"), admission: { kind: "queued", requestId: "m1" } });
  expect(await listed(s)).toEqual(["c1", "c3", "c2"]);
  await Bun.sleep(2);
  await ctx.emit("agent.failed", { conversation: ref("c2"), requestId: "m2", requestIds: ["m2"], kind: "failed", messages: [], error: { code: "x", message: "x" } });
  expect((await listed(s))[0]).toBe("c2");
  await Bun.sleep(2);
  await ctx.emit("agent.settled", { conversation: ref("c3"), requestId: "m3", requestIds: ["m3"], kind: "completed", messages: [] });
  expect((await listed(s))[0]).toBe("c3");
  await Bun.sleep(2);
  // A reset's new conversation is listed at once, before any message reaches it.
  await s.fetch("/admin/api/conversations/c1/reset", post());
  expect((await listed(s)).slice(0, 2)).toEqual(["c100", "c3"]);
  // A duplicate admission is no activity.
  await Bun.sleep(2);
  await ctx.emit("agent.dispatched", { conversation: ref("c2"), admission: { kind: "duplicate", requestId: "m2" } });
  expect((await listed(s))[0]).toBe("c100");
});

test("the list pages through thousands, newest first, a page at a time: nothing is read all at once", async () => {
  const runtime = new Runtime();
  for (let i = 0; i < 1_200; i++) runtime.add({ conversationId: `c${i}`, key: `http:${i}`, agent: "assistant", lastActivity: 1_000 + i });
  const s = await started({}, [], runtime);

  const first = (await (await s.fetch("/admin/api/conversations?limit=50", { headers: AUTH })).json()) as { items: { conversationId: string }[]; next: string };
  expect(first.items.length).toBe(50);
  expect(first.items[0]?.conversationId).toBe("c1199");
  const seen = new Set(first.items.map((each) => each.conversationId));
  let cursor: string | undefined = first.next;
  while (cursor !== undefined) {
    const page = (await (await s.fetch(`/admin/api/conversations?limit=500&cursor=${encodeURIComponent(cursor)}`, { headers: AUTH })).json()) as { items: { conversationId: string }[]; next?: string };
    for (const each of page.items) seen.add(each.conversationId);
    cursor = page.next;
  }
  expect(seen.size).toBe(1_200);
});

test("a page's limit and cursor are checked: 400, never a 500", async () => {
  const s = await started();

  for (const limit of ["0", "501", "-1", "1.5", "ten"]) {
    const response = await s.fetch(`/admin/api/conversations?limit=${limit}`, { headers: AUTH });
    expect({ limit, status: response.status }).toEqual({ limit, status: 400 });
    expect(((await response.json()) as { error: string }).error).toBe("invalid_request");
  }
  const forged = await s.fetch("/admin/api/conversations?cursor=forged", { headers: AUTH });
  expect(forged.status).toBe(400);
  expect(await forged.json()).toMatchObject({ error: "invalid_cursor" });
});

test("GET one conversation and its transcript; an unknown one is 404", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  s.runtime.transcripts.set("c1", [
    { id: "e2", kind: "message", messages: [{ role: "assistant", content: "hello" }] },
    { id: "e1", kind: "message", messages: [{ role: "user", content: "hi" }] },
  ]);

  const one = await s.fetch("/admin/api/conversations/c1", { headers: AUTH });
  expect(await one.json()).toMatchObject({ conversationId: "c1", current: true });

  const transcript = await s.fetch("/admin/api/conversations/c1/transcript?limit=1", { headers: AUTH });
  expect(await transcript.json()).toEqual({ items: [{ id: "e2", kind: "message", messages: [{ role: "assistant", content: "hello" }] }] });

  for (const path of ["/admin/api/conversations/nope", "/admin/api/conversations/nope/transcript", "/admin/api/conversations/%E0/transcript", "/admin/api/conversations/nope/events"]) {
    const response = await s.fetch(path, { headers: AUTH });
    expect({ path, status: response.status }).toEqual({ path, status: 404 });
  }
});

test("GET …/events: a snapshot, then each change, as server-sent events; the client leaving releases the watch", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  const client = new AbortController();

  const response = await s.fetch("/admin/api/conversations/c1/events", { headers: AUTH, signal: client.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");

  const stream = sse(response);
  expect(await stream.take(1)).toEqual([{ type: "snapshot", conversationId: "c1" }]);
  s.runtime.push({ type: "message_update", text: "hel" });
  s.runtime.push({ type: "agent_end" });
  expect(await stream.take(2)).toEqual([{ type: "message_update", text: "hel" }, { type: "agent_end" }]);

  client.abort();
  await stream.reader.cancel();
  await Bun.sleep(10);
  expect(s.runtime.released).toBe(1);
});

test("GET …/events: a quiet stream gets a heartbeat comment", async () => {
  const s = await started({ heartbeatMs: 1000 });
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  const client = new AbortController();
  const response = await s.fetch("/admin/api/conversations/c1/events", { headers: AUTH, signal: client.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  let text = "";
  const deadline = Date.now() + 3000;
  while (!text.includes(": heartbeat") && Date.now() < deadline) text += decoder.decode((await reader.read()).value);

  expect(text).toContain(": heartbeat\n\n");
  client.abort();
  await reader.cancel();
});

test("POST …/messages to another channel's conversation: a follow-up, the dashboard's request id, marked for the agent, logged without its text", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant", busy: true });

  const response = await s.fetch("/admin/api/conversations/c1/messages", post({ text: "stop and summarise" }));
  const body = (await response.json()) as { requestId: string; admission: string };

  expect(response.status).toBe(202);
  expect(body.admission).toBe("queued");
  expect(body.requestId).toMatch(/^dashboard:[0-9a-f-]{36}$/);
  expect(s.runtime.dispatched).toEqual([
    {
      requestId: body.requestId,
      conversation: { key: "telegram:1", agent: "assistant", conversationId: "c1" },
      prompt: `${OPERATOR_NOTE}: the user of this conversation does not see this message or your answer to it.]\nstop and summarise`,
      whenBusy: "followUp",
    },
  ]);
  const log = s.logged.find((each) => each.message.includes("sent a message"));
  expect(log?.fields).toMatchObject({ operator: "ops", conversation: "telegram:1" });
  expect(JSON.stringify(s.logged)).not.toContain("summarise");
});

test("POST …/messages: the client's request id is kept, and must be the dashboard's", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });

  const response = await s.fetch("/admin/api/conversations/c1/messages", post({ text: "hi", requestId: "dashboard:ui-42" }));
  expect(await response.json()).toEqual({ requestId: "dashboard:ui-42", admission: "started" });
  expect(s.runtime.dispatched[0]).toMatchObject({ requestId: "dashboard:ui-42", whenBusy: "followUp" });

  // Another channel's request id, or a steer, are refused: what the dashboard says stays out of the chat.
  for (const body of [{ text: "hi", requestId: "ui:42" }, { text: "hi", requestId: "telegram:7" }, { text: "hi", whenBusy: "steer" }]) {
    expect({ body, status: (await s.fetch("/admin/api/conversations/c1/messages", post(body))).status }).toEqual({ body, status: 400 });
  }
  expect(s.runtime.dispatched.length).toBe(1);
});

test("POST /admin/api/conversations: a conversation of the dashboard's own (dashboard:<uuid>), with an agent of the App and its first message", async () => {
  const s = await started();

  const response = await s.fetch("/admin/api/conversations", post({ agent: "assistant", text: "what changed today?" }));
  const body = (await response.json()) as { conversationId: string; key: string; requestId: string; admission: string };

  expect(response.status).toBe(201);
  expect(body.key).toMatch(/^dashboard:[0-9a-f-]{36}$/);
  expect(body).toMatchObject({ conversationId: "c100", admission: "started", requestId: expect.stringMatching(/^dashboard:/) });
  expect(s.runtime.pointers.get(body.key)).toEqual({ key: body.key, agent: "assistant", conversationId: "c100" });
  expect(s.runtime.dispatched).toEqual([
    { requestId: body.requestId, conversation: { key: body.key, agent: "assistant", conversationId: "c100" }, prompt: `${OPERATOR_NOTE}.]\nwhat changed today?`, whenBusy: "followUp" },
  ]);
  expect(s.logged.find((each) => each.message.includes("started a conversation"))?.fields).toMatchObject({ operator: "ops", conversation: body.key, agent: "assistant" });
  expect(JSON.stringify(s.logged)).not.toContain("what changed");
  // It is the dashboard's: listed, and continued from here.
  await Bun.sleep(2);
  expect((await listed(s))[0]).toBe("c100");
  expect((await s.fetch("/admin/api/conversations/c100/messages", post({ text: "and yesterday?" }))).status).toBe(202);
  expect(s.runtime.dispatched[1]?.prompt).toBe(`${OPERATOR_NOTE}.]\nand yesterday?`);
});

test("POST /admin/api/conversations: an agent the App does not have, or a bad body, is 400 and makes nothing", async () => {
  const s = await started();

  const unknown = await s.fetch("/admin/api/conversations", post({ agent: "nobody", text: "hi" }));
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({ error: "unknown_agent", message: expect.stringContaining("assistant") });
  for (const body of [{}, { agent: "assistant" }, { agent: "assistant", text: "" }, { agent: "assistant", text: "hi", key: "telegram:1" }, { agent: "assistant", text: "hi", requestId: "x" }]) {
    expect({ body, status: (await s.fetch("/admin/api/conversations", post(body))).status }).toEqual({ body, status: 400 });
  }
  expect(s.runtime.pointers.size).toBe(0);
  expect(s.runtime.dispatched).toEqual([]);
});

test("an id with '.', '/', '@' and ':' is one path segment, encoded: read and acted on like any other", async () => {
  const s = await started();
  const id = "email:ana@empresa.com/inbox.1";
  s.runtime.add({ conversationId: id, key: "email:ana@empresa.com", agent: "assistant" });
  const path = `/admin/api/conversations/${encodeURIComponent(id)}`;

  expect(await (await s.fetch(path, { headers: AUTH })).json()).toMatchObject({ conversationId: id, current: true });
  expect((await s.fetch(`${path}/abort`, post())).status).toBe(200);
  expect(s.runtime.aborted[0]?.conversationId).toBe(id);
});

test("sessions: the credential once opens a cookie (POST /admin/api/session), which the API then takes; DELETE clears it", async () => {
  const s = await started();
  const client = { [ADMIN_CLIENT_HEADER]: "1" };

  const opened = await s.fetch("/admin/api/session", { method: "POST", headers: { ...AUTH, ...client } });
  expect(opened.status).toBe(200);
  expect(await opened.json()).toEqual({ operator: "ops" });
  expect(opened.headers.get("set-cookie")).toStartWith(SESSION);
  expect(opened.headers.get("cache-control")).toBe("no-store");
  expect(s.logged.some((each) => each.message.includes("signed in") && each.fields?.operator === "ops")).toBe(true);

  expect((await s.fetch("/admin/api/app", { headers: { cookie: SESSION } })).status).toBe(200);
  // Without the client's header the cookie changes nothing; with it, it does.
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  expect((await s.fetch("/admin/api/conversations/c1/abort", { method: "POST", headers: { cookie: SESSION } })).status).toBe(401);
  expect((await s.fetch("/admin/api/conversations/c1/abort", { method: "POST", headers: { cookie: SESSION, ...client } })).status).toBe(200);

  const closed = await s.fetch("/admin/api/session", { method: "DELETE", headers: client });
  expect(closed.status).toBe(204);
  expect(closed.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("sessions: a wrong credential is 401; without the client's header the session's routes refuse (a page of another site cannot sign in or out)", async () => {
  const s = await started();

  expect((await s.fetch("/admin/api/session", { method: "POST", headers: { authorization: "Bearer wrong", [ADMIN_CLIENT_HEADER]: "1" } })).status).toBe(401);
  expect((await s.fetch("/admin/api/session", { method: "POST", headers: { [ADMIN_CLIENT_HEADER]: "1" } })).status).toBe(401);
  for (const method of ["POST", "DELETE"]) {
    const response = await s.fetch("/admin/api/session", { method, headers: AUTH });
    expect({ method, status: response.status, cookie: response.headers.get("set-cookie") }).toEqual({ method, status: 400, cookie: null });
  }
});

test("GET /admin/api/agents: the App's agents by name, their model and the names of the tools they are defined with", async () => {
  const s = await started();

  const response = await s.fetch("/admin/api/agents", { headers: AUTH });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    items: [
      { name: "assistant", model: "test/model", tools: [] },
      { name: "searcher", model: "test/search", tools: ["websearch", "lookup"] },
    ],
  });
});

test("POST …/messages with images: they reach the agent's request after the marked text; the text may be empty; the log counts them", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "dashboard:1", agent: "assistant" });

  const response = await s.fetch("/admin/api/conversations/c1/messages", post({ text: "what is this?", attachments: [{ kind: "image", mimeType: "image/png", data: PIXEL }, imageOf(10, "image/webp")] }));
  expect(response.status).toBe(202);
  expect(s.runtime.dispatched[0]).toMatchObject({
    prompt: `${OPERATOR_NOTE}.]\nwhat is this?`,
    images: [{ mimeType: "image/png", data: PIXEL }, { mimeType: "image/webp", data: imageOf(10).data }],
  });
  expect(s.logged.find((each) => each.message.includes("sent a message"))?.fields).toMatchObject({ images: 2 });
  expect(JSON.stringify(s.logged)).not.toContain(PIXEL);

  expect((await s.fetch("/admin/api/conversations/c1/messages", post({ text: "", attachments: [imageOf(3)] }))).status).toBe(202);
  expect(s.runtime.dispatched[1]).toMatchObject({ prompt: `${OPERATOR_NOTE}.]\n`, images: [{ mimeType: "image/png" }] });
  // Without images the request has none.
  await s.fetch("/admin/api/conversations/c1/messages", post({ text: "plain" }));
  expect(s.runtime.dispatched[2]?.images).toBeUndefined();

  // A new conversation takes them too.
  const started2 = await s.fetch("/admin/api/conversations", post({ agent: "assistant", text: "", attachments: [imageOf(3, "image/gif")] }));
  expect(started2.status).toBe(201);
  expect(s.runtime.dispatched[3]?.images).toEqual([{ mimeType: "image/gif", data: imageOf(3).data }]);
});

test("images are checked: more than 4, a type that is not an image the API takes, or not base64 is 400; one over 5 MB, or a larger body, 413; nothing is dispatched", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "dashboard:1", agent: "assistant" });
  const send = (body: unknown) => s.fetch("/admin/api/conversations/c1/messages", post(body));

  const cases: [unknown, number, string][] = [
    [{ text: "" }, 400, "invalid_request"],
    [{ text: "", attachments: [] }, 400, "invalid_request"],
    [{ text: "hi", attachments: Array.from({ length: 5 }, () => imageOf(3)) }, 400, "invalid_request"],
    [{ text: "hi", attachments: [imageOf(3, "image/svg+xml")] }, 400, "invalid_request"],
    [{ text: "hi", attachments: [imageOf(3, "application/pdf")] }, 400, "invalid_request"],
    [{ text: "hi", attachments: [{ kind: "image", mimeType: "image/png", data: "not base64!" }] }, 400, "invalid_request"],
    [{ text: "hi", attachments: [{ kind: "file", mimeType: "image/png", data: PIXEL }] }, 400, "invalid_request"],
    [{ text: "hi", attachments: [imageOf(MAX_IMAGE_BYTES + 1)] }, 413, "too_large"],
  ];
  for (const [body, status, error] of cases) {
    const response = await send(body);
    expect({ body: JSON.stringify(body).slice(0, 120), status: response.status, error: ((await response.json()) as { error: string }).error }).toEqual({ body: JSON.stringify(body).slice(0, 120), status, error });
  }
  // 4 of 5 MB each are taken.
  expect((await send({ text: "hi", attachments: Array.from({ length: 4 }, () => imageOf(MAX_IMAGE_BYTES)) })).status).toBe(202);
  // A body larger than any message can be is refused before it is read.
  const huge = await s.fetch("/admin/api/conversations/c1/messages", { method: "POST", headers: { ...AUTH, "content-type": "application/json", "content-length": String(64 * 1024 * 1024) }, body: "{}" });
  expect(huge.status).toBe(413);
  // A new conversation is checked the same, and none is made.
  expect((await s.fetch("/admin/api/conversations", post({ agent: "assistant", text: "hi", attachments: [imageOf(MAX_IMAGE_BYTES + 1)] }))).status).toBe(413);
  expect(s.runtime.dispatched.length).toBe(1);
  expect([...s.runtime.pointers.keys()]).toEqual(["dashboard:1"]);
});

test("webSearch: the agent's first line asks it to search the web, for an agent with the websearch tool; another is 400 and nothing is made", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "searcher" });
  s.runtime.add({ conversationId: "c2", key: "telegram:2", agent: "assistant" });

  expect((await s.fetch("/admin/api/conversations/c1/messages", post({ text: "news?", webSearch: true }))).status).toBe(202);
  expect(s.runtime.dispatched[0]?.prompt).toBe(
    `${OPERATOR_NOTE}: the user of this conversation does not see this message or your answer to it; search the web for it with the websearch tool before you answer.]\nnews?`,
  );
  expect(s.logged.find((each) => each.message.includes("sent a message"))?.fields).toMatchObject({ webSearch: true });

  const refused = await s.fetch("/admin/api/conversations/c2/messages", post({ text: "news?", webSearch: true }));
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ error: "invalid_request", message: expect.stringContaining("websearch") });
  // `false` is a message like any other.
  expect((await s.fetch("/admin/api/conversations/c2/messages", post({ text: "hi", webSearch: false }))).status).toBe(202);
  expect(s.runtime.dispatched[1]?.prompt).toBe(`${OPERATOR_NOTE}: the user of this conversation does not see this message or your answer to it.]\nhi`);

  const own = (await (await s.fetch("/admin/api/conversations", post({ agent: "searcher", text: "find it", webSearch: true }))).json()) as { key: string };
  expect(s.runtime.dispatched[2]?.prompt).toBe(`${OPERATOR_NOTE}: search the web for it with the websearch tool before you answer.]\nfind it`);
  expect(s.runtime.pointers.has(own.key)).toBe(true);
  expect((await s.fetch("/admin/api/conversations", post({ agent: "assistant", text: "find it", webSearch: true }))).status).toBe(400);
  expect(s.runtime.pointers.size).toBe(3);
  expect(s.runtime.dispatched.length).toBe(3);
});

test("POST …/messages: a bad body is 400 and dispatches nothing", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });

  for (const body of [{}, { text: "" }, { text: "hi", whenBusy: "followUp" }, { text: "hi", requestId: "dashboard:a b" }, { text: "hi", extra: 1 }, "x".repeat(10)]) {
    const response = await s.fetch("/admin/api/conversations/c1/messages", post(body));
    expect({ body, status: response.status }).toEqual({ body, status: 400 });
  }
  const notJson = await s.fetch("/admin/api/conversations/c1/messages", { method: "POST", headers: AUTH, body: "{" });
  expect(notJson.status).toBe(400);
  expect(s.runtime.dispatched).toEqual([]);
});

test("actions reach only a conversation's current one: 409 when a reset left it behind or no message reached it", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c0", key: "telegram:1", agent: "assistant" }, false);
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  s.runtime.add({ conversationId: "c2" });

  for (const action of ["messages", "abort", "reset"]) {
    const behind = await s.fetch(`/admin/api/conversations/c0/${action}`, post({ text: "hi" }));
    expect(await behind.json()).toMatchObject({ error: "not_current" });
    expect(behind.status).toBe(409);
    const empty = await s.fetch(`/admin/api/conversations/c2/${action}`, post({ text: "hi" }));
    expect(await empty.json()).toMatchObject({ error: "no_agent" });
    const unknown = await s.fetch(`/admin/api/conversations/c9/${action}`, post({ text: "hi" }));
    expect(unknown.status).toBe(404);
  }
  expect(s.runtime.dispatched).toEqual([]);
  expect(s.runtime.aborted).toEqual([]);
  expect(s.runtime.pointers.get("telegram:1")?.conversationId).toBe("c1");
});

test("POST …/abort stops the run through agent.runtime", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant", busy: true });

  const response = await s.fetch("/admin/api/conversations/c1/abort", post());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ conversationId: "c1" });
  expect(s.runtime.aborted).toEqual([{ key: "telegram:1", agent: "assistant", conversationId: "c1" }]);
});

test("POST …/reset points the key to a new conversation through conversations.registry", async () => {
  const s = await started();
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });

  const response = await s.fetch("/admin/api/conversations/c1/reset", post());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ key: "telegram:1", previousConversationId: "c1", conversationId: "c100" });
  expect(s.runtime.pointers.get("telegram:1")?.conversationId).toBe("c100");
});

test("a reset's new conversation is its key's current one, with the key's agent, before any message reaches it: listed so, and talked to at once", async () => {
  const runtime = new Runtime();
  runtime.add({ conversationId: "c1", key: "dashboard:1", agent: "assistant", lastActivity: 1 });
  const s = await started({}, [], runtime);
  await s.fetch("/admin/api/conversations/c1/reset", post());
  // The runtime knows no key of it yet.
  expect(s.runtime.conversations.get("c100")?.key).toBeUndefined();

  const one = await s.fetch("/admin/api/conversations/c100", { headers: AUTH });
  expect(await one.json()).toEqual({ conversationId: "c100", key: "dashboard:1", agent: "assistant", busy: false, usage: ZERO, current: true });
  const page = (await (await s.fetch("/admin/api/conversations", { headers: AUTH })).json()) as { items: Record<string, unknown>[] };
  expect(page.items.map(({ conversationId, key, current }) => ({ conversationId, key, current }))).toEqual([
    { conversationId: "c100", key: "dashboard:1", current: true },
    { conversationId: "c1", key: "dashboard:1", current: false },
  ]);

  const sent = await s.fetch("/admin/api/conversations/c100/messages", post({ text: "again", requestId: "dashboard:r1" }));
  expect(sent.status).toBe(202);
  expect(s.runtime.dispatched.map((each) => each.conversation)).toEqual([{ key: "dashboard:1", agent: "assistant", conversationId: "c100" }]);
  expect((await s.fetch("/admin/api/conversations/c1/messages", post({ text: "hi" }))).status).toBe(409);

  // Reset again before any message: the one in between was left behind, as any other.
  await s.fetch("/admin/api/conversations/c100/reset", post());
  expect((await s.fetch("/admin/api/conversations/c101/reset", post())).status).toBe(200);
  expect(await (await s.fetch("/admin/api/conversations/c101", { headers: AUTH })).json()).toMatchObject({ key: "dashboard:1", agent: "assistant", current: false });
  expect(await (await s.fetch("/admin/api/conversations/c101/messages", post({ text: "hi" }))).json()).toMatchObject({ error: "not_current" });
  expect((await s.fetch("/admin/api/conversations/c102/messages", post({ text: "hi" }))).status).toBe(202);
});

test("a path under /admin/api/ that no route serves is the API's 404, never the dashboard's page", async () => {
  const s = await started();

  const response = await s.fetch("/admin/api/nothing/here", { headers: AUTH });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect((await s.fetch("/admin/api/nothing", { method: "DELETE", headers: AUTH })).status).toBe(404);
});

test("without a built dashboard the API still answers, and /admin/ says why there is no page", async () => {
  const s = await started();

  const page = await s.fetch("/admin/");
  expect(page.status).toBe(404);
  expect(await page.text()).toContain("no dashboard is built");
  expect(page.headers.get("content-security-policy")).toBe(CSP);
  expect((await s.fetch("/admin/api/app", { headers: AUTH })).status).toBe(200);
  expect(s.logged.some((each) => each.message.includes("no dashboard is built"))).toBe(true);
});

const PENDING: PendingPiece[] = [
  { idempotencyKey: "c1:m1", index: 0, channel: "telegram", conversationKey: "telegram:1", state: "retrying", attempts: 2, nextAttemptAt: 50, lastError: "rate_limited: wait", possibleDuplicate: false, storedAt: 10 },
  { idempotencyKey: "c1:m2", index: 0, channel: "telegram", conversationKey: "telegram:1", state: "queued", attempts: 0, possibleDuplicate: false, storedAt: 11 },
];
const RECEIPTS: DeliveryReceipt[] = [
  { idempotencyKey: "c1:m0", index: 0, channel: "telegram", conversationKey: "telegram:1", attempts: 1, outcome: { kind: "delivered", platformMessageId: "77", possibleDuplicate: true }, at: 5 },
  { idempotencyKey: "c2:m0", index: 0, channel: "telegram", conversationKey: "telegram:2", attempts: 3, outcome: { kind: "abandoned", reason: "permanent: chat not found" }, at: 6 },
];

/** An outbound queue holding PENDING and RECEIPTS, as admin-api reads it. */
const queue = defineComponent({
  name: "queue-test",
  setup(pikit) {
    const outbound: OutboundQueue = {
      enqueue: async () => {},
      attach: () => {},
      detach: async () => {},
      pending: async (page) => {
        if (page.cursor !== undefined && page.cursor !== "p2") throw new Error("not a cursor of this queue");
        return page.cursor === undefined ? { items: PENDING.slice(0, page.limit ?? 50), next: "p2" } : { items: [] };
      },
      receipts: {
        read: async (after, limit) => {
          if (after !== undefined && !/^r\d$/.test(after)) throw new Error("malformed cursor");
          const from = after === undefined ? 0 : Number(after.slice(1)) + 1;
          return { items: RECEIPTS.slice(from, from + limit).map((fact, i) => ({ cursor: `r${from + i}`, fact })), gap: false };
        },
      },
    };
    pikit.provide("outbound.queue", outbound);
  },
});

test("delivery: what is not delivered yet and what settled, read from outbound.queue; never a piece's text", async () => {
  const s = await started({}, [queue]);

  const pending = await s.fetch("/admin/api/delivery/pending?limit=10", { headers: AUTH });
  expect(pending.status).toBe(200);
  expect(await pending.json()).toEqual({ items: PENDING, next: "p2" });

  const receipts = await s.fetch("/admin/api/delivery/receipts?limit=1", { headers: AUTH });
  expect(await receipts.json()).toEqual({ items: [{ cursor: "r0", ...RECEIPTS[0] }], gap: false, next: "r0" });
  const after = await s.fetch("/admin/api/delivery/receipts?after=r0&limit=5", { headers: AUTH });
  expect(await after.json()).toEqual({ items: [{ cursor: "r1", ...RECEIPTS[1] }], gap: false, next: "r1" });
  // Past the last one, the cursor stays where it was: read on from it later.
  const end = await s.fetch("/admin/api/delivery/receipts?after=r1", { headers: AUTH });
  expect(await end.json()).toEqual({ items: [], gap: false, next: "r1" });

  for (const path of ["/admin/api/delivery/pending?cursor=forged", "/admin/api/delivery/receipts?after=forged", "/admin/api/delivery/receipts?limit=0"]) {
    expect({ path, status: (await s.fetch(path, { headers: AUTH })).status }).toEqual({ path, status: 400 });
  }
  expect((await s.fetch("/admin/api/delivery/pending")).status).toBe(401);
});

test("delivery without an outbound.queue: 404 not_installed, and the rest of the API as before", async () => {
  const s = await started();

  for (const path of ["/admin/api/delivery/pending", "/admin/api/delivery/receipts"]) {
    const response = await s.fetch(path, { headers: AUTH });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "not_installed" });
  }
});

// Slash commands (agent.command) and titles.

/** A command of the project's own, `/deploy <environment>`, recording where it ran; and one of a malformed name. */
function deployCommand(ran: { conversation: ConversationRef; args: string }[]) {
  return defineComponent({
    name: "deploy-test",
    setup(pikit) {
      const deploy: AgentCommand = {
        description: "Deploy the current branch",
        argumentHint: "<environment>",
        run: async (conversation, args) => {
          ran.push({ conversation, args });
          return { text: `Deploying to ${args}.` };
        },
      };
      pikit.provideKeyed("agent.command", "deploy", deploy);
      pikit.provideKeyed("agent.command", "Bad Name", deploy);
    },
  });
}

/** `model.complete` as a test answers it (`answer`), recording what it was asked. */
function fakeModel(answer: (request: CompletionRequest) => Promise<string> | string) {
  const asked: CompletionRequest[] = [];
  const component = defineComponent({
    name: "model-test",
    setup: (pikit) => pikit.provide("model.complete", { complete: async (request) => (asked.push(request), answer(request)) }),
  });
  return { component, asked };
}

const command = (s: Subject, id: string, name: string, body?: unknown) => s.fetch(`/admin/api/conversations/${encodeURIComponent(id)}/commands/${encodeURIComponent(name)}`, post(body));
const titleOf = async (s: Subject, id: string) => ((await (await s.fetch(`/admin/api/conversations/${id}`, { headers: AUTH })).json()) as { title?: string }).title;

/** Waits until `probe` holds, polling. */
async function until(probe: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

test("GET /admin/api/commands: the App's slash commands by name (admin-api's /new and /name among them), with their hints; a malformed one is left out", async () => {
  const s = await started({}, [deployCommand([])]);

  const response = await s.fetch("/admin/api/commands", { headers: AUTH });

  expect(await response.json()).toEqual({
    items: [
      { name: "deploy", description: "Deploy the current branch", argumentHint: "<environment>" },
      { name: "name", description: "Set the conversation's title", argumentHint: "<title>" },
      { name: "new", description: "Start a new conversation: this one is kept, and its key starts again empty" },
    ],
  });
});

test("POST …/commands/:name runs a command in the conversation, as an action: its note comes back; unknown 404, failing 422, left behind 409; logged by name, never its arguments", async () => {
  const ran: { conversation: ConversationRef; args: string }[] = [];
  const s = await started({}, [deployCommand(ran)]);
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  // Listed once a message reached it.
  await s.app.context().emit("agent.dispatched", { conversation: { key: "telegram:1", agent: "assistant", conversationId: "c1" }, admission: { kind: "started", requestId: "m0" } });

  const deployed = await command(s, "c1", "deploy", { args: "  staging  " });
  expect(deployed.status).toBe(200);
  expect(await deployed.json()).toEqual({ text: "Deploying to staging." });
  expect(ran).toEqual([{ conversation: { key: "telegram:1", agent: "assistant", conversationId: "c1" }, args: "staging" }]);
  expect(s.logged.find((each) => each.message.includes("ran a command"))?.fields).toEqual({ operator: "ops", conversation: "telegram:1", command: "deploy" });
  expect(JSON.stringify(s.logged)).not.toContain("staging");
  // Nothing reached the agent: a command is not a message.
  expect(s.runtime.dispatched).toEqual([]);

  expect(await (await command(s, "c1", "nope")).json()).toMatchObject({ error: "unknown_command" });
  expect((await command(s, "c1", "nope")).status).toBe(404);
  expect((await command(s, "c1", "Bad Name")).status).toBe(404);
  const failing = await command(s, "c1", "name", { args: "  " });
  expect(failing.status).toBe(422);
  expect(await failing.json()).toEqual({ error: "command_failed", message: "Write the title after the command: /name <title>" });
  expect((await command(s, "c1", "name", { args: 5 })).status).toBe(400);
  expect((await command(s, "c1", "name", { title: "x" })).status).toBe(400);
  expect((await command(s, "nobody", "name", { args: "x" })).status).toBe(404);

  // /name: the conversation's title, in it and in the list.
  const named = await command(s, "c1", "name", { args: '"Trip to Lisbon."' });
  expect(await named.json()).toEqual({ text: "Titled \u201cTrip to Lisbon\u201d." });
  expect(await titleOf(s, "c1")).toBe("Trip to Lisbon");
  const page = (await (await s.fetch("/admin/api/conversations", { headers: AUTH })).json()) as { items: { conversationId: string; title?: string }[] };
  expect(page.items.find((each) => each.conversationId === "c1")?.title).toBe("Trip to Lisbon");

  // /new: the key starts again in a new conversation, untitled until its own first run; the old one is behind, with its title.
  const fresh = await command(s, "c1", "new");
  expect(await fresh.json()).toEqual({ text: "A new conversation started; the previous one is kept, and can be read." });
  expect(s.runtime.pointers.get("telegram:1")?.conversationId).toBe("c100");
  const reset = (await (await s.fetch("/admin/api/conversations/c100", { headers: AUTH })).json()) as { title?: string };
  expect(reset).toMatchObject({ key: "telegram:1", current: true });
  expect(reset.title).toBeUndefined();
  expect(await titleOf(s, "c1")).toBe("Trip to Lisbon");
  const behind = await command(s, "c1", "name", { args: "Too late" });
  expect(behind.status).toBe(409);
  expect(await behind.json()).toMatchObject({ error: "not_current" });
});

// admin-api's own commands pass the agent.command suite: /name titles the conversation, /new resets its key.
for (const c of createAgentCommandConformance(() => {
  const runtime = new Runtime();
  let sql: SqlDatabase | undefined;
  const reader = defineComponent({
    name: "sql-reader",
    setup(pikit) {
      const handle = pikit.use("storage.sql");
      return { start: () => void (sql = handle.get()) };
    },
  });
  return {
    components: [auth, agents, sqliteStorage(), runtime.component(), adminApi, reader],
    conversation: async (_app, ctx) => runtime.registry.resolve("dashboard:suite", "assistant", ctx),
    runs: [
      {
        name: "name",
        args: "Weekend plans",
        check: async (outcome, conversation) => {
          expect(outcome.text).toBe("Titled \u201cWeekend plans\u201d.");
          expect(await sql?.query("SELECT title FROM admin_api_conversation_titles WHERE conversation = ?", [conversation.conversationId])).toEqual([{ title: "Weekend plans" }]);
        },
      },
      {
        name: "new",
        check: async (_outcome, conversation) => {
          expect(runtime.pointers.get(conversation.key)?.conversationId).not.toBe(conversation.conversationId);
        },
      },
    ],
    failures: [{ name: "name", args: "" }],
  };
})) {
  test(`admin-api's commands ${c.group}: ${c.name}`, () => c.run());
}

/** A run of `key`'s conversation `id` that settled, whose first message the operator wrote. */
const settled = (key: string, id: string, text: string, requestId = "m1") => ({
  conversation: { key, agent: "assistant", conversationId: id },
  requestId,
  requestIds: [requestId],
  kind: "completed" as const,
  messages: [
    { role: "user", content: [{ type: "text", text: `${OPERATOR_NOTE}.]\n${text}` }, { type: "image", mimeType: "image/png", data: PIXEL }] },
    { role: "assistant", content: [{ type: "text", text: "Sure." }] },
  ] as never[],
});

test("a model titles a conversation after its first run settles, in the background, from its first message, which names it meanwhile; once; a reset's new one gets its own", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const model = fakeModel(async (request) => (await held, request.prompt.includes("Madrid") ? "Madrid weekend" : 'Title: "Trip to Lisbon."\nSecond line'));
  const s = await started({}, [model.component]);
  s.runtime.add({ conversationId: "c1", key: "dashboard:1", agent: "assistant" });

  // The event does not wait for the model; until it answers, the first message names the conversation.
  await s.app.context().emit("agent.settled", settled("dashboard:1", "c1", "Plan a trip to Lisbon in May"));
  await until(() => model.asked.length === 1, "the model to be asked");
  expect(await titleOf(s, "c1")).toBe("Plan a trip to Lisbon in May");
  release();
  await until(async () => (await titleOf(s, "c1")) === "Trip to Lisbon", "the title");
  expect(model.asked).toEqual([{ model: "test/model", system: TITLE_SYSTEM, prompt: "Plan a trip to Lisbon in May", maxTokens: TITLE_TOKENS }]);
  // Later runs leave it as it is.
  await s.app.context().emit("agent.settled", settled("dashboard:1", "c1", "And Porto?", "m2"));
  await Bun.sleep(20);
  expect(model.asked.length).toBe(1);
  expect(s.logged.find((each) => each.message.includes("titled a conversation"))?.fields).toEqual({ conversation: "dashboard:1", conversationId: "c1", model: "test/model" });

  // Another conversation of the key (a reset's) is titled from its own first message.
  s.runtime.add({ conversationId: "c2", key: "dashboard:1", agent: "assistant" });
  await s.app.context().emit("agent.settled", settled("dashboard:1", "c2", "Now a weekend in Madrid"));
  await until(async () => (await titleOf(s, "c2")) === "Madrid weekend", "the reset's title");
  expect(await titleOf(s, "c1")).toBe("Trip to Lisbon");
});

test("a title that failed is tried once more after a later run, from the first message, then never; titleModel names the model; /name wins over any model", async () => {
  let calls = 0;
  const model = fakeModel(() => {
    calls++;
    if (calls === 1) throw new Error("the provider is down");
    return calls === 2 ? "   " : "Never written";
  });
  const s = await started({ titleModel: "test/titles" }, [model.component]);
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  s.runtime.add({ conversationId: "c2", key: "telegram:2", agent: "assistant" });
  const ctx = s.app.context();

  await ctx.emit("agent.settled", settled("telegram:1", "c1", "first"));
  await until(() => s.logged.some((each) => each.message.includes("did not title")), "the failure to be logged");
  await ctx.emit("agent.settled", settled("telegram:1", "c1", "second", "m2"));
  await until(() => s.logged.filter((each) => each.message.includes("did not title")).length === 2, "the second failure (an answer with no title)");
  await ctx.emit("agent.settled", settled("telegram:1", "c1", "third", "m3"));
  await Bun.sleep(20);
  expect(model.asked.map((each) => [each.model, each.prompt])).toEqual([
    ["test/titles", "first"],
    ["test/titles", "first"],
  ]);
  // No title: its first message names it.
  expect(await titleOf(s, "c1")).toBe("First");

  // Named by the operator first: no model is asked.
  await command(s, "c2", "name", { args: "Mine" });
  await ctx.emit("agent.settled", settled("telegram:2", "c2", "hello"));
  await Bun.sleep(20);
  expect(model.asked.length).toBe(2);
  expect(await titleOf(s, "c2")).toBe("Mine");
});

test("a run that failed or was aborted titles nothing, and without model.complete nothing is titled", async () => {
  const model = fakeModel(() => "Never");
  const s = await started({}, [model.component]);
  s.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  await s.app.context().emit("agent.settled", { ...settled("telegram:1", "c1", "hi"), kind: "aborted" });
  await Bun.sleep(20);
  expect(model.asked).toEqual([]);

  const bare = await started();
  bare.runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant" });
  await bare.app.context().emit("agent.settled", settled("telegram:1", "c1", "hi"));
  await Bun.sleep(20);
  expect(await titleOf(bare, "c1")).toBeUndefined();
});

test("archive, unarchive, delete: the list only, any conversation; archived ones listed apart; unknown 404, an operator's only", async () => {
  const runtime = new Runtime();
  runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant", lastActivity: 1 });
  runtime.add({ conversationId: "c2", key: "dashboard:2", agent: "assistant", lastActivity: 2 });
  const s = await started({}, [], runtime);
  const listed = async (archived = false) =>
    ((await (await s.fetch(`/admin/api/conversations${archived ? "?archived=1" : ""}`, { headers: AUTH })).json()) as { items: { conversationId: string }[] }).items.map((each) => each.conversationId);
  expect(await listed()).toEqual(["c2", "c1"]);

  const archived = await s.fetch("/admin/api/conversations/c1/archive", post());
  expect(archived.status).toBe(200);
  expect(await archived.json()).toEqual({ conversationId: "c1" });
  expect(await s.fetch("/admin/api/conversations/c2/delete", post()).then((r) => r.status)).toBe(200);
  expect(await listed()).toEqual([]);
  expect(await listed(true)).toEqual(["c1"]);

  expect(await s.fetch("/admin/api/conversations/c1/unarchive", post()).then((r) => r.status)).toBe(200);
  expect(await listed()).toEqual(["c1"]);
  // The runtime keeps both: nothing of its own is deleted.
  expect(runtime.conversations.has("c2")).toBe(true);

  expect((await s.fetch("/admin/api/conversations/c9/archive", post())).status).toBe(404);
  expect((await s.fetch("/admin/api/conversations?archived=yes", { headers: AUTH })).status).toBe(400);
  expect((await s.fetch("/admin/api/conversations/c1/delete", { method: "POST" })).status).toBe(401);
});

test("at start, the conversations with no title yet are titled from their first message, the most recently active first", async () => {
  const runtime = new Runtime();
  runtime.add({ conversationId: "c1", key: "telegram:1", agent: "assistant", lastActivity: 1 });
  runtime.add({ conversationId: "c2", key: "dashboard:2", agent: "assistant", lastActivity: 2 });
  const user = (text: string) => ({ role: "user", content: text });
  // Newest first, as a transcript is read: the first message is the last entry.
  runtime.transcripts.set("c1", [
    { id: "e2", kind: "message", messages: [{ role: "assistant", content: "faux" }] },
    { id: "e1", kind: "message", messages: [user("plan a trip to Lisbon")] },
  ]);
  runtime.transcripts.set("c2", [{ id: "e1", kind: "message", messages: [user("[From the operator, in the pikit dashboard: …]\nreview the notes")] }]);
  const model = fakeModel((request) => `Title of ${request.prompt}`);

  const s = await started({}, [model.component], runtime);
  await until(async () => (await titleOf(s, "c1")) !== undefined, "the older conversation's title");

  expect(model.asked.map((each) => each.prompt)).toEqual(["review the notes", "plan a trip to Lisbon"]);
  expect(await titleOf(s, "c2")).toBe("Title of review the notes");
  expect(await titleOf(s, "c1")).toBe("Title of plan a trip to Lisbon");
});
