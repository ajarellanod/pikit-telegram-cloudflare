/**
 * The Worker registering its own webhook (SPEC §4.1, C8), for a deploy with no `pikit up` after it: a
 * "Deploy to Cloudflare" button, Workers Builds, `wrangler deploy` by hand. The Worker has everything
 * it needs: its token, its webhook's secret, and the origin a request reached it at. Two ways in
 * (`worker.ts`):
 *
 * - **Automatically**, once per isolate, when the Worker's App starts on Cloudflare (its first
 *   request, `/health` included): `getWebhookInfo`, and `setWebhook` only when Telegram does not have
 *   this URL and these updates. An isolate runs one version, so a new version checks once in each of
 *   its isolates: one subrequest when all is well, three when it registers. Nothing is stored: the
 *   Worker has no storage (C1), and Telegram's answer is the truth to compare with.
 * - **`GET /telegram/setup`**, by hand or from a build: always `setWebhook`, then checks. This is the
 *   way to hand Telegram a new secret, which `getWebhookInfo` never shows.
 *
 * Both point the bot at `<origin>/telegram[/<name>]` with its secret and `allowed_updates: ["message"]`,
 * and keep the updates Telegram holds (no `drop_pending_updates`). Registering is idempotent.
 */

import type { Account } from "./account.ts";
import { type TelegramApi, TelegramError } from "./api.ts";

/** What Telegram posts to the webhook: messages only, what the Worker handles. */
export const ALLOWED_UPDATES = ["message"];

/** How long one registration call to Telegram may take: a start waits for it (and has 20 s in all). */
export const REGISTRATION_TIMEOUT_MS = 5_000;

export interface Registration {
  /** The channel instance: `telegram`, `telegram:ops`. */
  bot: string;
  /** The webhook this Worker wants: `<origin>/telegram[/<name>]`. */
  webhook: string;
  ok: boolean;
  /** Whether `setWebhook` was called. */
  set: boolean;
  /** What went wrong, when `ok` is false. Never the token nor the secret. */
  problem?: string;
}

/** Whether Telegram posts exactly the updates this channel handles. */
function sameUpdates(given: readonly string[] | undefined): boolean {
  return given !== undefined && given.length === ALLOWED_UPDATES.length && ALLOWED_UPDATES.every((type) => given.includes(type));
}

/**
 * Points `account`'s bot at `<origin><path>` with `secretToken`. With `force: false`, only when
 * Telegram does not already have that URL and those updates. Resolves with what happened; never throws.
 */
export async function registerWebhook(
  api: TelegramApi,
  account: Account,
  options: { origin: string; secretToken: string; force: boolean; signal?: AbortSignal | undefined },
): Promise<Registration> {
  const webhook = `${options.origin.replace(/\/+$/, "")}${account.path}`;
  const result = (ok: boolean, set: boolean, problem?: string): Registration => ({ bot: account.instance, webhook, ok, set, ...(problem !== undefined && { problem }) });
  const signal = (): AbortSignal => (options.signal === undefined ? AbortSignal.timeout(REGISTRATION_TIMEOUT_MS) : AbortSignal.any([options.signal, AbortSignal.timeout(REGISTRATION_TIMEOUT_MS)]));
  try {
    if (!options.force) {
      const info = await api.getWebhookInfo(signal());
      if (info.url === webhook && sameUpdates(info.allowed_updates)) return result(true, false);
    }
    await api.setWebhook({ url: webhook, secretToken: options.secretToken, allowedUpdates: ALLOWED_UPDATES }, signal());
    const info = await api.getWebhookInfo(signal());
    if (info.url !== webhook) return result(false, true, `Telegram has the webhook ${info.url === "" ? "unset" : info.url}, not ${webhook}`);
    return result(true, true);
  } catch (error) {
    if (error instanceof TelegramError && error.code !== 0) return result(false, false, `Telegram refused the webhook ${webhook} (${error.message})`);
    return result(false, false, `Telegram could not be reached (${error instanceof TelegramError ? error.message : error instanceof Error ? error.name : "error"})`);
  }
}
