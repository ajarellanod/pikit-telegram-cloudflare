/**
 * admin-api on Cloudflare, with a fake platform: every key is an "object", an App of its own running
 * admin-api's default export on the `durable` target (its runtime a double, its `storage.sql` SQLite),
 * reached through an `actor.mailbox` that calls its `actor.inbox` handlers with JSON copies, as
 * platform-cloudflare's RPC does. The Worker's half serves the routes over them; the index is the
 * object `admin-api:index`. The workerd lane runs the same on real Durable Objects.
 */

import { afterEach, expect, test } from "bun:test";
import { type App, type AppContext, defineApp, defineComponent, silentLogger } from "@pikit/core";
import { type ActorCallHandler, ActorCallError, type ActorInboxHandler, type ActorMailbox, answerCall, callResult, type JsonValue } from "@pikit/contracts";
import { sqliteStorage } from "@pikit/pi-adapter/testing";
import { type ApiConversation, type ApiEvent, MAX_DURABLE_IMAGE_BYTES, OPERATOR_NOTE } from "./api.ts";
import { qualify, unqualify } from "./backend.ts";
import { INDEX_KEY } from "./conversation-index.ts";
import adminApi, { worker } from "./index.ts";
import { CONVERSATIONS_PER_PAGE, polled } from "./remote.ts";
import { ANSWER_CHARS } from "./calls.ts";
import { agents, AUTH, auth, imageOf, PIXEL, Runtime, type Served, serve, sse } from "./runtime.test-support.ts";

const copy = (value: JsonValue): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

/** One key's object: its App, its runtime, and the handlers its components registered. */
interface FakeObject {
  app: App;
  runtime: Runtime;
  answers: Map<string, ActorCallHandler>;
  handlers: Map<string, ActorInboxHandler>;
  ctx: AppContext;
}

/** The objects, by key, each started at its first message or call, as Durable Objects are. */
class Platform {
  readonly objects = new Map<string, Promise<FakeObject>>();
  /** Every call, as `key type`: what the Worker spent in subrequests. */
  readonly calls: string[] = [];
  /** Keys whose object cannot be reached. */
  readonly unreachable = new Set<string>();
  /** What the objects' Apps warned about. */
  readonly warnings: string[] = [];
  /** What a key's runtime holds before its object starts. */
  readonly before = new Map<string, (runtime: Runtime) => void>();

  readonly mailbox: ActorMailbox = {
    send: async (key, type, message) => {
      const object = await this.object(key);
      const handler = object.handlers.get(type);
      if (handler === undefined) throw new Error(`no handler for ${type}`);
      await handler(key, copy(message), object.ctx);
    },
    call: async (key, type, message) => {
      this.calls.push(`${key} ${type}`);
      if (this.unreachable.has(key)) throw new ActorCallError("unreachable", `the conversation object of "${key}" could not be reached`);
      const object = await this.object(key);
      const handler = object.answers.get(type);
      if (handler === undefined) throw new ActorCallError("no_handler", `no answer handler for ${type}`);
      return callResult(await answerCall(handler, key, copy(message), object.ctx));
    },
  };

  object(key: string): Promise<FakeObject> {
    let found = this.objects.get(key);
    if (found === undefined) {
      found = this.start(key);
      this.objects.set(key, found);
    }
    return found;
  }

  private async start(key: string): Promise<FakeObject> {
    const runtime = new Runtime(String);
    this.before.get(key)?.(runtime);
    const answers = new Map<string, ActorCallHandler>();
    const handlers = new Map<string, ActorInboxHandler>();
    const platform = defineComponent({
      name: "platform-test",
      setup: (pikit) => {
        pikit.provide("actor.inbox", { handle: (type, handler) => void handlers.set(type, handler), answer: (type, handler) => void answers.set(type, handler) });
        pikit.provide("actor.mailbox", this.mailbox);
      },
    });
    const logger = { ...silentLogger, warn: (message: string) => void this.warnings.push(message) };
    const app = await defineApp({ components: [auth, agents, runtime.component(), platform, sqliteStorage(), adminApi], target: "durable", logger }).create();
    await app.start();
    return { app, runtime, answers, handlers, ctx: app.context() };
  }

  /** What `key`'s object tells the index of its conversation `conversationId` active at `at` (the tests below send it from the events). */
  async active(key: string, at: number, conversationId = "1"): Promise<void> {
    await this.mailbox.send(INDEX_KEY, "admin-api.seen", { entries: [{ key, conversationId, agent: "assistant", at }] }, (await this.object(key)).ctx);
  }

  /** The index's first page, as the Worker reads it. */
  async listed(): Promise<string[]> {
    const index = await this.object(INDEX_KEY);
    const page = callResult(await answerCall(index.answers.get("admin-api.list") as ActorCallHandler, INDEX_KEY, { limit: 50 }, index.ctx)) as { items: { key: string; conversationId: string }[] };
    return page.items.map((each) => qualify(each.key, each.conversationId));
  }

  async stop(): Promise<void> {
    for (const object of this.objects.values()) await (await object).app.stop();
  }
}

const platforms: Platform[] = [];
const workers: Served[] = [];
afterEach(async () => {
  for (const served of workers.splice(0)) await served.app.stop();
  for (const platform of platforms.splice(0)) await platform.stop();
});

/** The platform and the Worker's App: admin-api's Worker half, with admin.auth and the mailbox. */
async function cloud(): Promise<{ platform: Platform; worker: Served }> {
  const platform = new Platform();
  platforms.push(platform);
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", platform.mailbox) });
  const served = await serve([auth, mailbox, worker], {}, "durable");
  workers.push(served);
  return { platform, worker: served };
}

/** `key`'s object, with conversation `1` (left behind by a reset when `reset`) and `2`. */
async function chat(platform: Platform, key: string, reset = false): Promise<Runtime> {
  const { runtime } = await platform.object(key);
  runtime.add({ conversationId: "1", key, agent: "assistant", lastActivity: 10 }, !reset);
  if (reset) runtime.add({ conversationId: "2", key, agent: "assistant", lastActivity: 20 });
  return runtime;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { ...AUTH, "content-type": "application/json" },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

test("ids: <key>~<the object's id>, split on the last ~; anything else names no conversation", () => {
  expect(qualify("telegram:1", "2")).toBe("telegram:1~2");
  expect(unqualify("telegram:1~2")).toEqual({ key: "telegram:1", local: "2" });
  expect(unqualify("http:a~b~12")).toEqual({ key: "http:a~b", local: "12" });
  for (const id of ["", "telegram:1", "~2", "telegram:1~", "telegram:1~x", "telegram:1~2a"]) expect({ id, found: unqualify(id) }).toEqual({ id, found: undefined });
});

test("the Worker's list: conversations from the index, newest activity first, each read from its object with a qualified id", async () => {
  const { platform, worker: w } = await cloud();
  await chat(platform, "telegram:1", true);
  await chat(platform, "telegram:2");
  await platform.active("telegram:1", 100, "1");
  await platform.active("telegram:1", 150, "2");
  await platform.active("telegram:2", 200);
  platform.calls.length = 0;

  const response = await w.fetch("/admin/api/conversations", { headers: AUTH });
  const body = (await response.json()) as { items: ApiConversation[]; next?: string };

  expect(response.status).toBe(200);
  expect(body.items.map(({ conversationId, current }) => ({ conversationId, current }))).toEqual([
    { conversationId: "telegram:2~1", current: true },
    { conversationId: "telegram:1~2", current: true },
    { conversationId: "telegram:1~1", current: false },
  ]);
  expect(body.next).toBeUndefined();
  // One call to the index, one per conversation to its key's object.
  expect(platform.calls).toEqual([`${INDEX_KEY} admin-api.list`, "telegram:2 admin-api.conversation", "telegram:1 admin-api.conversation", "telegram:1 admin-api.conversation"]);
  // The index's object is not a conversation, and was given none.
  const none = await platform.mailbox.call(INDEX_KEY, "admin-api.conversation", { conversationId: "1" }, w.app.context()).catch((error: unknown) => error);
  expect((none as ActorCallError).code).toBe("not_found");
});

test("the Worker's list pages, at most CONVERSATIONS_PER_PAGE whatever limit asks; an object that does not answer is left out and logged", async () => {
  const { platform, worker: w } = await cloud();
  const count = CONVERSATIONS_PER_PAGE + 3;
  for (let i = 0; i < count; i++) {
    await chat(platform, `telegram:${i}`);
    await platform.active(`telegram:${i}`, 1_000 + i);
  }
  platform.unreachable.add(`telegram:${count - 1}`);
  platform.calls.length = 0;

  const first = (await (await w.fetch("/admin/api/conversations?limit=100", { headers: AUTH })).json()) as { items: ApiConversation[]; next?: string };
  expect(platform.calls.length).toBe(1 + CONVERSATIONS_PER_PAGE);
  expect(first.items.length).toBe(CONVERSATIONS_PER_PAGE - 1);
  expect(first.items[0]?.conversationId).toBe(`telegram:${count - 2}~1`);
  expect(w.logged.some((each) => each.message.includes("left out of the list") && each.fields?.conversation === `telegram:${count - 1}`)).toBe(true);

  const second = (await (await w.fetch(`/admin/api/conversations?cursor=${encodeURIComponent(first.next as string)}`, { headers: AUTH })).json()) as { items: ApiConversation[]; next?: string };
  expect(second.items.map((each) => each.conversationId)).toEqual(["telegram:2~1", "telegram:1~1", "telegram:0~1"]);
  expect(second.next).toBeUndefined();

  const forged = await w.fetch("/admin/api/conversations?cursor=forged", { headers: AUTH });
  expect(forged.status).toBe(400);
  expect(await forged.json()).toMatchObject({ error: "invalid_cursor" });
});

test("the index learns of an object's conversations when its App starts, and of a message once it is dispatched; told twice, it keeps one row", async () => {
  const platform = new Platform();
  platforms.push(platform);
  // Conversations its object held before admin-api was installed, or whose events were missed.
  platform.before.set("email:ana@empresa.com", (runtime) => {
    runtime.add({ conversationId: "1", key: "email:ana@empresa.com", agent: "assistant", lastActivity: 50 }, false);
    runtime.add({ conversationId: "2", key: "email:ana@empresa.com", agent: "assistant", lastActivity: 70 });
  });
  const { app, runtime } = await platform.object("email:ana@empresa.com");
  expect(await platform.listed()).toEqual(["email:ana@empresa.com~2", "email:ana@empresa.com~1"]);

  await platform.object("telegram:9");
  const conversation = { key: "telegram:9", agent: "assistant", conversationId: "1" };
  (await platform.object("telegram:9")).runtime.add(conversation);
  await (await platform.object("telegram:9")).runtime.runtime.dispatch({ requestId: "m1", conversation, prompt: "hi" }, (await platform.object("telegram:9")).ctx);
  expect((await platform.listed())[0]).toBe("telegram:9~1");

  // The same again, and the object starting again: one row each, the newest time kept.
  await app.stop();
  platform.objects.delete("email:ana@empresa.com");
  platform.before.set("email:ana@empresa.com", (again) => {
    for (const each of runtime.conversations.values()) again.add(each, false);
  });
  await platform.object("email:ana@empresa.com");
  await (await platform.object("telegram:9")).runtime.runtime.dispatch({ requestId: "m1", conversation, prompt: "hi" }, (await platform.object("telegram:9")).ctx);
  expect(await platform.listed()).toEqual(["telegram:9~1", "email:ana@empresa.com~2", "email:ana@empresa.com~1"]);
});

test("one conversation and its transcript from its object; an unknown or malformed id is 404; an object that cannot be reached is 503", async () => {
  const { platform, worker: w } = await cloud();
  const runtime = await chat(platform, "telegram:1");
  runtime.transcripts.set("1", [{ id: "e1", kind: "message", messages: [{ role: "user", content: "hi" }] }]);

  const one = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}`, { headers: AUTH });
  expect(await one.json()).toMatchObject({ conversationId: "telegram:1~1", key: "telegram:1", current: true });
  const transcript = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}/transcript?limit=5`, { headers: AUTH });
  expect(await transcript.json()).toEqual({ items: [{ id: "e1", kind: "message", messages: [{ role: "user", content: "hi" }] }] });
  expect(runtime.pages).toContainEqual({ limit: 5 });

  for (const id of ["telegram:1~9", "telegram:1", "telegram:1~x", "%E0"]) {
    for (const path of ["", "/transcript", "/events"]) {
      const response = await w.fetch(`/admin/api/conversations/${id.startsWith("%") ? id : encodeURIComponent(id)}${path}`, { headers: AUTH });
      expect({ id, path, status: response.status }).toEqual({ id, path, status: 404 });
    }
  }

  platform.unreachable.add("telegram:1");
  const down = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}`, { headers: AUTH });
  expect(down.status).toBe(503);
  expect(await down.json()).toMatchObject({ error: "unavailable" });
});

test("actions reach the object of the key, with its own id; its refusals cross the call; a reset answers qualified ids", async () => {
  const { platform, worker: w } = await cloud();
  const runtime = await chat(platform, "telegram:1", true);

  const sent = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~2")}/messages`, post({ text: "stop and summarise", requestId: "dashboard:1" }));
  expect(sent.status).toBe(202);
  expect(await sent.json()).toEqual({ requestId: "dashboard:1", admission: "started" });
  expect(runtime.dispatched).toEqual([
    {
      requestId: "dashboard:1",
      conversation: { key: "telegram:1", agent: "assistant", conversationId: "2" },
      prompt: `${OPERATOR_NOTE}: the user of this conversation does not see this message or your answer to it.]\nstop and summarise`,
      whenBusy: "followUp",
    },
  ]);
  expect(w.logged.find((each) => each.message.includes("sent a message"))?.fields).toMatchObject({ operator: "ops", conversation: "telegram:1" });
  expect(JSON.stringify(w.logged)).not.toContain("summarise");

  for (const action of ["messages", "abort", "reset"]) {
    const behind = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}/${action}`, post({ text: "hi" }));
    expect({ action, status: behind.status, body: await behind.json() }).toMatchObject({ action, status: 409, body: { error: "not_current" } });
  }

  const aborted = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~2")}/abort`, post());
  expect(await aborted.json()).toEqual({ conversationId: "telegram:1~2" });
  expect(runtime.aborted).toEqual([{ key: "telegram:1", agent: "assistant", conversationId: "2" }]);

  const reset = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~2")}/reset`, post());
  expect(await reset.json()).toEqual({ key: "telegram:1", previousConversationId: "telegram:1~2", conversationId: "telegram:1~100" });
  expect(runtime.pointers.get("telegram:1")?.conversationId).toBe("100");

  // The new one: no message reached it, and it is the key's current one, with the key's agent (its object's key).
  expect(runtime.conversations.get("100")?.key).toBeUndefined();
  const fresh = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~100")}`, { headers: AUTH });
  expect(await fresh.json()).toMatchObject({ conversationId: "telegram:1~100", key: "telegram:1", agent: "assistant", current: true });
  runtime.dispatched.length = 0;
  const again = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~100")}/messages`, post({ text: "go on", requestId: "dashboard:2" }));
  expect(again.status).toBe(202);
  expect(runtime.dispatched.map((each) => each.conversation)).toEqual([{ key: "telegram:1", agent: "assistant", conversationId: "100" }]);
});

test("a conversation of the dashboard's own on the Worker: one call to the object of its new key, listed first at once", async () => {
  const { platform, worker: w } = await cloud();
  await chat(platform, "telegram:1");
  await platform.active("telegram:1", 100);
  platform.calls.length = 0;

  const response = await w.fetch("/admin/api/conversations", post({ agent: "assistant", text: "what changed today?" }));
  const body = (await response.json()) as { conversationId: string; key: string; requestId: string; admission: string };

  expect(response.status).toBe(201);
  expect(body.key).toMatch(/^dashboard:[0-9a-f-]{36}$/);
  expect(body).toMatchObject({ conversationId: `${body.key}~100`, admission: "started" });
  expect(platform.calls).toEqual([`${body.key} admin-api.start`]);
  const { runtime } = await platform.object(body.key);
  expect(runtime.dispatched).toEqual([
    { requestId: body.requestId, conversation: { key: body.key, agent: "assistant", conversationId: "100" }, prompt: `${OPERATOR_NOTE}.]\nwhat changed today?`, whenBusy: "followUp" },
  ]);
  // Told to the index when the message was dispatched, before any run.
  expect((await platform.listed())[0]).toBe(body.conversationId);
  const page = (await (await w.fetch("/admin/api/conversations", { headers: AUTH })).json()) as { items: ApiConversation[] };
  expect(page.items.map((each) => each.conversationId)).toEqual([body.conversationId, "telegram:1~1"]);

  const unknown = await w.fetch("/admin/api/conversations", post({ agent: "nobody", text: "hi" }));
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({ error: "unknown_agent" });
});

test("the agents on the Worker are the index object's App's, one call", async () => {
  const { platform, worker: w } = await cloud();

  const response = await w.fetch("/admin/api/agents", { headers: AUTH });

  expect(await response.json()).toEqual({
    items: [
      { name: "assistant", model: "test/model", tools: [], steward: true },
      { name: "searcher", model: "test/search", tools: ["websearch", "lookup"], steward: false },
    ],
  });
  expect(platform.calls).toEqual([`${INDEX_KEY} admin-api.agents`]);
});

test("images and a web search cross the call to the object; images over 1 MB in all are 413 before any call; a web search the agent cannot do is the object's 400", async () => {
  const { platform, worker: w } = await cloud();
  const runtime = await chat(platform, "telegram:1");
  const path = `/admin/api/conversations/${encodeURIComponent("telegram:1~1")}/messages`;

  const sent = await w.fetch(path, post({ text: "look", attachments: [{ kind: "image", mimeType: "image/png", data: PIXEL }] }));
  expect(sent.status).toBe(202);
  expect(runtime.dispatched[0]).toMatchObject({ prompt: `${OPERATOR_NOTE}: the user of this conversation does not see this message or your answer to it.]\nlook`, images: [{ mimeType: "image/png", data: PIXEL }] });

  platform.calls.length = 0;
  const big = await w.fetch(path, post({ text: "look", attachments: [imageOf(MAX_DURABLE_IMAGE_BYTES / 2), imageOf(MAX_DURABLE_IMAGE_BYTES / 2 + 1)] }));
  expect(big.status).toBe(413);
  expect(await big.json()).toMatchObject({ error: "too_large", message: expect.stringContaining("Cloudflare") });
  const started = await w.fetch("/admin/api/conversations", post({ agent: "assistant", text: "look", attachments: [imageOf(MAX_DURABLE_IMAGE_BYTES + 1)] }));
  expect(started.status).toBe(413);
  expect(platform.calls).toEqual([]);

  const search = await w.fetch(path, post({ text: "news?", webSearch: true }));
  expect(search.status).toBe(400);
  expect(await search.json()).toMatchObject({ error: "invalid_request", message: expect.stringContaining("websearch") });
  expect(runtime.dispatched.length).toBe(1);

  const own = (await (await w.fetch("/admin/api/conversations", post({ agent: "searcher", text: "find it", webSearch: true, attachments: [imageOf(8, "image/jpeg")] }))).json()) as { key: string };
  const { runtime: theirs } = await platform.object(own.key);
  expect(theirs.dispatched[0]).toMatchObject({
    conversation: { agent: "searcher" },
    prompt: `${OPERATOR_NOTE}: search the web for it with the websearch tool before you answer.]\nfind it`,
    images: [{ mimeType: "image/jpeg", data: imageOf(8).data }],
  });
});

test("a transcript page too long for a call's answer (images inline) is answered shorter, until it fits", async () => {
  const { platform, worker: w } = await cloud();
  const runtime = await chat(platform, "telegram:1");
  const image = "A".repeat(Math.ceil(ANSWER_CHARS / 2.5));
  runtime.transcripts.set(
    "1",
    ["e3", "e2", "e1"].map((id) => ({ id, kind: "message", messages: [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: image }] }] })),
  );

  const page = (await (await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}/transcript?limit=4`, { headers: AUTH })).json()) as { items: { id: string }[] };

  expect(page.items.map((each) => each.id)).toEqual(["e3", "e2"]);
  expect(runtime.pages.slice(-2)).toEqual([{ limit: 4 }, { limit: 2 }]);
});

test("live events on the Worker: the object's snapshot first, as server-sent events", async () => {
  const { platform, worker: w } = await cloud();
  await chat(platform, "telegram:1");
  const client = new AbortController();

  const response = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}/events`, { headers: AUTH, signal: client.signal });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const stream = sse(response);
  expect(await stream.take(1)).toEqual([{ type: "snapshot", conversationId: "1" }]);
  client.abort();
  await stream.reader.cancel();
  // The object's watch was opened for the snapshot, and released at once.
  const { runtime } = await platform.object("telegram:1");
  expect(runtime.released).toBe(runtime.watching);
});

test("polled: the first snapshot, then only those that changed, and it ends after its polls or when the client goes", async () => {
  const answers: ApiEvent[] = [{ type: "snapshot", run: 1 }, { type: "snapshot", run: 1 }, { type: "snapshot", run: 2 }, { type: "snapshot", run: 2 }, { type: "snapshot" }];
  let asked = 0;
  const next = async () => answers[asked++] as ApiEvent;
  const seen: ApiEvent[] = [];
  for await (const event of polled({ type: "snapshot" }, next, 1, 6, undefined)) seen.push(event);
  expect(seen).toEqual([{ type: "snapshot" }, { type: "snapshot", run: 1 }, { type: "snapshot", run: 2 }, { type: "snapshot" }]);
  expect(asked).toBe(5);

  const client = new AbortController();
  const stopped: ApiEvent[] = [];
  const began = Date.now();
  setTimeout(() => client.abort(), 30);
  for await (const event of polled({ type: "snapshot" }, async () => ({ type: "snapshot", at: Date.now() }), 1_000, 40, client.signal)) stopped.push(event);
  expect(stopped).toEqual([{ type: "snapshot" }]);
  expect(Date.now() - began).toBeLessThan(900);
});

test("the composition is an object's App (the index's); delivery is not listed on the Worker", async () => {
  const { worker: w } = await cloud();

  const app = (await (await w.fetch("/admin/api/app", { headers: AUTH })).json()) as { target: string; components: { name: string }[] };
  expect(app.target).toBe("durable");
  expect(app.components.map((c) => c.name)).toEqual(expect.arrayContaining(["admin-api", "runtime-test"]));

  const delivery = await w.fetch("/admin/api/delivery/pending", { headers: AUTH });
  expect(delivery.status).toBe(404);
  expect(await delivery.json()).toMatchObject({ error: "not_installed", message: expect.stringContaining("Durable Object") });
});

test("every Worker route answers 401 without an operator, and calls no object", async () => {
  const { platform, worker: w } = await cloud();
  // The session's routes take the credential itself (admin-api.test.ts).
  const api = w.keys().filter((key) => key.includes("/admin/api") && !key.endsWith("/admin/api/session"));
  expect(api.length).toBeGreaterThan(9);

  for (const key of api) {
    const [method = "GET", pattern = "/"] = key.split(" ");
    const response = await w.fetch(pattern.replace(":id", "telegram%3A1~1").replace("*", "x"), { method, ...(method === "POST" && { body: "{}" }) });
    expect({ key, status: response.status }).toEqual({ key, status: 401 });
  }
  expect(platform.calls).toEqual([]);
  expect(platform.objects.size).toBe(0);
});

test("in an object's App the default export answers only with actor.inbox and actor.mailbox; without them its start says so", async () => {
  const runtime = new Runtime();
  const app = await defineApp({ components: [auth, runtime.component(), sqliteStorage(), adminApi], target: "durable", logger: silentLogger }).create();

  const failed = (await app.start().catch((error: unknown) => error)) as Error;
  expect(String(failed.cause)).toContain("admin-api: in a Durable Object's App it answers the Worker's calls and tells the conversation index, which needs actor.inbox, actor.mailbox");
});

test("a run that settles, fails or is resumed in an object tells the index (a run not resumed was told when its message was dispatched); a failed send is logged, not the run's", async () => {
  const platform = new Platform();
  platforms.push(platform);
  const { app } = await platform.object("telegram:7");
  const ctx = app.context();
  const conversation = { key: "telegram:7", agent: "assistant", conversationId: "1" };

  await ctx.emit("agent.settled", { conversation, requestId: "r1", requestIds: ["r1"], kind: "completed", messages: [] });
  expect(await platform.listed()).toEqual(["telegram:7~1"]);
  await ctx.emit("agent.started", { conversation: { ...conversation, conversationId: "2" }, requestId: "r2", resumed: false });
  expect(await platform.listed()).toEqual(["telegram:7~1"]);
  await Bun.sleep(2);
  await ctx.emit("agent.started", { conversation: { ...conversation, conversationId: "2" }, requestId: "r2", resumed: true });
  expect(await platform.listed()).toEqual(["telegram:7~2", "telegram:7~1"]);

  // The index does not take it: the event's other listeners and the run go on.
  const index = await platform.object(INDEX_KEY);
  index.handlers.delete("admin-api.seen");
  await ctx.emit("agent.failed", { conversation, requestId: "r3", requestIds: ["r3"], kind: "failed", messages: [], error: { code: "x", message: "x" } });
  expect(platform.warnings).toEqual(["admin-api: the conversation index did not take this conversation's activity; its next activity tells it again"]);
});

test("slash commands on the Worker: listed from the index object's App, run in the conversation's object (refusals cross the call); a title is the object's, in the list too", async () => {
  const { platform, worker: w } = await cloud();
  const runtime = await chat(platform, "telegram:1");
  await platform.active("telegram:1", 100);
  platform.calls.length = 0;

  const listedCommands = (await (await w.fetch("/admin/api/commands", { headers: AUTH })).json()) as { items: { name: string }[] };
  expect(listedCommands.items.map((each) => each.name)).toEqual(["name", "new"]);
  expect(platform.calls).toEqual([`${INDEX_KEY} admin-api.commands`]);

  const path = (name: string) => `/admin/api/conversations/${encodeURIComponent("telegram:1~1")}/commands/${name}`;
  platform.calls.length = 0;
  const named = await w.fetch(path("name"), post({ args: "Weekend plans" }));
  expect(await named.json()).toEqual({ text: "Titled \u201cWeekend plans\u201d." });
  expect(platform.calls).toEqual(["telegram:1 admin-api.command"]);
  const page = (await (await w.fetch("/admin/api/conversations", { headers: AUTH })).json()) as { items: ApiConversation[] };
  expect(page.items).toMatchObject([{ conversationId: "telegram:1~1", title: "Weekend plans" }]);
  expect(w.logged.find((each) => each.message.includes("ran a command"))?.fields).toEqual({ operator: "ops", conversation: "telegram:1", command: "name" });

  expect((await w.fetch(path("nope"), post())).status).toBe(404);
  const failing = await w.fetch(path("name"), post({ args: "" }));
  expect({ status: failing.status, body: await failing.json() }).toMatchObject({ status: 422, body: { error: "command_failed" } });

  const fresh = await w.fetch(path("new"), post());
  expect(fresh.status).toBe(200);
  expect(runtime.pointers.get("telegram:1")?.conversationId).toBe("100");
  const behind = await w.fetch(path("name"), post({ args: "Too late" }));
  expect({ status: behind.status, body: await behind.json() }).toMatchObject({ status: 409, body: { error: "not_current" } });
  // The reset's new conversation is untitled until its own first run; the one behind keeps its title.
  const reset = (await (await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~100")}`, { headers: AUTH })).json()) as ApiConversation;
  expect(reset).toMatchObject({ current: true });
  expect(reset.title).toBeUndefined();
  expect(await (await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}`, { headers: AUTH })).json()).toMatchObject({ current: false, title: "Weekend plans" });
});

test("archive and delete on the Worker: one call to the index object, which lists them apart (archived) or never (deleted)", async () => {
  const { platform, worker: w } = await cloud();
  await chat(platform, "telegram:1", true);
  await chat(platform, "telegram:2");
  await platform.active("telegram:1", 100, "1");
  await platform.active("telegram:2", 200);
  const ids = async (archived = false) =>
    ((await (await w.fetch(`/admin/api/conversations${archived ? "?archived=1" : ""}`, { headers: AUTH })).json()) as { items: ApiConversation[] }).items.map((each) => each.conversationId);
  platform.calls.length = 0;

  const archived = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:1~1")}/archive`, { method: "POST", headers: { ...AUTH, "x-pikit-admin": "1" } });
  expect(archived.status).toBe(200);
  expect(platform.calls).toEqual([`${INDEX_KEY} admin-api.hide`]);
  await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:2~1")}/delete`, { method: "POST", headers: { ...AUTH, "x-pikit-admin": "1" } });

  expect(await ids()).toEqual([]);
  expect(await ids(true)).toEqual(["telegram:1~1"]);
  const unknown = await w.fetch(`/admin/api/conversations/${encodeURIComponent("telegram:9~1")}/archive`, { method: "POST", headers: { ...AUTH, "x-pikit-admin": "1" } });
  expect(unknown.status).toBe(404);
});
