/**
 * The channel's step of `pikit configure`, against the fake Bot API, with a scripted person at the
 * terminal. The token and the first message are channel-telegram's steps; the webhook's secret and a
 * bot that already has a webhook are this channel's.
 */

import { afterEach, expect, test } from "bun:test";
import { type ConfigureIO, configure, findToken } from "./configure.ts";
import { type FakeTelegram, startFakeTelegram } from "./fake-telegram.test-support.ts";

const OWNER = { id: 1001, first_name: "Ada", username: "ada" };
const STRANGER = { id: 2002, first_name: "Eve" };
const GENERATED = /^[0-9a-f]{64}$/;
const GOOD_SECRET = "a-good-webhook-secret-0123456789";

const fakes: FakeTelegram[] = [];
afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.stop();
});

/** A terminal where a person gives `answers` in order, and a `.env` in memory. */
function terminal(
  telegram: FakeTelegram,
  options: { interactive?: boolean; env?: Record<string, string>; answers?: (string | (() => string))[]; config?: Record<string, unknown> } = {},
) {
  const env = new Map(Object.entries(options.env ?? {}));
  const answers = [...(options.answers ?? [])];
  const said: string[] = [];
  const asked: string[] = [];
  const next = async (question: string) => {
    asked.push(question);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`unexpected question: ${question}`);
    return typeof answer === "function" ? answer() : answer;
  };
  const io: ConfigureIO = {
    interactive: options.interactive ?? true,
    config: { apiBase: telegram.url, ...options.config },
    get: (name) => env.get(name),
    set: (name, value) => void env.set(name, value),
    ask: next,
    askSecret: next,
    say: (line) => void said.push(line),
  };
  return { io, env, said, asked };
}

function fake(): FakeTelegram {
  const telegram = startFakeTelegram();
  fakes.push(telegram);
  return telegram;
}

test("from nothing: it explains BotFather, checks the token, generates the webhook's secret, and allows whoever messages the bot", async () => {
  const telegram = fake();
  const t = terminal(telegram, { answers: [telegram.token, "y"] });
  setTimeout(() => telegram.say(OWNER, "hi"), 100);

  expect(await configure(t.io)).toEqual([]);

  expect(t.said.join("\n")).toContain("https://t.me/BotFather");
  expect(t.said.join("\n")).toContain("bot @pikit_test_bot (https://t.me/pikit_test_bot)");
  expect(t.said.join("\n")).toContain("TELEGRAM_WEBHOOK_SECRET generated");
  expect(t.asked.at(-1)).toContain("Message from Ada (@ada), id 1001. Allow them");
  expect(Object.fromEntries(t.env)).toEqual({ TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_WEBHOOK_SECRET: expect.stringMatching(GENERATED), TELEGRAM_ALLOWED_USERS: "1001" });
  expect(telegram.sent).toEqual([{ chatId: OWNER.id, text: "✓ You can talk to this bot once it is deployed (pikit up).", html: false }]);
  // Confirmed, so the webhook does not bring the setup message to the agent later.
  expect(telegram.pending()).toEqual([]);
  // Neither the token nor the secret is ever shown.
  const secret = t.env.get("TELEGRAM_WEBHOOK_SECRET") as string;
  expect(t.said.join("\n")).not.toContain(telegram.token);
  expect(t.said.join("\n")).not.toContain(secret);
});

test("a good secret is kept; one Telegram would refuse, or too short, is replaced", async () => {
  const telegram = fake();
  const kept = terminal(telegram, { interactive: false, env: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: "1001", TELEGRAM_WEBHOOK_SECRET: GOOD_SECRET } });
  expect(await configure(kept.io)).toEqual([]);
  expect(kept.env.get("TELEGRAM_WEBHOOK_SECRET")).toBe(GOOD_SECRET);
  expect(kept.said.join("\n")).not.toContain("TELEGRAM_WEBHOOK_SECRET");

  for (const bad of ["has spaces, and a comma", "short"]) {
    const replaced = terminal(telegram, { interactive: false, env: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: "1001", TELEGRAM_WEBHOOK_SECRET: bad } });
    expect(await configure(replaced.io)).toEqual([]);
    expect(replaced.env.get("TELEGRAM_WEBHOOK_SECRET")).toMatch(GENERATED);
    expect(replaced.said.join("\n")).toContain("TELEGRAM_WEBHOOK_SECRET was not usable");
  }
});

test("a mistyped token is caught at once and asked again", async () => {
  const telegram = fake();
  const t = terminal(telegram, { env: { TELEGRAM_ALLOWED_USERS: "1001" }, answers: ["123456789:AAE-a-typo-in-it", telegram.token] });

  expect(await configure(t.io)).toEqual([]);
  expect(t.said.join("\n")).toContain("Telegram does not know that token (401)");
  expect(t.env.get("TELEGRAM_BOT_TOKEN")).toBe(telegram.token);
});

test("something that is not a token is asked again, never sent to Telegram and never echoed", async () => {
  const telegram = fake();
  const t = terminal(telegram, { env: { TELEGRAM_ALLOWED_USERS: "1001" }, answers: ["my secret words", telegram.token] });

  expect(await configure(t.io)).toEqual([]);
  expect(t.said.join("\n")).toContain("That is not a bot token (15 characters");
  expect(t.said.join("\n")).not.toContain("my secret words");
});

test("findToken takes the bot id and secret out of any text", () => {
  expect(findToken("token: 123456789:AAEabc_DEF-ghi123\nKeep it secure")).toBe("123456789:AAEabc_DEF-ghi123");
  expect(findToken("HTTP API: nothing here")).toBeUndefined();
});

test("someone who is not you can be refused, and the next person allowed", async () => {
  const telegram = fake();
  const t = terminal(telegram, { env: { TELEGRAM_BOT_TOKEN: telegram.token }, answers: ["n", "y"] });
  setTimeout(() => {
    telegram.say(STRANGER, "hello?");
    telegram.say(OWNER, "it's me");
  }, 50);

  expect(await configure(t.io)).toEqual([]);
  expect(t.env.get("TELEGRAM_ALLOWED_USERS")).toBe("1001");
});

test("a bot that already has a webhook: removing it (the next pikit up sets it again) reads the message", async () => {
  const telegram = fake();
  telegram.webhookUrl = "https://my-agent.example.workers.dev/telegram";
  const t = terminal(telegram, { env: { TELEGRAM_BOT_TOKEN: telegram.token } });
  const confirmed: string[] = [];
  t.io.confirm = async (message) => {
    confirmed.push(message);
    if (message.startsWith("Message from")) return true;
    // The person sends their message once the webhook is gone.
    setTimeout(() => telegram.say(OWNER, "hi"), 50);
    return true;
  };

  expect(await configure(t.io)).toEqual([]);
  expect(t.said.join("\n")).toContain("The bot has a webhook (https://my-agent.example.workers.dev/telegram)");
  expect(confirmed[0]).toContain("Remove it while you send the bot a message?");
  expect(telegram.webhookUrl).toBe("");
  expect(t.env.get("TELEGRAM_ALLOWED_USERS")).toBe("1001");
});

test("a bot that already has a webhook, kept: what is missing is named, and nothing is removed", async () => {
  const telegram = fake();
  telegram.webhookUrl = "https://my-agent.example.workers.dev/telegram";
  const t = terminal(telegram, { env: { TELEGRAM_BOT_TOKEN: telegram.token }, answers: ["n"] });

  const missing = await configure(t.io);
  expect(missing).toHaveLength(1);
  expect(missing[0]).toContain("TELEGRAM_ALLOWED_USERS");
  expect(telegram.webhookUrl).toBe("https://my-agent.example.workers.dev/telegram");
});

test("without a terminal it asks nothing: it checks what the environment gives, generates the secret, or says what is missing", async () => {
  const telegram = fake();
  const complete = terminal(telegram, { interactive: false, env: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: "1001, 1002" } });
  const empty = terminal(telegram, { interactive: false });
  const noUsers = terminal(telegram, { interactive: false, env: { TELEGRAM_BOT_TOKEN: telegram.token } });

  expect(await configure(complete.io)).toEqual([]);
  expect(complete.said.join("\n")).toContain("TELEGRAM_ALLOWED_USERS: 2 user(s) allowed");
  expect(Object.fromEntries(complete.env)).toEqual({ TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_WEBHOOK_SECRET: expect.stringMatching(GENERATED), TELEGRAM_ALLOWED_USERS: "1001, 1002" });
  expect((await configure(empty.io))[0]).toContain("TELEGRAM_BOT_TOKEN");
  expect((await configure(noUsers.io))[0]).toContain("TELEGRAM_ALLOWED_USERS");
});

test("accounts: each bot is configured with its own variables, its own secret included", async () => {
  const telegram = fake();
  const ops = telegram.addBot("555555:ops-token-for-tests", { id: 5353, is_bot: true, first_name: "Ops Bot", username: "acme_ops_bot" });
  const done = terminal(telegram, {
    interactive: false,
    config: { accounts: ["ops"] },
    env: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: "1001", TELEGRAM_OPS_BOT_TOKEN: ops.token, TELEGRAM_OPS_ALLOWED_USERS: "3003" },
  });

  expect(await configure(done.io)).toEqual([]);
  expect(done.said.join("\n")).toContain('Telegram bot "ops" (telegram:ops)');
  expect(done.env.get("TELEGRAM_OPS_WEBHOOK_SECRET")).toMatch(GENERATED);
  expect(done.env.get("TELEGRAM_OPS_WEBHOOK_SECRET")).not.toBe(done.env.get("TELEGRAM_WEBHOOK_SECRET"));
});

test("a claim code, if one is given, is checked and saved to .env, never asked for; one that could be guessed is named", async () => {
  const telegram = fake();
  const saved = terminal(telegram, { interactive: false, env: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: "1001", TELEGRAM_CLAIM_CODE: "  correct horse battery staple " } });
  expect(await configure(saved.io)).toEqual([]);
  expect(saved.env.get("TELEGRAM_CLAIM_CODE")).toBe("correct horse battery staple");
  expect(saved.said.join("\n")).toContain("TELEGRAM_CLAIM_CODE: set; a private chat that sends /claim followed by it may talk to the bot");
  expect(saved.said.join("\n")).not.toContain("correct horse");

  const short = terminal(telegram, { interactive: false, env: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: "1001", TELEGRAM_CLAIM_CODE: "1234" } });
  expect(await configure(short.io)).toEqual(["TELEGRAM_CLAIM_CODE: choose a passphrase of at least 8 characters, or remove it"]);
  expect(short.said.join("\n")).toContain("TELEGRAM_CLAIM_CODE is not usable: it is shorter than 8 characters");

  const none = terminal(telegram, { interactive: false, env: { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: "1001" } });
  expect(await configure(none.io)).toEqual([]);
  expect(none.env.has("TELEGRAM_CLAIM_CODE")).toBe(false);
});
