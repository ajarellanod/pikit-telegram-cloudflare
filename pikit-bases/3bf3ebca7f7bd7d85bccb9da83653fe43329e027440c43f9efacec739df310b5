/**
 * The bots this channel runs. Each Telegram bot is an
 * account, and each account a channel instance with its own token, allowed users, webhook secret,
 * password, webhook path, conversations and transport:
 *
 * | Account | Instance | Token | Allowed users | Webhook secret | Password | Path |
 * |---|---|---|---|---|---|---|
 * | the default one | `telegram` | `TELEGRAM_BOT_TOKEN` | `TELEGRAM_ALLOWED_USERS` | `TELEGRAM_WEBHOOK_SECRET` | `TELEGRAM_PASSWORD` | `/telegram` |
 * | `ops` (in `accounts`) | `telegram:ops` | `TELEGRAM_OPS_BOT_TOKEN` | `TELEGRAM_OPS_ALLOWED_USERS` | `TELEGRAM_OPS_WEBHOOK_SECRET` | `TELEGRAM_OPS_PASSWORD` | `/telegram/ops` |
 *
 * A conversation key is `<instance>:<chat id>`: `telegram:12345`, `telegram:ops:12345`, the same keys
 * channel-telegram makes, so a project that moves from polling to the webhook keeps its conversations.
 * The key is also the actor's: the Worker sends each update to it (`actor.mailbox`).
 *
 * Copied from channel-telegram's `account.ts` (components never import each other, C6), with the
 * webhook's secret, the password and the path added.
 */

export const KIND = "telegram";

export interface Account {
  /** `undefined` for the default account. */
  name: string | undefined;
  /** The channel instance: `telegram` or `telegram:<name>`. */
  instance: string;
  tokenSecret: string;
  allowedSecret: string;
  /** The secret Telegram sends with every update of this bot (`X-Telegram-Bot-Api-Secret-Token`). */
  webhookSecret: string;
  /** The password a private chat sends with `/login` to be allowed (`login.ts`); optional. */
  passwordSecret: string;
  /** Where Telegram posts this bot's updates: `/telegram` or `/telegram/<name>`. */
  path: string;
}

/** An account name: lowercase letters, digits and `-`, starting with a letter. */
export const ACCOUNT_NAME = "^[a-z][a-z0-9-]*$";

/** The default account, then one per name in `accounts`, in order. */
export function accountsOf(names: readonly string[]): Account[] {
  return [undefined, ...names].map((name) => {
    const infix = name === undefined ? "" : `${name.toUpperCase().replaceAll("-", "_")}_`;
    return {
      name,
      instance: name === undefined ? KIND : `${KIND}:${name}`,
      tokenSecret: `TELEGRAM_${infix}BOT_TOKEN`,
      allowedSecret: `TELEGRAM_${infix}ALLOWED_USERS`,
      webhookSecret: `TELEGRAM_${infix}WEBHOOK_SECRET`,
      passwordSecret: `TELEGRAM_${infix}PASSWORD`,
      path: name === undefined ? `/${KIND}` : `/${KIND}/${name}`,
    };
  });
}

/** The conversation of a chat with `instance`'s bot. */
export const conversationKeyOf = (instance: string, chatId: number): string => `${instance}:${chatId}`;

/** The chat of a conversation `instance` made, or `undefined` for any other (another account's too). */
export function chatIn(instance: string, conversationKey: string): number | undefined {
  if (!conversationKey.startsWith(`${instance}:`)) return undefined;
  const rest = conversationKey.slice(instance.length + 1);
  return /^-?\d+$/.test(rest) ? Number(rest) : undefined;
}
