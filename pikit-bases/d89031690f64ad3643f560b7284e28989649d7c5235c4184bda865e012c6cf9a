/**
 * channel-telegram-webhook's tests. They are copied with the component and keep running in your project.
 *
 * Telegram is `fake-telegram.test-support.ts`, a local stand-in of the Bot API that posts each update
 * to the webhook, with its secret, as Telegram does. The routes are served on a local port by a small
 * server defined here, as server-bun serves them. The rest is played by doubles: `actor.mailbox`,
 * `wakeups`, `storage.kv` and `agent.submissions` from `@pikit/contracts/testing`, and here secrets, a
 * conversation registry, a router stage and an agent runtime whose runs answer `answer: <message>`
 * (`hold` waits to be released, `fail` fails, `long` answers 9000 characters, `throw` cannot be
 * dispatched, `gone` finds its agent gone for good). Most tests run both halves in one App, as on a server; one runs them in two Apps, as on
 * Cloudflare.
 */

import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { type App, type AppContext, BACKGROUND_CONTEXT, type Clock, type ComponentDefinition, defineApp, defineComponent, type Logger, silentLogger } from "@pikit/core";
import {
  type ActorMailbox,
  AgentUnavailableError,
  type AgentRuntime,
  type AgentSubmissions,
  type ChannelTransport,
  type ConversationRef,
  type ConversationRegistry,
  type DeliveryReceipt,
  type KeyValueStorage,
  type OutboundMessage,
  type OutboundQueue,
} from "@pikit/contracts";
import type { WorkersHost } from "@pikit/contracts/cloudflare";
import { createLifecycleConformance } from "@pikit/core/testing";
import {
  createMemoryFeed,
  createMemoryKeyValueStorage,
  createMemoryMailbox,
  createMemorySubmissions,
  createMemoryWakeups,
  type RecordingSubmissions,
  withWorkersHost,
} from "@pikit/contracts/testing";
import { accountsOf } from "./account.ts";
import { registerInbox } from "./actor-inbox.ts";
import { within } from "./bot.ts";
import { LOGIN_COOL_DOWN_MS } from "./login.ts";
import { afterDeploy } from "./deploy.ts";
import { type FakeTelegram, startFakeTelegram } from "./fake-telegram.test-support.ts";
import channelTelegramWebhook, { NAME, worker, WORKER_NAME } from "./index.ts";
import { POSSIBLE_DUPLICATE_MARK } from "./transport.ts";

const OWNER = { id: 1001, first_name: "Ada", username: "ada" };
const STRANGER = { id: 2002, first_name: "Eve" };
const SECRET = "test-webhook-secret-0123456789";

const fakes: FakeTelegram[] = [];
const apps: App[] = [];
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop().catch(() => {});
  for (const fake of fakes.splice(0)) await fake.stop();
});

function fake(): FakeTelegram {
  const telegram = startFakeTelegram();
  fakes.push(telegram);
  return telegram;
}

function secretsWith(values: Record<string, string>) {
  return defineComponent({ name: "secrets-test", setup: (pikit) => pikit.provide("secrets", { get: async (name) => values[name] || undefined }) });
}

function memoryRegistry(resets: string[]) {
  const pointers = new Map<string, ConversationRef>();
  let sessions = 0;
  const registry: ConversationRegistry = {
    async resolve(key, agent) {
      const found = pointers.get(key) ?? { key, agent, conversationId: `s${++sessions}` };
      pointers.set(key, found);
      return found;
    },
    get: async (key) => pointers.get(key),
    async reset(key) {
      const previous = pointers.get(key);
      if (previous === undefined) return undefined;
      const conversation = { ...previous, conversationId: `s${++sessions}` };
      pointers.set(key, conversation);
      resets.push(key);
      return { conversation, previousConversationId: previous.conversationId, newConversationId: conversation.conversationId };
    },
  };
  return defineComponent({ name: "registry-test", setup: (pikit) => pikit.provide("conversations.registry", registry) });
}

const router = defineComponent({
  name: "router-test",
  setup: (pikit) => pikit.pipeline("route.resolve", (value) => (value.decision !== undefined ? value : { ...value, decision: { agent: "assistant", access: "allow" } })),
});

/**
 * Records every dispatch; a request seen before is a duplicate. It records admissions and run ends in
 * `submissions`, as runtime-pi does, and emits the run's events.
 */
function scriptedRuntime(submissions: RecordingSubmissions, seen: Set<string> = new Set()) {
  const dispatched: { requestId: string; key: string; prompt: string }[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const component = defineComponent({
    name: "runtime-test",
    setup(pikit) {
      let events: AppContext | undefined;
      const runtime: AgentRuntime = {
        async dispatch({ requestId, conversation, prompt }) {
          if (prompt === "throw") throw new Error("the session store is down");
          if (prompt === "gone") throw new AgentUnavailableError(conversation.agent, `no agent "${conversation.agent}" now`);
          dispatched.push({ requestId, key: conversation.key, prompt });
          if (seen.has(requestId)) return { kind: "duplicate", requestId };
          seen.add(requestId);
          const ctx = (events ?? BACKGROUND_CONTEXT) as AppContext;
          await submissions.admitted(conversation, requestId, ctx);
          void (async () => {
            await ctx.emit("agent.started", { conversation, requestId, resumed: false });
            if (prompt === "hold") await released;
            const base = { conversation, requestId, requestIds: [requestId], messages: [] };
            if (prompt === "fail") {
              const error = { code: "provider_error", message: "no" };
              await submissions.settled({ conversation, requestId, requestIds: [requestId], kind: "failed", error }, ctx);
              await ctx.emit("agent.failed", { ...base, kind: "failed", error });
            } else {
              const text = prompt === "long" ? "word ".repeat(1800) : `answer: **${prompt}**`;
              await submissions.settled({ conversation, requestId, requestIds: [requestId], kind: "completed", text }, ctx);
              await ctx.emit("agent.settled", { ...base, kind: "completed", text });
            }
          })();
          return { kind: "started", requestId };
        },
        abort: async () => {},
        resume: async () => {},
      };
      pikit.provide("agent.runtime", runtime);
      return { start: (ctx) => void (events = ctx.derive(() => BACKGROUND_CONTEXT)) };
    },
  });
  return { component, dispatched, release: () => release() };
}

const kvWith = (storage: KeyValueStorage) => defineComponent({ name: "kv-test", setup: (pikit) => pikit.provide("storage.kv", storage) });
const submissionsWith = (submissions: AgentSubmissions) => defineComponent({ name: "submissions-test", setup: (pikit) => pikit.provide("agent.submissions", submissions) });

/** Serves the App's `http.route` keys on a local port, as server-bun does. */
function httpServer() {
  let url = "";
  const component = defineComponent({
    name: "server-test",
    setup(pikit) {
      const routes = pikit.useKeyed("http.route");
      let server: ReturnType<typeof Bun.serve> | undefined;
      return {
        start(ctx) {
          const background = ctx.derive(() => BACKGROUND_CONTEXT);
          server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(request) {
              const route = routes.get(`${request.method} ${new URL(request.url).pathname}`);
              if (route === undefined) return new Response("not found", { status: 404 });
              return await Promise.resolve(route(request, background)).catch(() => new Response("error", { status: 500 }));
            },
          });
          url = `http://127.0.0.1:${server.port}`;
        },
        async stop() {
          await server?.stop(true);
        },
      };
    },
  });
  return { component, url: () => url };
}

/** A queue that records what the channel does with it, and delivers each enqueued piece at once through the attached transport. */
function recordingQueue() {
  const enqueued: OutboundMessage[] = [];
  const attached: string[] = [];
  const detached: string[] = [];
  const transports = new Map<string, ChannelTransport>();
  const keys = new Set<string>();
  const queue: OutboundQueue = {
    async enqueue(message) {
      enqueued.push(message);
      if (keys.has(message.idempotencyKey)) return;
      keys.add(message.idempotencyKey);
      const transport = transports.get(message.channel);
      if (transport === undefined) throw new Error("no transport");
      for (const [index, text] of transport.split(message.text).entries()) {
        await transport.send({ key: `${message.idempotencyKey}#${index}`, conversationKey: message.conversationKey, text, possibleDuplicate: false }, new AbortController().signal);
      }
    },
    attach(channel, transport) {
      attached.push(channel);
      transports.set(channel, transport);
    },
    async detach(channel) {
      detached.push(channel);
      transports.delete(channel);
    },
    receipts: createMemoryFeed<DeliveryReceipt>().feed,
    // Every piece is sent within enqueue: none is ever pending.
    pending: async () => ({ items: [] }),
  };
  const component = defineComponent({ name: "queue-test", setup: (pikit) => pikit.provide("outbound.queue", queue) });
  return { component, enqueued, attached, detached };
}

const secretsFor = (telegram: FakeTelegram) => ({
  TELEGRAM_BOT_TOKEN: telegram.token,
  TELEGRAM_ALLOWED_USERS: String(OWNER.id),
  TELEGRAM_WEBHOOK_SECRET: SECRET,
});

const configFor = (telegram: FakeTelegram, accounts: string[] = []) => ({
  [NAME]: { apiBase: telegram.url, accounts },
  [WORKER_NAME]: { apiBase: telegram.url, accounts },
});

interface StartOptions {
  telegram?: FakeTelegram;
  secrets?: Record<string, string>;
  accounts?: string[];
  submissions?: RecordingSubmissions;
  kv?: KeyValueStorage;
  seen?: Set<string>;
  queue?: ReturnType<typeof recordingQueue>;
  logger?: Logger;
  clock?: Clock;
}

/** Both halves in one App, as on a server: the mailbox hands each update to the same App. */
async function started(options: StartOptions = {}) {
  const telegram = options.telegram ?? fake();
  const submissions = options.submissions ?? createMemorySubmissions().submissions;
  const kv = options.kv ?? createMemoryKeyValueStorage();
  const secrets: Record<string, string> = options.secrets ?? secretsFor(telegram);
  const runtime = scriptedRuntime(submissions, options.seen);
  const server = httpServer();
  const resets: string[] = [];
  const app = await defineApp({
    components: [
      secretsWith(secrets),
      memoryRegistry(resets),
      router,
      runtime.component,
      submissionsWith(submissions),
      kvWith(kv),
      createMemoryWakeups({ retryMs: 50 }),
      ...(options.queue === undefined ? [] : [options.queue.component]),
      channelTelegramWebhook,
      createMemoryMailbox(),
      worker,
      server.component,
    ],
    config: configFor(telegram, options.accounts),
    logger: options.logger ?? silentLogger,
    ...(options.clock !== undefined && { clock: options.clock }),
  }).create();
  apps.push(app);
  await app.start();
  // What deployment-cloudflare's `up` does once the new version answers.
  const problems = await afterDeploy({ url: server.url(), config: { apiBase: telegram.url, accounts: options.accounts ?? [] }, get: (name) => secrets[name], say: () => {} });
  expect(problems).toEqual([]);
  return { telegram, runtime, resets, app, kv, submissions, url: server.url() };
}

async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

/** A logger that keeps the warnings and errors. */
function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return { debug() {}, info() {}, warn: (message) => void lines.push(message), error: (message) => void lines.push(message), lines };
}

// ---------------------------------------------------------------------------------------------
// What each half declares, and their lifecycles.

test("what setup declares: component.json's fields cover both halves", async () => {
  const telegram = fake();
  const app = await defineApp({
    components: [
      secretsWith({}),
      memoryRegistry([]),
      scriptedRuntime(createMemorySubmissions().submissions).component,
      submissionsWith(createMemorySubmissions().submissions),
      kvWith(createMemoryKeyValueStorage()),
      createMemoryWakeups(),
      channelTelegramWebhook,
      createMemoryMailbox(),
      worker,
    ],
    config: configFor(telegram),
    logger: silentLogger,
  }).create();
  const described = (name: string) => app.describe().components.find((component) => component.name === name);

  expect(described(NAME)).toMatchObject({
    provides: [],
    requires: ["secrets", "conversations.registry", "agent.runtime", "agent.submissions", "storage.kv", "wakeups", "actor.inbox"],
    optional: ["outbound.queue"],
  });
  expect(described(WORKER_NAME)).toMatchObject({ provides: ["http.route"], requires: ["secrets", "actor.mailbox"], optional: [] });
});

test("registerInbox: a handler registered there is what actor.mailbox reaches, from the component's start on", async () => {
  const received: [string, unknown][] = [];
  let sender: ActorMailbox | undefined;
  const app = await defineApp({
    components: [
      defineComponent({
        name: "inbox-test",
        setup(pikit) {
          const inbox = registerInbox(pikit, "test.message", async (key, message) => void received.push([key, message]));
          return { start: () => inbox.start() };
        },
      }),
      createMemoryMailbox(),
      defineComponent({
        name: "sender-test",
        setup(pikit) {
          const mailbox = pikit.use("actor.mailbox");
          return { start: () => void (sender = mailbox.get()) };
        },
      }),
    ],
    logger: silentLogger,
  }).create();
  apps.push(app);
  await app.start();

  await (sender as ActorMailbox).send("telegram:1", "test.message", { update_id: 1 }, app.context());
  expect(received).toEqual([["telegram:1", { update_id: 1 }]]);
});

for (const c of createLifecycleConformance(() => {
  const telegram = fake();
  const submissions = createMemorySubmissions().submissions;
  return {
    component: channelTelegramWebhook,
    providers: [
      secretsWith(secretsFor(telegram)),
      memoryRegistry([]),
      scriptedRuntime(submissions).component,
      submissionsWith(submissions),
      kvWith(createMemoryKeyValueStorage()),
      createMemoryWakeups(),
      createMemoryMailbox(),
    ],
    config: { [NAME]: { apiBase: telegram.url } },
  };
})) {
  test(`${NAME} ${c.group}: ${c.name}`, () => c.run());
}

for (const c of createLifecycleConformance(() => {
  const telegram = fake();
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", { send: async () => {}, call: async () => null }) });
  return { component: worker, providers: [secretsWith(secretsFor(telegram)), mailbox], config: { [WORKER_NAME]: { apiBase: telegram.url } } };
})) {
  test(`${WORKER_NAME} ${c.group}: ${c.name}`, () => c.run());
}

test("each half refuses to start without what it needs, and names it", async () => {
  const telegram = fake();
  const startError = async (components: ComponentDefinition[], secrets: Record<string, string>): Promise<string> => {
    const submissions = createMemorySubmissions().submissions;
    const app = await defineApp({
      components: [secretsWith(secrets), memoryRegistry([]), scriptedRuntime(submissions).component, submissionsWith(submissions), kvWith(createMemoryKeyValueStorage()), createMemoryWakeups(), ...components],
      config: configFor(telegram),
      logger: silentLogger,
    }).create();
    const error = await app.start().then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    );
    await app.stop().catch(() => {});
    return String((error?.cause as Error | undefined)?.message);
  };
  const halves = [channelTelegramWebhook, createMemoryMailbox(), worker];
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS } = secretsFor(telegram);

  expect(await startError(halves, { TELEGRAM_ALLOWED_USERS, TELEGRAM_WEBHOOK_SECRET: SECRET })).toContain("TELEGRAM_BOT_TOKEN is not set");
  // Nobody listed is not a failure: the bot takes logins (see "The password"). A password that could
  // be guessed is.
  expect(await startError(halves, { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_PASSWORD: "1234567" })).toContain(
    "TELEGRAM_PASSWORD is not usable: it is shorter than 8 characters, so it could be guessed. Choose a longer password, or remove it",
  );
  expect(await startError(halves, { TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS: "not-an-id", TELEGRAM_WEBHOOK_SECRET: SECRET })).toContain(
    'TELEGRAM_ALLOWED_USERS: "not-an-id" is not a Telegram user id',
  );
  expect(await startError(halves, { TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS })).toContain("TELEGRAM_WEBHOOK_SECRET is not set. Run `pikit configure`");
  expect(await startError(halves, { TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS, TELEGRAM_WEBHOOK_SECRET: "short" })).toContain("shorter than 16 characters");
  expect(await startError(halves, { TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS, TELEGRAM_WEBHOOK_SECRET: "has spaces in it, not allowed" })).toContain("only letters, digits");
});

// ---------------------------------------------------------------------------------------------
// The Worker's half: the secret, what it lets through, the acknowledgement.

test("a request without the webhook's secret, or with another, is 401 and reaches nothing", async () => {
  const s = await started();
  const update = s.telegram.message(OWNER, "hello");

  expect(await s.telegram.post(update, { secret: null })).toBe(401);
  expect(await s.telegram.post(update, { secret: `${SECRET}-not` })).toBe(401);
  expect(await s.telegram.post(update, { secret: SECRET.slice(0, -1) })).toBe(401);
  const garbage = await fetch(`${s.url}/telegram`, { method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET }, body: "{not json" });
  expect(garbage.status).toBe(400);
  await Bun.sleep(50);
  expect(s.runtime.dispatched).toEqual([]);
  expect(s.telegram.sent).toEqual([]);
});

test("a stranger is told their id once, and nothing reaches the agent", async () => {
  const s = await started();

  expect((await s.telegram.write(STRANGER, "let me in")).status).toBe(200);
  expect((await s.telegram.write(STRANGER, "please")).status).toBe(200);

  expect(s.telegram.sent).toEqual([
    { chatId: STRANGER.id, text: `This bot is private. Your Telegram user id is ${STRANGER.id}: its owner can let you in by adding it to TELEGRAM_ALLOWED_USERS.`, html: false },
  ]);
  expect(s.runtime.dispatched).toEqual([]);
});

test("group messages are acknowledged and ignored; a message without text gets a hint", async () => {
  const s = await started();

  expect((await s.telegram.write(OWNER, "in a group", { chat: "group" })).status).toBe(200);
  expect((await s.telegram.write(OWNER, undefined)).status).toBe(200);
  await s.telegram.write(OWNER, undefined, { caption: "a photo caption" });
  await s.telegram.sentCount(2);

  expect(s.telegram.sent[0]).toMatchObject({ chatId: OWNER.id, text: "I can only read text messages for now." });
  expect(s.runtime.dispatched.map((d) => d.prompt)).toEqual(["a photo caption"]);
});

test("a message reaches its conversation, is acknowledged once it is durable, and the answer comes back formatted", async () => {
  const s = await started();

  const { status } = await s.telegram.write(OWNER, "hello");

  // 200 once the conversation holds it: dispatched, and recorded as admitted.
  expect(status).toBe(200);
  expect(s.runtime.dispatched).toEqual([{ requestId: `telegram:${OWNER.id}:1`, key: `telegram:${OWNER.id}`, prompt: "hello" }]);
  expect(await s.telegram.sentCount(1)).toEqual([{ chatId: OWNER.id, text: "answer: <b>hello</b>", html: true }]);
  // The cursor moves past the answer delivered.
  await until(async () => (await s.kv.namespace(NAME).get("answers-cursor")) === "1", "the cursor past the answer");
});

test("the chat shows typing while the agent works", async () => {
  const s = await started();

  await s.telegram.write(OWNER, "hold");
  await until(() => s.telegram.actions.length > 0, "typing");
  s.runtime.release();
  await s.telegram.sentCount(1);

  expect(s.telegram.actions[0]).toEqual({ chatId: OWNER.id, action: "typing" });
});

test("an update Telegram delivers again is one request, answered once", async () => {
  const s = await started();
  const { update } = await s.telegram.write(OWNER, "hello");
  await s.telegram.sentCount(1);

  // Its 200 was lost: Telegram posts the same update again.
  expect(await s.telegram.post(update)).toBe(200);
  await Bun.sleep(100);

  expect(s.runtime.dispatched.map((d) => d.requestId)).toEqual([`telegram:${OWNER.id}:1`, `telegram:${OWNER.id}:1`]);
  expect(s.telegram.sent).toHaveLength(1);
});

test("an update the conversation could not take is 500, so Telegram delivers it again", async () => {
  const s = await started();

  expect((await s.telegram.write(OWNER, "throw")).status).toBe(500);
  expect(s.telegram.sent).toEqual([]);
});

test("an update whose agent is gone for good (a live agent deleted) is 200, its sender told once: Telegram never delivers it again", async () => {
  const s = await started();

  expect((await s.telegram.write(OWNER, "gone")).status).toBe(200);
  await s.telegram.sentCount(1);
  expect(s.telegram.sent.map((each) => each.text)).toEqual(["Sorry, I can't answer that here."]);
});

// ---------------------------------------------------------------------------------------------
// The object's half: commands, delivery from the feed.

test("/start and /help explain, /new starts the conversation over, once even if Telegram delivers it again", async () => {
  const s = await started();

  await s.telegram.write(OWNER, "/start");
  await s.telegram.write(OWNER, "hello");
  await s.telegram.sentCount(2);
  const { update } = await s.telegram.write(OWNER, "/new@pikit_test_bot");
  expect(await s.telegram.post(update)).toBe(200);
  await s.telegram.sentCount(3);
  await Bun.sleep(50);

  expect(s.telegram.sent[0]?.text).toContain("Hi Ada! Send me a message");
  expect(s.telegram.sent.map((m) => m.text).slice(1)).toEqual(["answer: <b>hello</b>", "Started a new conversation."]);
  expect(s.resets).toEqual([`telegram:${OWNER.id}`]);
  expect(s.runtime.dispatched.map((d) => d.prompt)).toEqual(["hello"]);

  // A command for another bot is text for the agent.
  await s.telegram.write(OWNER, "/new@another_bot");
  await s.telegram.sentCount(4);
  expect(s.runtime.dispatched.map((d) => d.prompt)).toEqual(["hello", "/new@another_bot"]);
});

test("a failed run is told in the chat, with its error code", async () => {
  const s = await started();

  await s.telegram.write(OWNER, "fail");

  expect((await s.telegram.sentCount(1))[0]?.text).toContain("something went wrong while answering (provider_error)");
});

test("a long answer is sent in pieces within Telegram's limit", async () => {
  const s = await started();

  await s.telegram.write(OWNER, "long");
  await s.telegram.sentCount(3);
  await Bun.sleep(50);

  expect(s.telegram.sent).toHaveLength(3);
  for (const message of s.telegram.sent) expect(message.text.length).toBeLessThanOrEqual(4096);
  expect(s.telegram.sent.map((m) => m.text).join(" ").replace(/\s+/g, " ").trim()).toBe("word ".repeat(1800).trim());
});

test("an answer that ended while no wakeup ran is delivered at the next one, and only once", async () => {
  const submissions = createMemorySubmissions().submissions;
  const kv = createMemoryKeyValueStorage();
  const telegram = fake();
  const first = await started({ telegram, submissions, kv });
  await first.telegram.write(OWNER, "hold");

  // The App stops (a deploy, an eviction) and the run ends while nothing runs the channel.
  await first.app.stop();
  first.runtime.release();
  const conversation = { key: `telegram:${OWNER.id}`, agent: "assistant", conversationId: "s1" };
  await until(async () => (await submissions.get(conversation, `telegram:${OWNER.id}:1`, first.app.context()))?.kind === "settled", "the run's end");
  expect(telegram.sent).toEqual([]);

  // The next App asks for the wakeup at start.
  await started({ telegram, submissions, kv, seen: new Set([`telegram:${OWNER.id}:1`]) });
  expect(await telegram.sentCount(1)).toEqual([{ chatId: OWNER.id, text: "answer: <b>hold</b>", html: true }]);
  await until(async () => (await kv.namespace(NAME).get("answers-cursor")) === "1", "the cursor past the answer");
  for (const app of apps.splice(0)) await app.stop();

  await started({ telegram, submissions, kv, seen: new Set([`telegram:${OWNER.id}:1`]) });
  await Bun.sleep(200);
  expect(telegram.sent).toHaveLength(1);
});

test("a piece whose send may have reached Telegram (found sending) is sent again marked ↻", async () => {
  const kv = createMemoryKeyValueStorage();
  // The object died during this piece's send, before it could mark it sent.
  await kv.namespace(NAME).set(`piece:s1:telegram:${OWNER.id}:1#0`, "sending");
  const s = await started({ kv });

  await s.telegram.write(OWNER, "hello");

  expect(await s.telegram.sentCount(1)).toEqual([{ chatId: OWNER.id, text: `${POSSIBLE_DUPLICATE_MARK}answer: <b>hello</b>`, html: true }]);
  // Once the cursor is past the answer, its marks are gone.
  await until(async () => (await kv.namespace(NAME).get(`piece:s1:telegram:${OWNER.id}:1#0`)) === undefined, "the mark deleted");
  expect(await kv.namespace(NAME).get("answers-cursor")).toBe("1");
});

test("a send Telegram refused is tried again later, not marked ↻, and the cursor waits for it", async () => {
  const logger = recordingLogger();
  const s = await started({ logger });
  s.telegram.failNextSend = { code: 502, description: "Bad Gateway" };

  await s.telegram.write(OWNER, "hello");
  await until(() => logger.lines.some((line) => line.includes("delivering an answer failed")), "the failure");
  expect(await s.kv.namespace(NAME).get("answers-cursor")).toBeUndefined();

  expect(await s.telegram.sentCount(1, 5_000)).toEqual([{ chatId: OWNER.id, text: "answer: <b>hello</b>", html: true }]);
});

test("with an outbound.queue, the answer is enqueued once per run and delivered through the attached transport", async () => {
  const queue = recordingQueue();
  const { telegram, app } = await started({ queue });
  expect(queue.attached).toEqual(["telegram"]);

  await telegram.write(OWNER, "hello");
  await telegram.sentCount(1);
  expect(queue.enqueued).toEqual([{ idempotencyKey: `s1:telegram:${OWNER.id}:1`, channel: "telegram", conversationKey: `telegram:${OWNER.id}`, text: "answer: **hello**" }]);
  expect(telegram.sent[0]).toEqual({ chatId: OWNER.id, text: "answer: <b>hello</b>", html: true });

  await app.stop();
  expect(queue.detached).toEqual(["telegram"]);
});

// ---------------------------------------------------------------------------------------------
// Accounts, and the halves in two Apps.

const OPS_BOT = { id: 5353, is_bot: true, first_name: "Ops Bot", username: "acme_ops_bot" };
const OPS_TOKEN = "555555:ops-token-for-tests";
const OPS_SECRET = "ops-webhook-secret-0123456789";
const OPERATOR = { id: 3003, first_name: "Olga" };

test("accounts: each bot has its own path, secret, users, conversations and answers", async () => {
  const telegram = fake();
  const ops = telegram.addBot(OPS_TOKEN, OPS_BOT);
  const secrets: Record<string, string> = { ...secretsFor(telegram), TELEGRAM_OPS_BOT_TOKEN: OPS_TOKEN, TELEGRAM_OPS_ALLOWED_USERS: String(OPERATOR.id), TELEGRAM_OPS_WEBHOOK_SECRET: OPS_SECRET };
  const s = await started({ telegram, secrets, accounts: ["ops"] });
  expect(ops.webhookUrl).toBe(`${s.url}/telegram/ops`);
  expect(ops.webhookSecret).toBe(OPS_SECRET);

  await telegram.write(OWNER, "to the default bot");
  await ops.write(OPERATOR, "to the ops bot");
  await telegram.sentCount(1);
  await ops.sentCount(1);

  expect(s.runtime.dispatched.map((d) => [d.key, d.requestId]).sort()).toEqual(
    [
      [`telegram:${OWNER.id}`, `telegram:${OWNER.id}:1`],
      [`telegram:ops:${OPERATOR.id}`, `telegram:ops:${OPERATOR.id}:1`],
    ].sort(),
  );
  expect(telegram.sent).toEqual([{ chatId: OWNER.id, text: "answer: <b>to the default bot</b>", html: true }]);
  expect(ops.sent).toEqual([{ chatId: OPERATOR.id, text: "answer: <b>to the ops bot</b>", html: true }]);

  // One bot's secret does not open the other's webhook; each bot has its own allowlist.
  expect(await ops.post(ops.message(OPERATOR, "hi"), { secret: SECRET })).toBe(401);
  await ops.write(OWNER, "let me in");
  expect((await ops.sentCount(2))[1]?.text).toContain(`Your Telegram user id is ${OWNER.id}: its owner can let you in by adding it to TELEGRAM_OPS_ALLOWED_USERS`);
});

test("the halves in two Apps, as on Cloudflare: the Worker's App checks and sends, the object's App answers", async () => {
  const telegram = fake();
  const submissions = createMemorySubmissions().submissions;
  const secrets: Record<string, string> = secretsFor(telegram);
  const runtime = scriptedRuntime(submissions);

  // The object's App: the conversation's actor. Its own mailbox is how a test reaches its inbox.
  let objectMailbox: ActorMailbox | undefined;
  const probe = defineComponent({
    name: "probe-test",
    setup(pikit) {
      const mailbox = pikit.use("actor.mailbox");
      return { start: () => void (objectMailbox = mailbox.get()) };
    },
  });
  const objectApp = await defineApp({
    components: [secretsWith(secrets), memoryRegistry([]), router, runtime.component, submissionsWith(submissions), kvWith(createMemoryKeyValueStorage()), createMemoryWakeups(), channelTelegramWebhook, createMemoryMailbox(), probe],
    config: { [NAME]: { apiBase: telegram.url } },
    logger: silentLogger,
  }).create();
  apps.push(objectApp);
  await objectApp.start();

  // The Worker's App: its mailbox is an RPC to the object, as platform-cloudflare's is.
  const rpc = defineComponent({
    name: "rpc-test",
    setup: (pikit) =>
      pikit.provide("actor.mailbox", {
        send: (key, type, message, ctx) => (objectMailbox as ActorMailbox).send(key, type, message, ctx),
        call: (key, type, message, ctx) => (objectMailbox as ActorMailbox).call(key, type, message, ctx),
      }),
  });
  const server = httpServer();
  const workerApp = await defineApp({
    components: [secretsWith(secrets), rpc, worker, server.component],
    config: { [WORKER_NAME]: { apiBase: telegram.url } },
    logger: silentLogger,
  }).create();
  apps.push(workerApp);
  await workerApp.start();
  expect(await afterDeploy({ url: server.url(), config: { apiBase: telegram.url }, get: (name) => secrets[name], say: () => {} })).toEqual([]);

  expect((await telegram.write(OWNER, "hello")).status).toBe(200);
  expect(await telegram.sentCount(1)).toEqual([{ chatId: OWNER.id, text: "answer: <b>hello</b>", html: true }]);
  expect(workerApp.describe().components.map((c) => c.name)).not.toContain(NAME);
});

test("an update for a bot the object's half does not run is refused, loudly", async () => {
  const telegram = fake();
  const ops = telegram.addBot(OPS_TOKEN, OPS_BOT);
  const logger = recordingLogger();
  const secrets: Record<string, string> = { ...secretsFor(telegram), TELEGRAM_OPS_BOT_TOKEN: OPS_TOKEN, TELEGRAM_OPS_ALLOWED_USERS: String(OPERATOR.id), TELEGRAM_OPS_WEBHOOK_SECRET: OPS_SECRET };
  const submissions = createMemorySubmissions().submissions;
  const server = httpServer();
  const app = await defineApp({
    components: [
      secretsWith(secrets),
      memoryRegistry([]),
      router,
      scriptedRuntime(submissions).component,
      submissionsWith(submissions),
      kvWith(createMemoryKeyValueStorage()),
      createMemoryWakeups(),
      channelTelegramWebhook,
      createMemoryMailbox(),
      worker,
      server.component,
    ],
    // The Worker serves ops; the object's half was not told about it.
    config: { [NAME]: { apiBase: telegram.url }, [WORKER_NAME]: { apiBase: telegram.url, accounts: ["ops"] } },
    logger,
  }).create();
  apps.push(app);
  await app.start();
  await afterDeploy({ url: server.url(), config: { apiBase: telegram.url, accounts: ["ops"] }, get: (name) => secrets[name], say: () => {} });

  expect((await ops.write(OPERATOR, "hello")).status).toBe(500);
  expect(logger.lines.join("\n")).toContain("the conversation could not take an update");
});

test("accounts: the default bot's path and secrets; a named one gets its own", () => {
  expect(accountsOf(["ops"])).toEqual([
    {
      name: undefined,
      instance: "telegram",
      tokenSecret: "TELEGRAM_BOT_TOKEN",
      allowedSecret: "TELEGRAM_ALLOWED_USERS",
      webhookSecret: "TELEGRAM_WEBHOOK_SECRET",
      passwordSecret: "TELEGRAM_PASSWORD",
      path: "/telegram",
    },
    {
      name: "ops",
      instance: "telegram:ops",
      tokenSecret: "TELEGRAM_OPS_BOT_TOKEN",
      allowedSecret: "TELEGRAM_OPS_ALLOWED_USERS",
      webhookSecret: "TELEGRAM_OPS_WEBHOOK_SECRET",
      passwordSecret: "TELEGRAM_OPS_PASSWORD",
      path: "/telegram/ops",
    },
  ]);
});

// ---------------------------------------------------------------------------------------------
// The webhook registering itself, without `pikit up` (webhook.ts): GET /telegram/setup, and the
// Worker's start on Cloudflare.

/** The Worker's half alone, as in the Worker's App: a mailbox that records, served on a local port. `host` is its WORKERS_HOST. */
async function workerOnly(options: { telegram: FakeTelegram; secrets?: Record<string, string>; accounts?: string[]; host?: WorkersHost; logger?: Logger; extra?: ComponentDefinition[] }) {
  const sent: [string, string][] = [];
  const mailbox = defineComponent({ name: "mailbox-test", setup: (pikit) => pikit.provide("actor.mailbox", { send: async (key, type) => void sent.push([key, type]), call: async () => null }) });
  const server = httpServer();
  const app = await defineApp({
    components: [
      secretsWith(options.secrets ?? secretsFor(options.telegram)),
      mailbox,
      ...(options.host === undefined ? [worker] : withWorkersHost(options.host, [worker])),
      server.component,
      ...(options.extra ?? []),
    ],
    config: { [WORKER_NAME]: { apiBase: options.telegram.url, accounts: options.accounts ?? [] } },
    logger: options.logger ?? silentLogger,
  }).create();
  apps.push(app);
  await app.start();
  return { app, url: server.url(), sent };
}

const CLOUDFLARE: WorkersHost = { env: { CF_VERSION_METADATA: { id: "version-1", tag: "", timestamp: "" } }, origin: "https://bot.acme.workers.dev" };

test("GET /telegram/setup points every bot at this Worker's origin, with its secret, and says what it did; again, it sets it again", async () => {
  const telegram = fake();
  const ops = telegram.addBot(OPS_TOKEN, OPS_BOT);
  const secrets = { ...secretsFor(telegram), TELEGRAM_OPS_BOT_TOKEN: OPS_TOKEN, TELEGRAM_OPS_ALLOWED_USERS: String(OPERATOR.id), TELEGRAM_OPS_WEBHOOK_SECRET: OPS_SECRET };
  const w = await workerOnly({ telegram, secrets, accounts: ["ops"] });

  const response = await fetch(`${w.url}/telegram/setup`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({
    ok: true,
    version: null,
    bots: [
      { bot: "telegram", webhook: `${w.url}/telegram`, ok: true },
      { bot: "telegram:ops", webhook: `${w.url}/telegram/ops`, ok: true },
    ],
  });
  expect([telegram.webhookUrl, telegram.webhookSecret, telegram.allowedUpdates]).toEqual([`${w.url}/telegram`, SECRET, ["message"]]);
  expect([ops.webhookUrl, ops.webhookSecret, ops.allowedUpdates]).toEqual([`${w.url}/telegram/ops`, OPS_SECRET, ["message"]]);
  for (const secret of [SECRET, OPS_SECRET, telegram.token, OPS_TOKEN]) expect(body).not.toContain(secret);

  // Harmless to repeat, and it always sets: how a new secret reaches Telegram, which never shows it.
  expect((await fetch(`${w.url}/telegram/setup`)).status).toBe(200);
  expect([telegram.webhooksSet, ops.webhooksSet]).toEqual([2, 2]);
  // Telegram's updates reach the webhook it set.
  expect((await telegram.write(OWNER, "hello")).status).toBe(200);
  expect(w.sent).toEqual([[`telegram:${OWNER.id}`, "telegram.update"]]);
});

test("GET /telegram/setup that Telegram refuses answers 502 with what Telegram said, and never the token", async () => {
  const telegram = fake();
  const unknown = "999999:not-a-token-telegram-knows";
  const w = await workerOnly({ telegram, secrets: { ...secretsFor(telegram), TELEGRAM_BOT_TOKEN: unknown } });

  const response = await fetch(`${w.url}/telegram/setup`);
  expect(response.status).toBe(502);
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({
    ok: false,
    version: null,
    bots: [{ bot: "telegram", webhook: `${w.url}/telegram`, ok: false, problem: `Telegram refused the webhook ${w.url}/telegram (telegram setWebhook: 401 Unauthorized)` }],
  });
  expect(body).not.toContain(unknown);
});

test("on Cloudflare the Worker's start registers its webhook at its origin, once per isolate; an isolate finding it registered only asks", async () => {
  const telegram = fake();

  const first = await workerOnly({ telegram, host: CLOUDFLARE });
  expect([telegram.webhookUrl, telegram.webhookSecret, telegram.allowedUpdates]).toEqual(["https://bot.acme.workers.dev/telegram", SECRET, ["message"]]);
  // Asked, set, checked.
  expect([telegram.webhookInfoAsked, telegram.webhooksSet]).toEqual([2, 1]);
  // The isolate's requests ask nothing more.
  const update = telegram.message(OWNER, "hello");
  const posted = await fetch(`${first.url}/telegram`, { method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET }, body: JSON.stringify(update) });
  expect(posted.status).toBe(200);
  expect(telegram.webhookInfoAsked).toBe(2);

  // Another isolate, of the same version or a new one: Telegram has this webhook, so one question and no setWebhook.
  await workerOnly({ telegram, host: { ...CLOUDFLARE, env: { CF_VERSION_METADATA: { id: "version-2" } } } });
  expect([telegram.webhookInfoAsked, telegram.webhooksSet]).toEqual([3, 1]);

  // Pointed elsewhere meanwhile, or with other updates: the next isolate sets it back.
  telegram.webhookUrl = "https://elsewhere.example/telegram";
  await workerOnly({ telegram, host: CLOUDFLARE });
  expect([telegram.webhookUrl, telegram.webhooksSet]).toEqual(["https://bot.acme.workers.dev/telegram", 2]);
  telegram.allowedUpdates = ["message", "edited_message"];
  await workerOnly({ telegram, host: CLOUDFLARE });
  expect([telegram.allowedUpdates, telegram.webhooksSet]).toEqual([["message"], 3]);
});

test("the Worker's start asks Telegram nothing off Cloudflare or over plain HTTP; a refusal is logged, and it starts anyway", async () => {
  const telegram = fake();
  await workerOnly({ telegram });
  await workerOnly({ telegram, host: { env: {}, origin: "http://127.0.0.1:8787" } });
  expect(telegram.webhookInfoAsked).toBe(0);

  const logger = recordingLogger();
  const refused = await workerOnly({ telegram, secrets: { ...secretsFor(telegram), TELEGRAM_BOT_TOKEN: "999999:not-a-token-telegram-knows" }, host: CLOUDFLARE, logger });
  expect(logger.lines.join("\n")).toContain("the webhook could not be registered; open https://bot.acme.workers.dev/telegram/setup to try again");
  // Running: a request without the secret is refused (401), not "not running" (503).
  expect((await fetch(`${refused.url}/telegram`, { method: "POST", body: "{}" })).status).toBe(401);
});

test("setup-webhook.mjs, piped after wrangler deploy: waits for the version deployed, then has the Worker register itself", async () => {
  const telegram = fake();
  let version = "version-1";
  const health = defineComponent({ name: "health-test", setup: (pikit) => pikit.provideKeyed("http.route", "GET /health", () => Response.json({ ok: true, version })) });
  const w = await workerOnly({ telegram, extra: [health] });
  let setBeforeTheVersion: number | undefined;
  setTimeout(() => {
    setBeforeTheVersion = telegram.webhooksSet;
    version = "version-2";
  }, 300);

  const wrangler = [`Uploaded tg-bot (1.20 sec)`, `Deployed tg-bot triggers (0.31 sec)`, `  ${w.url}`, `Current Version ID: version-2`, ``].join("\n");
  const script = Bun.spawn([process.execPath, join(import.meta.dir, "setup-webhook.mjs")], {
    stdin: new Blob([wrangler]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SETUP_INTERVAL_MS: "50", SETUP_WAIT_MS: "10000" },
  });
  const [out, err, code] = await Promise.all([new Response(script.stdout).text(), new Response(script.stderr).text(), script.exited]);

  expect(err).toBe("");
  expect(code).toBe(0);
  // wrangler's output passes through, then what the Worker did.
  expect(out).toBe(`${wrangler}✓ Telegram telegram: webhook ${w.url}/telegram\n`);
  expect(setBeforeTheVersion).toBe(0);
  expect([telegram.webhookUrl, telegram.webhookSecret]).toEqual([`${w.url}/telegram`, SECRET]);
});

test("setup-webhook.mjs fails, saying why, when the deploy printed no URL or the Worker could not register", async () => {
  const telegram = fake();
  const script = (args: string[], stdin: string) =>
    Bun.spawn([process.execPath, join(import.meta.dir, "setup-webhook.mjs"), ...args], { stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe", env: { ...process.env, SETUP_INTERVAL_MS: "20", SETUP_WAIT_MS: "2000" } });
  const outcome = async (child: ReturnType<typeof script>) => {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { out, err, code };
  };

  const failed = await outcome(script([], "✘ [ERROR] A request to the Cloudflare API failed.\n"));
  expect(failed.code).toBe(1);
  expect(failed.err).toContain("no Worker URL in wrangler's output");
  // A link in a warning above the deploy is not the Worker's URL.
  const warned = await outcome(script([], "▲ [WARNING] see https://developers.cloudflare.com/workers/\n✘ [ERROR] A request to the Cloudflare API failed.\n"));
  expect(warned.code).toBe(1);
  expect(warned.err).toContain("no Worker URL in wrangler's output");

  const health = defineComponent({ name: "health-test", setup: (pikit) => pikit.provideKeyed("http.route", "GET /health", () => Response.json({ ok: true, version: "v1" })) });
  const w = await workerOnly({ telegram, secrets: { ...secretsFor(telegram), TELEGRAM_BOT_TOKEN: "999999:not-a-token-telegram-knows" }, extra: [health] });
  const refused = await outcome(script([w.url], ""));
  expect(refused.code).toBe(1);
  expect(refused.out).toBe(`✗ Telegram telegram: Telegram refused the webhook ${w.url}/telegram (telegram setWebhook: 401 Unauthorized)\n`);

  const late = await outcome(script([w.url, "v2"], ""));
  expect(late.code).toBe(1);
  expect(late.err).toContain(`${w.url}/health did not answer from version v2 in time; open ${w.url}/telegram/setup once it does`);
});

// ---------------------------------------------------------------------------------------------
// Logging in from Telegram (login.ts): /login <password>, kept by the chat's actor.

const PASSWORD = "correct horse battery staple";
const loginSecrets = (telegram: FakeTelegram, extra: Record<string, string> = {}): Record<string, string> => ({
  TELEGRAM_BOT_TOKEN: telegram.token,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_PASSWORD: PASSWORD,
  ...extra,
});
const privateBot = (id: number) => `This bot is private. Your Telegram user id is ${id}: its owner can let you in by adding it to TELEGRAM_ALLOWED_USERS.`;
// The object's replies are sent as HTML: Telegram gets `&lt;password&gt;`, and shows `<password>`.
const privateBotWithPassword = (id: number) =>
  `This bot is private. If you have its password, send /login &lt;password&gt;. Your Telegram user id is ${id}: its owner can also let you in by adding it to TELEGRAM_ALLOWED_USERS.`;
const LOGGED_IN = "✓ You're logged in: this chat can talk to the agent now. You may delete your /login message: it contains the password.";
const texts = (telegram: FakeTelegram) => telegram.sent.map((m) => m.text);

test("with a password, a stranger is told their id and /login, once; nothing reaches the agent", async () => {
  const telegram = fake();
  const s = await started({ telegram, secrets: loginSecrets(telegram) });

  expect((await telegram.write(OWNER, "hello?")).status).toBe(200);
  expect((await telegram.write(OWNER, "anyone?")).status).toBe(200);
  expect((await telegram.write(OWNER, undefined)).status).toBe(200);
  await Bun.sleep(50);

  expect(telegram.sent).toMatchObject([{ chatId: OWNER.id, text: privateBotWithPassword(OWNER.id) }]);
  expect(s.runtime.dispatched).toEqual([]);
});

test("/login with the right password: the chat talks to the agent, the password reaches neither the agent nor a log, and a redelivery is not answered twice", async () => {
  const telegram = fake();
  const logger = recordingLogger();
  const s = await started({ telegram, secrets: loginSecrets(telegram), logger });

  const { update } = await telegram.write(OWNER, `/login   ${PASSWORD}  `);
  await telegram.sentCount(1);
  expect(texts(telegram)).toEqual([LOGGED_IN]);
  expect(await telegram.post(update)).toBe(200);

  await telegram.write(OWNER, "hello");
  expect((await telegram.sentCount(2))[1]).toEqual({ chatId: OWNER.id, text: "answer: <b>hello</b>", html: true });
  await telegram.write(OWNER, undefined);
  expect((await telegram.sentCount(3))[2]?.text).toBe("I can only read text messages for now.");
  // /login again is the channel's to answer.
  await telegram.write(OWNER, `/login ${PASSWORD}`);
  expect((await telegram.sentCount(4))[3]?.text).toBe("This chat can talk to me already.");
  // Someone else is still a stranger.
  await telegram.write(STRANGER, "me too?");
  expect((await telegram.sentCount(5))[4]).toMatchObject({ chatId: STRANGER.id, text: privateBotWithPassword(STRANGER.id) });
  await Bun.sleep(50);

  expect(telegram.sent).toHaveLength(5);
  expect(s.runtime.dispatched.map((d) => d.prompt)).toEqual(["hello"]);
  expect(logger.lines.join("\n")).not.toContain(PASSWORD);
});

test("an allowed user's /login is answered by the channel, never by the agent; a stranger may still log in beside the list", async () => {
  const telegram = fake();
  const s = await started({ telegram, secrets: { ...secretsFor(telegram), TELEGRAM_PASSWORD: PASSWORD } });

  await telegram.write(OWNER, `/login ${PASSWORD}`);
  await telegram.write(STRANGER, `/login ${PASSWORD}`);
  await telegram.write(STRANGER, "hi");
  await telegram.sentCount(3);

  expect(texts(telegram).slice(0, 2)).toEqual(["This chat can talk to me already.", LOGGED_IN]);
  expect(s.runtime.dispatched.map((d) => [d.key, d.prompt])).toEqual([[`telegram:${STRANGER.id}`, "hi"]]);
});

test("wrong passwords: each is told; the fifth starts a cool-down in which even the right one is refused; after it, the right one logs in", async () => {
  const telegram = fake();
  let offset = 0;
  const clock: Clock = { now: () => Date.now() + offset, sleep: (ms) => Bun.sleep(ms) };
  const s = await started({ telegram, secrets: loginSecrets(telegram), clock });

  const first = await telegram.write(OWNER, "/login correct horse battery stapler");
  for (let i = 2; i <= 5; i++) await telegram.write(OWNER, `/login guess number ${i}`);
  // Telegram delivering a wrong password again is not another guess.
  expect(await telegram.post(first.update)).toBe(200);
  await telegram.write(OWNER, `/login ${PASSWORD}`);
  await telegram.write(OWNER, "/login");
  await telegram.sentCount(7);
  await Bun.sleep(50);

  expect(texts(telegram)).toEqual([
    ...Array.from({ length: 4 }, () => "Wrong password."),
    "Wrong password. Too many wrong passwords: try again in 15 minutes.",
    "Too many wrong passwords: try again in 15 minute(s).",
    "Too many wrong passwords: try again in 15 minute(s).",
  ]);

  offset = LOGIN_COOL_DOWN_MS;
  await telegram.write(OWNER, "/login");
  await telegram.write(OWNER, `/login ${PASSWORD}`);
  await telegram.write(OWNER, "hello");
  await telegram.sentCount(10);
  expect(texts(telegram).slice(7, 9)).toEqual(["Send /login followed by the password, in one message: /login &lt;password&gt;.", LOGGED_IN]);
  expect(s.runtime.dispatched.map((d) => d.prompt)).toEqual(["hello"]);
});

test("a logged-in chat stays allowed after a restart and after the password is removed; a new password logs it out, and it is told how to log in again", async () => {
  const telegram = fake();
  const kv = createMemoryKeyValueStorage();
  const submissions = createMemorySubmissions().submissions;
  const first = await started({ telegram, kv, submissions, secrets: loginSecrets(telegram) });
  // Told once, before logging in: a new password tells it again.
  await telegram.write(OWNER, "hi?");
  await telegram.write(OWNER, `/login ${PASSWORD}`);
  await telegram.sentCount(2);
  expect(texts(telegram)).toEqual([privateBotWithPassword(OWNER.id), LOGGED_IN]);
  await first.app.stop();

  // Restarted (a deploy, an eviction) with the same password: still allowed.
  const second = await started({ telegram, kv, submissions, secrets: loginSecrets(telegram) });
  await telegram.write(OWNER, "after a restart");
  expect((await telegram.sentCount(3))[2]?.text).toBe("answer: <b>after a restart</b>");
  expect(second.runtime.dispatched.map((d) => d.prompt)).toEqual(["after a restart"]);
  // Stopped once the answer is marked delivered: otherwise it would go again, marked "↻".
  await until(async () => (await kv.namespace(NAME).get("answers-cursor")) === "1", "the cursor past the answer");
  await second.app.stop();

  // The password removed, nobody listed: no new login, and the chat that logged in still talks.
  const logger = recordingLogger();
  const third = await started({ telegram, kv, submissions, secrets: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_WEBHOOK_SECRET: SECRET }, logger });
  expect(logger.lines).toContain("channel-telegram-webhook: nobody is in TELEGRAM_ALLOWED_USERS and TELEGRAM_PASSWORD is not set: only chats that logged in before can talk to it");
  await telegram.write(OWNER, "without the password");
  expect((await telegram.sentCount(4))[3]?.text).toBe("answer: <b>without the password</b>");
  await telegram.write(STRANGER, `/login ${PASSWORD}`);
  expect((await telegram.sentCount(5))[4]).toMatchObject({ chatId: STRANGER.id, text: privateBot(STRANGER.id) });
  expect(third.runtime.dispatched.map((d) => d.prompt)).toEqual(["without the password"]);
  await until(async () => (await kv.namespace(NAME).get("answers-cursor")) === "2", "the cursor past the answer");
  await third.app.stop();

  // Another password: every chat that logged in with the old one is logged out, told how to log in
  // again (once), and logs in with the new one.
  const fourth = await started({ telegram, kv, submissions, secrets: loginSecrets(telegram, { TELEGRAM_PASSWORD: "a brand new password" }) });
  await telegram.write(OWNER, "and now?");
  await telegram.write(OWNER, "hello?");
  await telegram.write(OWNER, `/login ${PASSWORD}`);
  await telegram.write(OWNER, "/login a brand new password");
  await telegram.write(OWNER, "back");
  expect((await telegram.sentCount(9)).slice(5).map((m) => m.text)).toEqual([privateBotWithPassword(OWNER.id), "Wrong password.", LOGGED_IN, "answer: <b>back</b>"]);
  expect(fourth.runtime.dispatched.map((d) => d.prompt)).toEqual(["back"]);
});

test("without a password, /login logs in nothing: with users listed, the Worker tells the stranger alone, with no word of /login", async () => {
  const s = await started();

  expect((await s.telegram.write(STRANGER, `/login ${PASSWORD}`)).status).toBe(200);
  expect((await s.telegram.write(STRANGER, "/login")).status).toBe(200);

  expect(s.telegram.sent).toEqual([{ chatId: STRANGER.id, text: privateBot(STRANGER.id), html: false }]);
  expect(s.runtime.dispatched).toEqual([]);
});

test("a request to Telegram times out with a timer cleared once it settles, so no timer holds the object afterwards", async () => {
  let given: AbortSignal | undefined;
  expect(await within(20, undefined, async (signal) => ((given = signal), "sent"))).toBe("sent");
  await Bun.sleep(40);
  expect(given?.aborted).toBe(false);

  const slow = within(20, undefined, (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
  expect(await slow.catch((error: unknown) => (error as Error).name)).toBe("TimeoutError");

  const stop = new AbortController();
  const stopped = within(60_000, stop.signal, (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
  stop.abort(new Error("stopping"));
  expect(await stopped.catch((error: unknown) => (error as Error).message)).toBe("stopping");
});
