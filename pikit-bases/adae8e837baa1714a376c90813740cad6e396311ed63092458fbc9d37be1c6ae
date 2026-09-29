/**
 * One bot as the object's half uses it: its account, its client and its transport. The allowed users
 * and the webhook's secret are the Worker's (`worker.ts`): the object trusts what the Worker sends it.
 */

import type { ChannelTransport } from "@pikit/contracts";
import { type Account, chatIn } from "./account.ts";
import type { TelegramApi, TelegramUser } from "./api.ts";
import { createTelegramTransport } from "./transport.ts";

/** How long one request to Telegram may take before it counts as failed. */
export const TELEGRAM_TIMEOUT_MS = 30_000;

export interface Bot {
  account: Account;
  api: TelegramApi;
  transport: ChannelTransport;
  /** The bot's own user (`getMe`), asked once, when a command names a bot (`/new@some_bot`). */
  me(): Promise<TelegramUser>;
}

export function createBot(account: Account, api: TelegramApi): Bot {
  let me: Promise<TelegramUser> | undefined;
  return {
    account,
    api,
    transport: createTelegramTransport(api, account.instance),
    me() {
      me ??= api.getMe(AbortSignal.timeout(TELEGRAM_TIMEOUT_MS)).catch((error: unknown) => {
        me = undefined;
        throw error;
      });
      return me;
    },
  };
}

/** The bot and chat of a conversation this channel made, or `undefined` for another channel's. */
export function findBot(bots: readonly Bot[], key: string): { bot: Bot; chatId: number } | undefined {
  for (const bot of bots) {
    const chatId = chatIn(bot.account.instance, key);
    if (chatId !== undefined) return { bot, chatId };
  }
  return undefined;
}

/** `signal` and a timeout of `ms`, whichever ends first. */
export function within(ms: number, signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}
