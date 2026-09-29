/**
 * channel-telegram-webhook's step of `pikit configure`: everything a person needs to do, asked in
 * order, checked on the spot. The CLI finds this file in an installed component and calls
 * `configure(io)`; it knows nothing about Telegram (SPEC §11). Taken from channel-telegram's step
 * (components never import each other, C6), with the webhook's secret added:
 *
 * 1. The bot token. Without one, it explains @BotFather in three lines and asks for it; every token
 *    is checked with `getMe` at once, so a typo shows now and not after a deploy.
 * 2. The webhook's secret (`TELEGRAM_[<NAME>_]WEBHOOK_SECRET`): generated into `.env` when it is
 *    missing or unusable. Telegram sends it with every update, and the Worker refuses requests
 *    without it. Nobody types it: `deploy.ts` gives it to Telegram after the deploy.
 * 3. Who may talk to the bot. Instead of asking for a Telegram user id (which nobody knows), it asks
 *    you to send the bot any message and reads it with `getUpdates`, which works only while the bot
 *    has no webhook. On a bot that has one already (a deploy registered it), it offers to remove it:
 *    with nobody allowed, the Worker lets no message through to the agent (except from a chat that
 *    claimed the bot), and the next `pikit up` sets it again (as does the Worker, when a new isolate of
 *    it starts: then read the message again). You can also set `TELEGRAM_ALLOWED_USERS` yourself.
 * 4. A claim code (`TELEGRAM_[<NAME>_]CLAIM_CODE`), only if you set one: checked (8 characters at
 *    least) and saved to `.env`, so `pikit up` uploads it. With it, a private chat that sends
 *    `/claim <code>` may talk to the bot too (`claim.ts`). It is never asked for: the way the CLI
 *    allows you is step 3; the claim code is the "Deploy to Cloudflare" button's way.
 *
 * Without a terminal it asks nothing: the variables come from the environment (or `.env`), the token
 * is still checked, and a missing secret is still generated. It never prints the token or the secret.
 */

import { type Account, accountsOf } from "./account.ts";
import { botLink, createTelegramApi, parseAllowedUsers, type TelegramApi, TelegramError, type TelegramUser } from "./api.ts";
import { claimCodeProblem, generateSecret, secretProblem } from "./secret.ts";

/** What `pikit configure` gives a component's step. Structural, so this file imports nothing from the CLI. */
export interface ConfigureIO {
  /** A person answers at a terminal. False in scripts and CI: ask nothing. */
  interactive: boolean;
  /** This component's config in `pikit.config.ts`, as written there (defaults not applied). */
  config: Readonly<Record<string, unknown>>;
  /** A variable from `.env`, or exported in the environment. */
  get(name: string): string | undefined;
  /** Write a variable to `.env` (mode 0600) now; nothing happens when `.env` already has that value. */
  set(name: string, value: string): void;
  ask(question: string): Promise<string>;
  /** Asks without echoing the answer. */
  askSecret(question: string): Promise<string>;
  /** Yes or no, Enter giving `initialValue`. Optional: a CLI before it only has `ask`. */
  confirm?(message: string, initialValue: boolean): Promise<boolean>;
  say(line: string): void;
}

/** How long to wait for the first message to the bot. */
const WAIT_FOR_MESSAGE_SECONDS = 120;

/** The config's `apiBase` and `accounts`, as `pikit.config.ts` has them (defaults not applied). */
export function settingsOf(config: Readonly<Record<string, unknown>>): { apiBase: string; accounts: Account[] } {
  const apiBase = typeof config.apiBase === "string" ? config.apiBase : "https://api.telegram.org";
  const names = Array.isArray(config.accounts) ? config.accounts.filter((name): name is string => typeof name === "string") : [];
  return { apiBase, accounts: accountsOf(names) };
}

/** Configures the channel, one bot after the other; returns what is still missing (empty when done). */
export async function configure(io: ConfigureIO): Promise<string[]> {
  const { apiBase, accounts } = settingsOf(io.config);
  const missing: string[] = [];
  for (const account of accounts) {
    if (account.name !== undefined) io.say(`\nTelegram bot "${account.name}" (${account.instance}): ${account.tokenSecret}, ${account.allowedSecret}, ${account.webhookSecret}`);
    missing.push(...(await configureBot(io, apiBase, account)));
  }
  return missing;
}

/** One bot: its token, its webhook's secret, its claim code if it has one, then who may talk to it. */
async function configureBot(io: ConfigureIO, apiBase: string, account: Account): Promise<string[]> {
  const { tokenSecret } = account;
  const bot = await token(io, apiBase, tokenSecret);
  if (bot === undefined) return [`${tokenSecret}: create a bot with @BotFather and give its token to \`pikit configure\` (or set ${tokenSecret})`];
  webhookSecret(io, account);
  return [...claimCode(io, account), ...(await allowUsers(io, bot, account))];
}

/** The claim code, when one is given: checked, and saved to `.env`. Never asked for. */
function claimCode(io: ConfigureIO, account: Account): string[] {
  const name = account.claimSecret;
  const given = io.get(name)?.trim();
  if (given === undefined || given === "") return [];
  const problem = claimCodeProblem(given);
  if (problem !== undefined) {
    io.say(`\u2717 ${name} is not usable: ${problem}`);
    return [`${name}: choose a passphrase of at least 8 characters, or remove it`];
  }
  io.set(name, given);
  io.say(`  ${name}: set; a private chat that sends /claim followed by it may talk to the bot`);
  return [];
}

/** Who may talk to the bot: `TELEGRAM_[<NAME>_]ALLOWED_USERS`, or whoever messages it now. */
async function allowUsers(io: ConfigureIO, bot: { api: TelegramApi; me: TelegramUser }, account: Account): Promise<string[]> {
  const { allowedSecret } = account;
  const given = io.get(allowedSecret);
  const current = parseAllowedUsers(given);
  if (current instanceof Error) io.say(`✗ ${current.message}`);
  else if (current.size > 0 && given !== undefined) {
    // Saved to .env even when it came from the environment: the app reads .env.
    io.set(allowedSecret, given);
    io.say(`  ${allowedSecret}: ${current.size} user(s) allowed`);
    return [];
  }
  if (!io.interactive) return [`${allowedSecret}: set the Telegram user ids allowed to talk to the bot, or run \`pikit configure\` in a terminal`];
  if (!(await withoutWebhook(io, bot.api))) return [`${allowedSecret}: set the Telegram user ids allowed to talk to the bot in .env, or let \`pikit configure\` remove the webhook to read your message`];
  const allowed = await allow(io, bot.api, bot.me, allowedSecret);
  if (allowed === undefined) return [`${allowedSecret}: nobody is allowed to talk to the bot yet; run \`pikit configure\` again`];
  io.set(allowedSecret, allowed);
  io.say(`✓ ${allowedSecret} set: only they can talk to your agent (add more ids to that line in .env)`);
  return [];
}

/** The webhook's secret: kept when it is a good one, generated into `.env` otherwise. Never shown. */
function webhookSecret(io: ConfigureIO, account: Account): void {
  const name = account.webhookSecret;
  const given = io.get(name);
  const problem = given === undefined || given === "" ? undefined : secretProblem(given);
  if (given !== undefined && given !== "" && problem === undefined) {
    io.set(name, given);
    return;
  }
  io.set(name, generateSecret());
  io.say(
    problem === undefined
      ? `✓ ${name} generated: Telegram sends it with every update, and only requests with it reach your agent`
      : `✓ ${name} was not usable (${problem}): a new one is generated; the next \`pikit up\` gives it to Telegram`,
  );
}

/**
 * Whether the bot has no webhook, so `getUpdates` can read the first message; if it has one, a person
 * may remove it. With nobody allowed yet, the Worker lets no message through to the agent (only a chat
 * that claimed the bot), so the webhook serves no one.
 */
async function withoutWebhook(io: ConfigureIO, api: TelegramApi): Promise<boolean> {
  const { url } = await api.getWebhookInfo();
  if (url === "") return true;
  io.say(`\nThe bot has a webhook (${url}), so Telegram hands its messages to nobody else.`);
  const question = "Remove it while you send the bot a message? The next `pikit up` sets it again.";
  const remove = io.confirm ? await io.confirm(question, true) : /^(y|yes)?$/.test((await io.ask(`${question} [Y/n] `)).trim().toLowerCase());
  if (!remove) return false;
  await api.deleteWebhook();
  io.say("✓ Webhook removed until the next `pikit up`");
  return true;
}

/**
 * The bot token in what was pasted: BotFather's token is `<bot id>:<secret>`, and people paste it
 * with its message around it, quotes, or spaces. `undefined` when there is none.
 */
export function findToken(text: string): string | undefined {
  return /\d{3,}:[A-Za-z0-9_-]{10,}/.exec(text)?.[0];
}

/** A checked token, saved; or `undefined` when there is none. */
async function token(io: ConfigureIO, apiBase: string, tokenSecret: string): Promise<{ api: TelegramApi; me: TelegramUser } | undefined> {
  let value = io.get(tokenSecret);
  const saved = value !== undefined && value !== "";
  if (!saved && !io.interactive) return undefined;
  if (!saved) {
    io.say("\nTelegram: your agent needs a bot of its own.");
    io.say("  1. In Telegram, open https://t.me/BotFather and send /newbot");
    io.say("  2. Choose a name and a username ending in \"bot\"");
    io.say("  3. BotFather answers with a token like 123456789:AAE…; paste it here");
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    if (value === undefined || value === "") {
      const pasted = await io.askSecret(`${tokenSecret}: `);
      if (pasted.trim() === "") return undefined;
      value = findToken(pasted);
      if (value === undefined) {
        // Only the length is shown: what was pasted may be the token with something around it.
        io.say(`✗ That is not a bot token (${pasted.trim().length} characters, no 123456789:AAE… in them). Copy only the token from BotFather's message, then paste it again:`);
        continue;
      }
    } else {
      value = findToken(value) ?? value;
    }
    const api = createTelegramApi(value, apiBase);
    try {
      const me = await api.getMe();
      // Saved to .env even when it came from the environment: the app reads .env.
      io.set(tokenSecret, value);
      io.say(`✓ ${saved ? `${tokenSecret}: ` : ""}bot @${me.username ?? me.first_name} (${botLink(me)})`);
      return { api, me };
    } catch (error) {
      // 401: a token of the right shape that Telegram does not know. 404: not a token's shape at all.
      if (!(error instanceof TelegramError) || (error.code !== 401 && error.code !== 404)) throw error;
      io.say(`✗ Telegram does not know that token (${error.code}).${io.interactive ? " Paste it again:" : ""}`);
      if (!io.interactive) return undefined;
      value = undefined;
    }
  }
  return undefined;
}

/** The ids to allow, as `TELEGRAM_ALLOWED_USERS` holds them; `undefined` when nobody was allowed. */
async function allow(io: ConfigureIO, api: TelegramApi, bot: TelegramUser, allowedSecret: string): Promise<string | undefined> {
  io.say(`\nWho may talk to the bot? Open ${botLink(bot)} and send it any message now.`);
  io.say(`  (waiting up to ${WAIT_FOR_MESSAGE_SECONDS / 60} minutes; or press Ctrl-C and set ${allowedSecret} in .env yourself)`);
  const deadline = Date.now() + WAIT_FOR_MESSAGE_SECONDS * 1000;
  let offset: number | undefined;
  while (Date.now() < deadline) {
    let updates: Awaited<ReturnType<TelegramApi["getUpdates"]>>;
    try {
      updates = await api.getUpdates({ ...(offset !== undefined && { offset }), timeout: Math.min(25, Math.ceil((deadline - Date.now()) / 1000)) });
    } catch (error) {
      if (error instanceof TelegramError && error.code === 409) {
        io.say(
          error.message.includes("webhook")
            ? "✗ The bot has a webhook again, so Telegram does not hand its messages to anyone else. Run `pikit configure` again."
            : "✗ Another program is reading the bot's messages (a channel-telegram running somewhere?), and only one program can. Stop it, then run `pikit configure` again.",
        );
        return undefined;
      }
      throw error;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const from = update.message?.from;
      if (update.message?.chat.type !== "private" || from === undefined || from.is_bot) continue;
      const who = `${[from.first_name, from.last_name].filter(Boolean).join(" ")}${from.username ? ` (@${from.username})` : ""}, id ${from.id}`;
      const question = `Message from ${who}. Allow them to talk to your agent?`;
      const allowed = io.confirm ? await io.confirm(question, true) : /^(y|yes)?$/.test((await io.ask(`${question} [Y/n] `)).trim().toLowerCase());
      if (!allowed) continue;
      // Confirm the update, so the webhook does not deliver this setup message to the agent later.
      await api.getUpdates({ offset, timeout: 0 }).catch(() => {});
      await api.sendMessage(update.message.chat.id, "✓ You can talk to this bot once it is deployed (pikit up).").catch(() => {});
      return String(from.id);
    }
  }
  io.say("✗ No message arrived.");
  return undefined;
}
