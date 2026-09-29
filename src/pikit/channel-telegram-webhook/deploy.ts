/**
 * Registering the webhook, after a deploy (SPEC §4.1, C8). Telegram must be told where to post each
 * bot's updates (`setWebhook`), and only once the new version answers: right after a deploy the
 * previous version still answers for a few seconds (measured), and would refuse the new secret.
 *
 * So this is not done at start nor by `pikit configure`: `deployment-cloudflare`'s `up` calls it once
 * `/health` answers with the version it deployed, the way `pikit configure` calls `configure(io)`.
 * The contract, for whoever deploys:
 *
 *   import { afterDeploy } from "./src/pikit/channel-telegram-webhook/deploy.ts";
 *   const problems = await afterDeploy({ url: "https://my-agent.example.workers.dev", config, get, say });
 *
 * - `url` is the deployed Worker's public base URL (HTTPS: Telegram posts only there).
 * - `config` is this component's config in pikit.config.ts (`apiBase`, `accounts`), as `configure` gets it.
 * - `get` reads a variable from `.env` or the environment: the bots' tokens and webhook secrets.
 * - It resolves with what went wrong, one line per bot (empty when every webhook is registered and
 *   checked); it throws only when Telegram cannot be reached at all.
 *
 * For each bot: `setWebhook` with its path (`/telegram`, `/telegram/<name>`), its secret, and
 * `allowed_updates: ["message"]` (what the Worker handles); then `getWebhookInfo` checks Telegram has
 * that URL. Updates Telegram holds are kept (no `drop_pending_updates`): they are delivered to the new
 * webhook, and a message sent while the bot had none is not lost. Setting the same webhook again is
 * harmless, so every deploy calls it.
 *
 * Without `pikit up` (a "Deploy to Cloudflare" button, Workers Builds), the Worker registers itself
 * instead (`webhook.ts`): the new version checks its webhook on its first request, and
 * `GET /telegram/setup` sets it.
 */

import { createTelegramApi, TelegramError } from "./api.ts";
import { settingsOf } from "./configure.ts";
import { ALLOWED_UPDATES } from "./webhook.ts";

export { ALLOWED_UPDATES };

/** What `afterDeploy` needs. Structural, so this file imports nothing from the deployment component. */
export interface AfterDeployIO {
  /** The deployed app's public base URL, once it answers with the new version. */
  url: string;
  /** This component's config in `pikit.config.ts`, as written there. */
  config: Readonly<Record<string, unknown>>;
  /** A variable from `.env`, or exported in the environment. */
  get(name: string): string | undefined;
  say(line: string): void;
}

/** Registers and checks every bot's webhook; returns what went wrong (empty when done). */
export async function afterDeploy(io: AfterDeployIO): Promise<string[]> {
  const { apiBase, accounts } = settingsOf(io.config);
  const base = io.url.replace(/\/+$/, "");
  const problems: string[] = [];
  for (const account of accounts) {
    const token = io.get(account.tokenSecret);
    const secretToken = io.get(account.webhookSecret);
    if (token === undefined || token === "" || secretToken === undefined || secretToken === "") {
      problems.push(`${account.instance}: ${token ? account.webhookSecret : account.tokenSecret} is not set; run \`pikit configure\`, then \`pikit up\` again`);
      continue;
    }
    const url = `${base}${account.path}`;
    const api = createTelegramApi(token, apiBase);
    try {
      await api.setWebhook({ url, secretToken, allowedUpdates: ALLOWED_UPDATES });
      const info = await api.getWebhookInfo();
      if (info.url !== url) {
        problems.push(`${account.instance}: Telegram has the webhook ${info.url === "" ? "unset" : info.url}, not ${url}`);
        continue;
      }
      io.say(`✓ Telegram ${account.instance}: webhook ${url}`);
    } catch (error) {
      if (!(error instanceof TelegramError) || error.code === 0) throw error;
      problems.push(`${account.instance}: Telegram refused the webhook ${url} (${error.message})`);
    }
  }
  return problems;
}
