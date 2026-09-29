/**
 * `afterDeploy`: registering each bot's webhook once a deploy answers (C8), against the fake Bot API.
 * `channel-telegram-webhook.test.ts` uses it too, to point the fake at the served routes.
 */

import { afterEach, expect, test } from "bun:test";
import { afterDeploy, type AfterDeployIO } from "./deploy.ts";
import { type FakeTelegram, startFakeTelegram } from "./fake-telegram.test-support.ts";

const SECRET = "a-good-webhook-secret-0123456789";
const OPS_TOKEN = "555555:ops-token-for-tests";
const OPS_SECRET = "the-ops-webhook-secret-01234567";

const fakes: FakeTelegram[] = [];
afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.stop();
});

function io(telegram: FakeTelegram, env: Record<string, string>, config: Record<string, unknown> = {}): AfterDeployIO & { said: string[] } {
  const said: string[] = [];
  return { url: "https://my-agent.example.workers.dev/", config: { apiBase: telegram.url, ...config }, get: (name) => env[name], say: (line) => void said.push(line), said };
}

test("each bot's webhook is set to its path, with its secret and messages only, and checked", async () => {
  const telegram = startFakeTelegram();
  fakes.push(telegram);
  const ops = telegram.addBot(OPS_TOKEN, { id: 5353, is_bot: true, first_name: "Ops Bot", username: "acme_ops_bot" });
  const deploy = io(
    telegram,
    { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_OPS_BOT_TOKEN: OPS_TOKEN, TELEGRAM_OPS_WEBHOOK_SECRET: OPS_SECRET },
    { accounts: ["ops"] },
  );

  expect(await afterDeploy(deploy)).toEqual([]);

  expect([telegram.webhookUrl, telegram.webhookSecret, telegram.allowedUpdates]).toEqual(["https://my-agent.example.workers.dev/telegram", SECRET, ["message"]]);
  expect([ops.webhookUrl, ops.webhookSecret, ops.allowedUpdates]).toEqual(["https://my-agent.example.workers.dev/telegram/ops", OPS_SECRET, ["message"]]);
  expect(deploy.said).toEqual([
    "✓ Telegram telegram: webhook https://my-agent.example.workers.dev/telegram",
    "✓ Telegram telegram:ops: webhook https://my-agent.example.workers.dev/telegram/ops",
  ]);
  expect(deploy.said.join("\n")).not.toContain(SECRET);

  // Every deploy sets it again: harmless.
  expect(await afterDeploy(deploy)).toEqual([]);
  expect(telegram.webhooksSet).toBe(2);
});

test("a missing variable, or a secret Telegram refuses, is reported per bot; the other bots are still registered", async () => {
  const telegram = startFakeTelegram();
  fakes.push(telegram);
  const ops = telegram.addBot(OPS_TOKEN, { id: 5353, is_bot: true, first_name: "Ops Bot", username: "acme_ops_bot" });

  const missing = await afterDeploy(io(telegram, { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_OPS_BOT_TOKEN: OPS_TOKEN, TELEGRAM_OPS_WEBHOOK_SECRET: OPS_SECRET }, { accounts: ["ops"] }));
  expect(missing).toEqual(["telegram: TELEGRAM_WEBHOOK_SECRET is not set; run `pikit configure`, then `pikit up` again"]);
  expect(ops.webhookUrl).toBe("https://my-agent.example.workers.dev/telegram/ops");

  const refused = await afterDeploy(io(telegram, { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_WEBHOOK_SECRET: "not allowed!" }));
  expect(refused).toEqual([expect.stringContaining("telegram: Telegram refused the webhook https://my-agent.example.workers.dev/telegram (telegram setWebhook: 400 Bad Request: secret token")]);
});
