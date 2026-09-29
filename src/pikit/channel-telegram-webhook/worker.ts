/**
 * The Worker's half of channel-telegram-webhook (SPEC §4.1, C1, C6): where Telegram posts each update.
 * It checks and routes; the conversation's actor (the object's half, `index.ts`) does the rest.
 *
 *   POST /telegram           the default bot
 *   POST /telegram/<name>    each bot of `accounts`
 *   GET  /telegram/setup     registers every bot's webhook here (`webhook.ts`)
 *
 * For each request:
 * 1. **The secret.** Telegram sends the webhook's secret (`TELEGRAM_[<NAME>_]WEBHOOK_SECRET`, given to
 *    `setWebhook` after a deploy) in `X-Telegram-Bot-Api-Secret-Token`; anything else is `401`
 *    (`secret.ts`: compared in constant time).
 * 2. **What this channel handles**: a message with text from a person in a private chat. Anything
 *    else (a group, a bot, an edit) is acknowledged with `200` and dropped, as channel-telegram does.
 * 3. **Who may talk**: the ids in `TELEGRAM_[<NAME>_]ALLOWED_USERS`. A stranger is told their id, so
 *    the owner can add it, and nothing reaches the agent. A message with no text gets a hint.
 *    When the bot can be claimed (`TELEGRAM_[<NAME>_]CLAIM_CODE` is set, or nobody is listed), the
 *    Worker decides nothing about strangers: it hands their updates to their chat's actor as
 *    `telegram.stranger`, which keeps the claims and answers them (`claim.ts`).
 * 4. **The actor**: `actor.mailbox.send("<instance>:<chat>", "telegram.update", update)`. It resolves
 *    once the conversation holds the message durably, and the Worker answers `200`; if it rejects, `500`,
 *    and Telegram delivers the update again (the object recognises it: answered once).
 *
 * The webhook registers itself (`webhook.ts`): on Cloudflare, when the Worker's App starts (once per
 * isolate, on its first request, `/health` included), it checks Telegram has this Worker's URL and
 * sets it if not; `GET /telegram/setup` always sets it. No auth: either one only points the bot at the
 * Worker that answers, with that Worker's own secret, and says nothing secret. A stranger calling it
 * costs at most three subrequests, and cannot choose the URL (the Worker's origin) nor the secret.
 *
 * It answers as soon as the message is durable, never after the run: Telegram does not publish how
 * long it waits for a webhook, and the run takes as long as the agent does.
 *
 * On Cloudflare this component goes in the Worker's App (`export const worker` of pikit.config.ts),
 * with `secrets` and `actor.mailbox`; `component.json` names it in `apps.worker`. On a server both
 * halves can share one App (`mailbox-local` delivers to the object's half in the same process).
 */

import { type AppContext, defineComponent } from "@pikit/core";
import { type JsonValue, WORKERS_HOST, type WorkersHost } from "@pikit/contracts";
import Type from "typebox";
import { type Account, ACCOUNT_NAME, accountsOf, conversationKeyOf } from "./account.ts";
import { createTelegramApi, parseAllowedUsers, type TelegramApi } from "./api.ts";
import { TELEGRAM_TIMEOUT_MS, within } from "./bot.ts";
import { strangerText } from "./claim.ts";
import { NO_TEXT } from "./inbox.ts";
import { claimCodeProblem, type Digest, digest, matches, SECRET_HEADER, secretProblem } from "./secret.ts";
import { isPrivateMessage, readUpdate, STRANGER_TYPE, textOf, UPDATE_TYPE } from "./update.ts";
import { type Registration, registerWebhook } from "./webhook.ts";

export const WORKER_NAME = "channel-telegram-webhook-worker";
/** Where a person, a build or a script registers every bot's webhook at this Worker. */
export const SETUP_ROUTE = "GET /telegram/setup";

const WorkerConfig = Type.Object({
  /** The Bot API server, for the replies to strangers. A value, for a local Bot API server or a test double. */
  apiBase: Type.String({ minLength: 1, default: "https://api.telegram.org" }),
  /** More bots, by name, besides the default one; the same list as the object half's `accounts`. */
  accounts: Type.Array(Type.String({ pattern: ACCOUNT_NAME }), { default: [], uniqueItems: true }),
});

/** Strangers told their id, per bot, remembered while the Worker's isolate lives; at most this many. */
const STRANGERS_REMEMBERED = 1_000;

/** One bot's webhook, ready. */
interface Endpoint {
  account: Account;
  secret: Digest;
  /** The secret itself, which `setWebhook` gives Telegram. */
  secretToken: string;
  allowed: ReadonlySet<number>;
  /** Whether `TELEGRAM_[<NAME>_]CLAIM_CODE` is set (the object's half compares it). */
  claimCode: boolean;
  /** A claim code is set, or nobody is listed: strangers go to their chat's actor, which keeps the claims. */
  claimable: boolean;
  api: TelegramApi;
  told: Set<number>;
}

/** The version Cloudflare runs (`version_metadata`, as deployment-cloudflare's `/health` reports it). */
const versionOf = (host: WorkersHost | undefined): string | null => {
  const id = (host?.env.CF_VERSION_METADATA as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : null;
};

const ok = (): Response => new Response(null, { status: 200 });
const status = (code: number, text: string): Response => new Response(text, { status: code });

export const worker = defineComponent({
  name: WORKER_NAME,
  config: WorkerConfig,
  setup(pikit, config) {
    const secrets = pikit.use("secrets");
    const mailbox = pikit.use("actor.mailbox");
    const accounts = accountsOf(config.accounts);
    let endpoints: Map<string, Endpoint> | undefined;
    let version: string | null = null;

    /** Registers every bot's webhook at `origin`, one after the other; never throws. */
    const registerAll = async (ready: Map<string, Endpoint>, origin: string, force: boolean, signal: AbortSignal | undefined): Promise<Registration[]> => {
      const done: Registration[] = [];
      for (const endpoint of ready.values()) done.push(await registerWebhook(endpoint.api, endpoint.account, { origin, secretToken: endpoint.secretToken, force, signal }));
      return done;
    };

    const setup = async (request: Request, ctx: AppContext): Promise<Response> => {
      const ready = endpoints;
      if (ready === undefined) return status(503, "not running");
      const bots = await registerAll(ready, new URL(request.url).origin, true, ctx.abortSignal);
      for (const bot of bots) {
        if (bot.ok) ctx.logger.info("channel-telegram-webhook: webhook registered", { bot: bot.bot, webhook: bot.webhook, version });
        else ctx.logger.warn("channel-telegram-webhook: the webhook could not be registered", { bot: bot.bot, problem: bot.problem });
      }
      const ok = bots.every((bot) => bot.ok);
      return Response.json(
        { ok, version, bots: bots.map(({ bot, webhook, ok, problem }) => ({ bot, webhook, ok, ...(problem !== undefined && { problem }) })) },
        { status: ok ? 200 : 502, headers: { "cache-control": "no-store" } },
      );
    };

    /** Tells a chat something, once, best effort: the update is acknowledged whatever happens. */
    const tell = async (endpoint: Endpoint, chatId: number, text: string, ctx: AppContext): Promise<void> => {
      await endpoint.api.sendMessage(chatId, text, {}, within(TELEGRAM_TIMEOUT_MS, ctx.abortSignal)).catch((error: unknown) =>
        ctx.logger.warn("channel-telegram-webhook: a reply could not be sent", { chat: chatId, error: String(error) }),
      );
    };

    const receive = async (account: Account, request: Request, ctx: AppContext): Promise<Response> => {
      const endpoint = endpoints?.get(account.instance);
      if (endpoint === undefined) return status(503, "not running");
      if (!(await matches(request.headers.get(SECRET_HEADER), endpoint.secret))) return status(401, "unauthorized");
      const update = readUpdate(await request.json().catch(() => undefined));
      if (update === undefined) return status(400, "not a Telegram update");
      if (!isPrivateMessage(update)) return ok();
      const { message } = update;
      const chatId = message.chat.id;
      const allowed = endpoint.allowed.has(message.from.id);

      if (!allowed && !endpoint.claimable) {
        ctx.logger.warn("channel-telegram-webhook: a message from a user who is not allowed", { instance: account.instance, user: message.from.id });
        if (!endpoint.told.has(message.from.id)) {
          if (endpoint.told.size >= STRANGERS_REMEMBERED) endpoint.told.clear();
          endpoint.told.add(message.from.id);
          await tell(endpoint, chatId, strangerText(account, message.from.id, false), ctx);
        }
        return ok();
      }
      if (allowed && textOf(message) === undefined) {
        await tell(endpoint, chatId, NO_TEXT, ctx);
        return ok();
      }

      try {
        // Someone not listed, of a bot that can be claimed: their chat's actor decides (claim.ts).
        await mailbox.get().send(conversationKeyOf(account.instance, chatId), allowed ? UPDATE_TYPE : STRANGER_TYPE, update as unknown as JsonValue, ctx);
      } catch (error) {
        // Not acknowledged: Telegram delivers it again, and the conversation recognises it.
        ctx.logger.error("channel-telegram-webhook: the conversation could not take an update; Telegram will deliver it again", {
          instance: account.instance,
          update: update.update_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return status(500, "not taken");
      }
      return ok();
    };

    for (const account of accounts) pikit.provideKeyed("http.route", `POST ${account.path}`, (request, ctx) => receive(account, request, ctx));
    pikit.provideKeyed("http.route", SETUP_ROUTE, setup);

    return {
      async start(ctx) {
        const ready = new Map<string, Endpoint>();
        for (const account of accounts) {
          const endpoint = await endpointOf(account);
          if (endpoint.allowed.size === 0 && !endpoint.claimCode) {
            ctx.logger.warn(`channel-telegram-webhook: nobody is in ${account.allowedSecret} and ${account.claimSecret} is not set: only chats that claimed the bot before can talk to it`, {
              instance: account.instance,
            });
          }
          ready.set(account.instance, endpoint);
        }
        const host = ctx.value(WORKERS_HOST);
        version = versionOf(host);
        endpoints = ready;
        // On Cloudflare, once per isolate (so once per version in each): the webhook this Worker wants,
        // set only if Telegram has another. Telegram posts only to HTTPS, so `wrangler dev` never asks.
        if (host?.origin?.startsWith("https://")) {
          for (const bot of await registerAll(ready, host.origin, false, ctx.abortSignal)) {
            if (!bot.ok) {
              ctx.logger.warn(`channel-telegram-webhook: the webhook could not be registered; open ${host.origin}/telegram/setup to try again`, { bot: bot.bot, problem: bot.problem, version });
            } else if (bot.set) ctx.logger.info("channel-telegram-webhook: webhook registered", { bot: bot.bot, webhook: bot.webhook, version });
          }
        }
      },
      stop() {
        endpoints = undefined;
      },
    };

    /** One bot's webhook from its secrets; a missing or unusable one fails the start (P5). */
    async function endpointOf(account: Account): Promise<Endpoint> {
      const store = secrets.get();
      const token = await store.get(account.tokenSecret);
      if (token === undefined) throw new Error(`channel-telegram-webhook: ${account.tokenSecret} is not set. Create a bot with @BotFather, then run \`pikit configure\``);
      const allowed = parseAllowedUsers(await store.get(account.allowedSecret));
      if (allowed instanceof Error) throw new Error(`channel-telegram-webhook: ${allowed.message.replace("TELEGRAM_ALLOWED_USERS", account.allowedSecret)}`);
      const claimCode = (await store.get(account.claimSecret))?.trim() ?? "";
      const claimProblem = claimCode === "" ? undefined : claimCodeProblem(claimCode);
      if (claimProblem !== undefined) throw new Error(`channel-telegram-webhook: ${account.claimSecret} is not usable: ${claimProblem}. Choose a longer passphrase, or remove it`);
      const secret = await store.get(account.webhookSecret);
      if (secret === undefined) throw new Error(`channel-telegram-webhook: ${account.webhookSecret} is not set. Run \`pikit configure\`: it generates one`);
      const problem = secretProblem(secret);
      if (problem !== undefined) throw new Error(`channel-telegram-webhook: ${account.webhookSecret} is not usable: ${problem}. Run \`pikit configure\` to generate one`);
      return {
        account,
        secret: await digest(secret),
        secretToken: secret,
        allowed,
        claimCode: claimCode !== "",
        // Nobody listed: a claim made before the claim code was removed keeps working (claim.ts).
        claimable: claimCode !== "" || allowed.size === 0,
        api: createTelegramApi(token, config.apiBase),
        told: new Set(),
      };
    }
  },
});
