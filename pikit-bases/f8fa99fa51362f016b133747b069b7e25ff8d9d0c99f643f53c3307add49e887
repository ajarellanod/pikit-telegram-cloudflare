/**
 * channel-telegram-webhook: talk to your agents in Telegram, by webhook, on Cloudflare (SPEC §4.1, C6).
 *
 * Two halves, one per App (C1):
 * - **The Worker's half** (`worker.ts`, the export `worker`, named in `component.json`'s `apps`):
 *   the route Telegram posts to, the secret it echoes, the allowed users, and `actor.mailbox`, which
 *   hands each update to the conversation's actor.
 * - **The object's half** (this file, the default export), in the actor that owns the conversation
 *   (on Cloudflare, the Durable Object `idFromName("telegram:<chat>")`):
 *   - the `actor.inbox` handler of `telegram.update` (`inbox.ts`): the commands, then `admitInbound`;
 *     it resolves once the message is durable, and asks for the delivery wakeup;
 *   - the `actor.inbox` handler of `telegram.stranger` (`claim.ts`), for a bot that can be claimed:
 *     a chat that claimed it is handled as above, `/claim <code>` claims it, anyone else is told;
 *   - the wakeup `channel-telegram-webhook.deliver` (`delivery.ts`), registered with `wakeups.handle`
 *     at start: the answers from `agent.submissions`' feed, from a cursor in `storage.kv`, "typing…"
 *     while a message waits for its run, and a new request while work remains. With `outbound.queue`
 *     installed, answers are enqueued instead of sent.
 *
 * It asks for the wakeup at every start, whenever a message arrives, and whenever a run of one of its
 * conversations ends (`agent.settled`, `agent.failed`): an answer that ended while no wakeup ran is
 * delivered at the next one (K6).
 *
 * It reuses channel-telegram's client, format, transport and accounts as copies of its own
 * (`api.ts`, `format.ts`, `transport.ts`, `account.ts`): components never import each other.
 * `configure.ts` is its step of `pikit configure`; `deploy.ts` registers the webhook once a deploy
 * answers (C8), and without `pikit up` the Worker registers it itself (`webhook.ts`).
 *
 * It refuses to start when a bot has no token. It does not call Telegram to start: on Cloudflare every
 * object runs this start, and each call is a subrequest.
 */

import { type AppContext, defineComponent } from "@pikit/core";
import type { AgentResult, OutboundQueue } from "@pikit/contracts";
import Type from "typebox";
import { ACCOUNT_NAME, accountsOf } from "./account.ts";
import { registerInbox } from "./actor-inbox.ts";
import { createTelegramApi } from "./api.ts";
import { type Bot, createBot, findBot } from "./bot.ts";
import { type ClaimCode, claimCodeOf, handleStranger } from "./claim.ts";
import { createDelivery, DELIVER, type Delivery, openCursors } from "./delivery.ts";
import { handleMessage, type InboxOutcome } from "./inbox.ts";
import { isPrivateMessage, type PrivateUpdate, readUpdate, STRANGER_TYPE, UPDATE_TYPE } from "./update.ts";

export { SETUP_ROUTE, worker, WORKER_NAME } from "./worker.ts";
export { DELIVER } from "./delivery.ts";
export { STRANGER_TYPE, UPDATE_TYPE } from "./update.ts";

export const NAME = "channel-telegram-webhook";

const Config = Type.Object({
  /** The Bot API server. A value, for a local Bot API server or a test double. */
  apiBase: Type.String({ minLength: 1, default: "https://api.telegram.org" }),
  /** More bots, by name, besides the default one: `["ops"]` runs `telegram:ops` with `TELEGRAM_OPS_BOT_TOKEN`. */
  accounts: Type.Array(Type.String({ pattern: ACCOUNT_NAME }), { default: [], uniqueItems: true }),
});

interface Running {
  bots: Bot[];
  /** Each bot's claim code, by instance; absent when none is set. */
  codes: Map<string, ClaimCode>;
  delivery: Delivery;
  queue: OutboundQueue | undefined;
}

export default defineComponent({
  name: NAME,
  config: Config,
  setup(pikit, config) {
    const secrets = pikit.use("secrets");
    const conversations = pikit.use("conversations.registry");
    const runtime = pikit.use("agent.runtime");
    // Answers come from the record of every run's end, from a cursor kept in storage.kv, and are
    // delivered by a wakeup: nothing waits for a run in memory, which an object would not keep.
    const submissions = pikit.use("agent.submissions");
    const storage = pikit.use("storage.kv");
    const wakeups = pikit.use("wakeups");
    // Optional: with it, answers are stored before they are sent (SPEC §5, "Outbound delivery").
    const outbound = pikit.useOptional("outbound.queue");
    const accounts = accountsOf(config.accounts);
    let running: Running | undefined;

    /**
     * One update the Worker sent, checked (the mailbox carries JSON), handled by `handle`. Once it is
     * durable in the conversation, its answer is delivered by the wakeup (a duplicate's too, if still due).
     */
    const receive =
      (handle: (update: PrivateUpdate, bot: Bot, now: Running, ctx: AppContext) => Promise<InboxOutcome>) =>
      async (key: string, message: unknown, ctx: AppContext): Promise<void> => {
        const now = running;
        if (now === undefined) throw new Error("channel-telegram-webhook: an update arrived while the channel is not running");
        const found = findBot(now.bots, key);
        if (found === undefined) {
          throw new Error(`channel-telegram-webhook: "${key}" is not a chat of a bot this channel runs (${accounts.map((a) => a.instance).join(", ")}); the Worker's and the object's accounts must be the same`);
        }
        const update = readUpdate(message);
        if (update === undefined || !isPrivateMessage(update) || update.message.chat.id !== found.chatId) {
          throw new Error(`channel-telegram-webhook: the message for "${key}" is not a private message of its chat`);
        }
        if ((await handle(update, found.bot, now, ctx)) === "dispatched") await now.delivery.kick(ctx);
      };
    const depsOf = (bot: Bot) => ({ bot, conversations: conversations.get(), runtime: runtime.get(), store: storage.get().namespace(NAME) });

    // Registered with actor.inbox in start (`actor-inbox.ts`): the mailbox depends on no handler.
    const inbox = registerInbox(
      pikit,
      UPDATE_TYPE,
      receive((update, bot, _now, ctx) => handleMessage(update.message, depsOf(bot), ctx)),
    );
    // Someone the Worker does not list, of a bot that can be claimed: the claims are kept here.
    const strangers = registerInbox(
      pikit,
      STRANGER_TYPE,
      receive((update, bot, now, ctx) => handleStranger(update.message, { ...depsOf(bot), code: now.codes.get(bot.account.instance) }, ctx)),
    );

    const ended = async (result: AgentResult, ctx: AppContext): Promise<void> => {
      const now = running;
      if (now === undefined || findBot(now.bots, result.conversation.key) === undefined) return;
      await now.delivery.kick(ctx).catch((error: unknown) =>
        ctx.logger.warn("channel-telegram-webhook: could not ask for the delivery of an answer; it is delivered at the next wakeup", {
          conversation: result.conversation.key,
          error: String(error),
        }),
      );
    };
    pikit.on("agent.settled", ended);
    pikit.on("agent.failed", ended);

    return {
      async start(ctx) {
        const bots: Bot[] = [];
        const codes = new Map<string, ClaimCode>();
        for (const account of accounts) {
          const token = await secrets.get().get(account.tokenSecret);
          if (token === undefined) throw new Error(`channel-telegram-webhook: ${account.tokenSecret} is not set. Create a bot with @BotFather, then run \`pikit configure\``);
          bots.push(createBot(account, createTelegramApi(token, config.apiBase)));
          const code = await claimCodeOf(await secrets.get().get(account.claimSecret));
          if (code !== undefined) codes.set(account.instance, code);
        }
        const store = storage.get().namespace(NAME);
        const recorded = submissions.get();
        const cursors = await openCursors(store, recorded.answers);
        const queue = outbound.get();
        const delivery = createDelivery({ bots, answers: recorded.answers, cursors, store, submissions: recorded, queue, wakeups: wakeups.get(), logger: ctx.logger });
        for (const bot of bots) queue?.attach(bot.account.instance, bot.transport);
        try {
          wakeups.get().handle(DELIVER, (run) => delivery.run(run));
          running = { bots, codes, delivery, queue };
          inbox.start();
          strangers.start();
          // Whatever ended while nothing ran (a restart, an eviction, a deploy) is delivered now.
          await wakeups.get().at(DELIVER, ctx.clock.now(), ctx);
        } catch (error) {
          running = undefined;
          for (const bot of bots) await queue?.detach(bot.account.instance, ctx.abortSignal);
          throw error;
        }
      },

      async stop(ctx) {
        const stopping = running;
        running = undefined;
        if (stopping === undefined) return;
        // The wakeup's handler is dropped with the App; a send it had in flight is cut, and its piece
        // stays `sending` (sent again, marked, at the next start).
        for (const bot of stopping.bots) await stopping.queue?.detach(bot.account.instance, ctx.abortSignal);
      },
    };
  },
});
