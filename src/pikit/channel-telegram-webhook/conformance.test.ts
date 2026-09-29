/**
 * channel-telegram-webhook against the channel conformance suite (`@pikit/contracts/testing`): what
 * every channel does with a message. The suite brings the runtime, the conversation registry, a router
 * and stages that halt, deny or move messages; this fixture speaks Telegram by webhook through
 * `fake-telegram.test-support.ts`, with both halves in one App (a mailbox, wakeups, storage.kv and
 * agent.submissions from the in-memory doubles). Each of the suite's conversations is an allowed
 * user's private chat; delivering an id again is Telegram posting the same update again.
 *
 * The suite's runtime answers by events only, and this channel delivers from `agent.submissions`'
 * feed: `recorder` writes each run's end there, as runtime-pi does. It is listed before the channel,
 * so the answer is in the feed when the channel's listener asks for the delivery.
 */

import { test } from "bun:test";
import { type AgentResult } from "@pikit/contracts";
import { type AppContext, BACKGROUND_CONTEXT, defineComponent } from "@pikit/core";
import { createChannelConformance, createMemoryKeyValueStorage, createMemoryMailbox, createMemorySubmissions, createMemoryWakeups } from "@pikit/contracts/testing";
import type { TelegramUpdate } from "./api.ts";
import { afterDeploy } from "./deploy.ts";
import { startFakeTelegram } from "./fake-telegram.test-support.ts";
import channelTelegramWebhook, { NAME, worker, WORKER_NAME } from "./index.ts";

const SECRET = "conformance-webhook-secret-0123";

for (const c of createChannelConformance(({ conversations }) => {
  const telegram = startFakeTelegram();
  const users = new Map(conversations.map((conversation, i) => [conversation, { id: 3001 + i, first_name: conversation }]));
  const user = (conversation: string) => {
    const found = users.get(conversation);
    if (found === undefined) throw new Error(`no user for the conversation "${conversation}"`);
    return found;
  };
  const secrets: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: telegram.token,
    TELEGRAM_ALLOWED_USERS: [...users.values()].map((u) => u.id).join(","),
    TELEGRAM_WEBHOOK_SECRET: SECRET,
  };
  const { submissions } = createMemorySubmissions();
  const recorder = defineComponent({
    name: "recorder-test",
    setup(pikit) {
      pikit.use("agent.submissions");
      const record = async ({ conversation, requestId, requestIds, kind, text, error }: AgentResult, ctx: AppContext) =>
        submissions.settled({ conversation, requestId, requestIds, kind, ...(text !== undefined && { text }), ...(error !== undefined && { error }) }, ctx);
      pikit.on("agent.settled", record);
      pikit.on("agent.failed", record);
    },
  });
  let url = "";
  const server = defineComponent({
    name: "server-test",
    setup(pikit) {
      const routes = pikit.useKeyed("http.route");
      let serving: ReturnType<typeof Bun.serve> | undefined;
      return {
        async start(ctx) {
          const background = ctx.derive(() => BACKGROUND_CONTEXT);
          serving = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: async (request) => (await routes.get(`${request.method} ${new URL(request.url).pathname}`)?.(request, background)) ?? new Response(null, { status: 404 }),
          });
          url = `http://127.0.0.1:${serving.port}`;
        },
        stop: () => serving?.stop(true),
      };
    },
  });
  const posted = new Map<string, TelegramUpdate>();
  return {
    components: [
      defineComponent({ name: "secrets-test", setup: (pikit) => pikit.provide("secrets", { get: async (name) => secrets[name] }) }),
      defineComponent({ name: "submissions-test", setup: (pikit) => pikit.provide("agent.submissions", submissions) }),
      defineComponent({ name: "kv-test", setup: (pikit) => pikit.provide("storage.kv", createMemoryKeyValueStorage()) }),
      createMemoryWakeups(),
      recorder,
      channelTelegramWebhook,
      createMemoryMailbox(),
      worker,
      server,
    ],
    config: { [NAME]: { apiBase: telegram.url }, [WORKER_NAME]: { apiBase: telegram.url } },
    async deliver({ id, conversation, text }) {
      if (telegram.webhookUrl === "") {
        const problems = await afterDeploy({ url, config: { apiBase: telegram.url }, get: (name) => secrets[name], say: () => {} });
        if (problems.length > 0) throw new Error(problems.join("; "));
      }
      const update = posted.get(id) ?? telegram.message(user(conversation), text);
      posted.set(id, update);
      await telegram.post(update);
    },
    told: (conversation) => telegram.sent.filter((m) => m.chatId === user(conversation).id).map((m) => m.text),
    dispose: () => telegram.stop(),
  };
})) {
  test(`${c.group}: ${c.name}`, () => c.run(), 15_000);
}
