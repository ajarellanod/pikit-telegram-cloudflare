/**
 * channel-telegram-webhook against the channel conformance suite (`@pikit/contracts/testing`): what
 * every channel does with a message, and how its answers survive what happens to the process. The
 * suite brings the runtime, the conversation registry, `agent.submissions`, `storage.kv`, `wakeups`,
 * a router and stages that halt, deny or move messages; this fixture speaks Telegram by webhook
 * through `fake-telegram.test-support.ts`, with both halves in one App (and the in-memory mailbox).
 * Each of the suite's conversations is an allowed user's private chat; delivering an id again is
 * Telegram posting the same update again, as it does by itself while the webhook answers 5xx. The platform fails a chat's sends with a 502, or takes one
 * and never answers; a piece sent again as a possible duplicate starts with `↻ `.
 */

import { test } from "bun:test";
import { BACKGROUND_CONTEXT, defineComponent } from "@pikit/core";
import { createChannelConformance, createMemoryMailbox } from "@pikit/contracts/testing";
import type { TelegramUpdate } from "./api.ts";
import { afterDeploy } from "./deploy.ts";
import { startFakeTelegram } from "./fake-telegram.test-support.ts";
import channelTelegramWebhook, { NAME, worker, WORKER_NAME } from "./index.ts";
import { POSSIBLE_DUPLICATE_MARK } from "./transport.ts";

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
  let disposed = false;
  /** Posts `update` as Telegram does: again, a moment later, while the webhook answers 5xx (or does not answer). */
  const postUntilTaken = async (update: TelegramUpdate): Promise<void> => {
    while (!disposed) {
      await Bun.sleep(100);
      const status = await telegram.post(update).catch(() => 0);
      if (status > 0 && status < 500) return;
    }
  };
  const told = (conversation: string) => telegram.sent.filter((m) => m.chatId === user(conversation).id).map((m) => m.text);
  return {
    components: [
      defineComponent({ name: "secrets-test", setup: (pikit) => pikit.provide("secrets", { get: async (name) => secrets[name] }) }),
      channelTelegramWebhook,
      createMemoryMailbox(),
      worker,
      server,
    ],
    config: { [NAME]: { apiBase: telegram.url }, [WORKER_NAME]: { apiBase: telegram.url } },
    async deliver({ id, conversation, text }) {
      // What `pikit up` does once a deploy answers: a restarted App serves on another port.
      if (!telegram.webhookUrl.startsWith(url)) {
        const problems = await afterDeploy({ url, config: { apiBase: telegram.url }, get: (name) => secrets[name], say: () => {} });
        if (problems.length > 0) throw new Error(problems.join("; "));
      }
      const update = posted.get(id) ?? telegram.message(user(conversation), text);
      posted.set(id, update);
      const status = await telegram.post(update);
      if (status >= 500) void postUntilTaken(update);
    },
    told,
    platform: {
      fail: (conversation, count) => void telegram.failChat.set(user(conversation).id, count),
      hang: (conversation) => void telegram.hangChat.add(user(conversation).id),
      received: (conversation) => told(conversation).map((text) => ({ text, possibleDuplicate: text.startsWith(POSSIBLE_DUPLICATE_MARK) })),
    },
    dispose: async () => {
      disposed = true;
      await telegram.stop();
    },
  };
}, { resetCommand: "/new" })) {
  test(`${c.group}: ${c.name}`, () => c.run(), 15_000);
}
