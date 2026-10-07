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
 *     it resolves once the message is durable, and asks for "typing…" and for delivery;
 *   - the `actor.inbox` handler of `telegram.stranger` (`login.ts`), for a bot that takes logins:
 *     a chat that logged in is handled as above, `/login <password>` logs it in, anyone else is told;
 *   - its answers, delivered by `startAnswerDelivery` (`@pikit/contracts`) from `agent.submissions`'
 *     feed, with a cursor in `storage.kv`, by the wakeup `channel-telegram-webhook.answers` in slices
 *     (C4); with `outbound.queue` installed, enqueued instead of sent. The channel gives it its bots'
 *     transports, which bot a conversation is, its words (`replyText`) and its waits (`DELIVERY`);
 *   - "typing…" while a message waits for its run: the wakeup `channel-telegram-webhook.typing`
 *     (`typing.ts`).
 *
 * Delivery runs at every start, whenever a message arrives, and whenever a run of one of its
 * conversations ends (`agent.settled`, `agent.failed`): an answer that ended while nothing ran is
 * delivered at the next run (K6).
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
import { type AgentResult, type AnswerDelivery, type DeliveryPolicy, type RunSettlement, startAnswerDelivery } from "@pikit/contracts";
import Type from "typebox";
import { ACCOUNT_NAME, accountsOf } from "./account.ts";
import { registerInbox } from "./actor-inbox.ts";
import { createTelegramApi } from "./api.ts";
import { type Bot, createBot, findBot, TELEGRAM_TIMEOUT_MS } from "./bot.ts";
import { handleMessage, type InboxOutcome } from "./inbox.ts";
import { handleStranger, type Password, passwordOf, readPassword } from "./login.ts";
import { startTyping, type Typing } from "./typing.ts";
import { isPrivateMessage, type PrivateUpdate, readUpdate, STRANGER_TYPE, UPDATE_TYPE } from "./update.ts";

export { SETUP_ROUTE, worker, WORKER_NAME } from "./worker.ts";
export { TYPING } from "./typing.ts";
export { STRANGER_TYPE, UPDATE_TYPE } from "./update.ts";

export const NAME = "channel-telegram-webhook";

const Config = Type.Object({
  /** The Bot API server. A value, for a local Bot API server or a test double. */
  apiBase: Type.String({ minLength: 1, default: "https://api.telegram.org" }),
  /** More bots, by name, besides the default one: `["ops"]` runs `telegram:ops` with `TELEGRAM_OPS_BOT_TOKEN`. */
  accounts: Type.Array(Type.String({ pattern: ACCOUNT_NAME }), { default: [], uniqueItems: true }),
});

/**
 * How answers are delivered (`startAnswerDelivery`): an answer that failed is tried again after 1 s,
 * 5 s, 30 s, then every minute (or after Telegram's `retry_after`), and logged as an error from its
 * 3rd failure in a row; a run sends at most 20 pieces (every send is a subrequest, and an invocation
 * has few, C4); a send Telegram has not answered after 30 s may have reached it.
 */
const DELIVERY: DeliveryPolicy = { retryMs: [1_000, 5_000, 30_000, 60_000], blockedAfter: 3, window: 200, piecesPerRun: 20, sendTimeoutMs: TELEGRAM_TIMEOUT_MS };

interface Running {
  bots: Bot[];
  /** Each bot's password, by instance; absent when none is set. */
  passwords: Map<string, Password>;
  delivery: AnswerDelivery;
  typing: Typing;
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
    // Optional: with it, answers are stored before they are sent (@pikit/contracts' outbound.ts).
    const outbound = pikit.useOptional("outbound.queue");
    const accounts = accountsOf(config.accounts);
    let running: Running | undefined;

    /**
     * One update the Worker sent, checked (the mailbox carries JSON), handled by `handle`. Once it is
     * durable in the conversation, "typing…" shows and its answer is delivered when its run ends (a
     * duplicate's too, if still due).
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
        if ((await handle(update, found.bot, now, ctx)) === "dispatched") {
          await now.typing.kick(ctx);
          await now.delivery.wake(ctx);
        }
      };
    const depsOf = (bot: Bot) => ({ bot, conversations: conversations.get(), runtime: runtime.get(), store: storage.get().namespace(NAME) });

    // Registered with actor.inbox in start (`actor-inbox.ts`): the mailbox depends on no handler.
    const inbox = registerInbox(
      pikit,
      UPDATE_TYPE,
      receive((update, bot, _now, ctx) => handleMessage(update.message, depsOf(bot), ctx)),
    );
    // Someone the Worker does not list, of a bot that takes logins: the logins are kept here.
    const strangers = registerInbox(
      pikit,
      STRANGER_TYPE,
      receive((update, bot, now, ctx) => handleStranger(update.message, { ...depsOf(bot), password: now.passwords.get(bot.account.instance) }, ctx)),
    );

    const ended = async (result: AgentResult, ctx: AppContext): Promise<void> => {
      const now = running;
      if (now === undefined || findBot(now.bots, result.conversation.key) === undefined) return;
      await now.delivery.wake(ctx).catch((error: unknown) =>
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
        const passwords = new Map<string, Password>();
        for (const account of accounts) {
          const token = await secrets.get().get(account.tokenSecret);
          if (token === undefined) throw new Error(`channel-telegram-webhook: ${account.tokenSecret} is not set. Create a bot with @BotFather, then run \`pikit configure\``);
          bots.push(createBot(account, createTelegramApi(token, config.apiBase)));
          const password = await passwordOf(await readPassword(account, (name) => secrets.get().get(name)));
          if (password !== undefined) passwords.set(account.instance, password);
        }
        // Whatever ended while nothing ran (a restart, an eviction, a deploy) is delivered from now on.
        const delivery = await startAnswerDelivery(ctx, {
          name: NAME,
          answers: submissions.get().answers,
          store: storage.get().namespace(NAME),
          transports: new Map(bots.map((bot) => [bot.account.instance, bot.transport])),
          route: (key) => findBot(bots, key)?.bot.account.instance,
          text: replyText,
          queue: outbound.get(),
          wakeups: wakeups.get(),
          policy: DELIVERY,
        });
        try {
          const typing = startTyping(bots, submissions.get(), wakeups.get());
          running = { bots, passwords, delivery, typing };
          inbox.start();
          strangers.start();
        } catch (error) {
          running = undefined;
          await delivery.stop(ctx.abortSignal);
          throw error;
        }
      },

      async stop(ctx) {
        const stopping = running;
        running = undefined;
        // A send in flight is cut, and its piece stays `sending`: sent again, marked, at the next start.
        await stopping?.delivery.stop(ctx.abortSignal);
      },
    };
  },
});

/**
 * What the chat is told about a run: its answer, or that it failed. Nothing for an aborted or empty
 * one. A message the runtime abandoned is never answered: the user is asked to send it again.
 * (channel-telegram's words, so a chat reads the same on both targets.)
 */
export function replyText(answer: Pick<RunSettlement, "kind" | "text" | "error">): string | undefined {
  if (answer.kind === "failed" && answer.error?.code === "abandoned") return "Sorry, we could not answer your message. Please send it again.";
  if (answer.kind === "failed") return `Sorry, something went wrong while answering (${answer.error?.code ?? "error"}). Try again in a moment.`;
  if (answer.kind === "completed" && (answer.text ?? "").trim() !== "") return answer.text;
  return undefined;
}
