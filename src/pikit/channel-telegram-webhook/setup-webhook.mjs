#!/usr/bin/env node
/**
 * channel-telegram-webhook: registers the Telegram webhook after `wrangler deploy`, where no `pikit up`
 * runs (a "Deploy to Cloudflare" button's Workers Builds, a deploy by hand). No dependency, no import:
 * Node 18 or later, or Bun. It needs no secret either (a build has none): it asks the deployed Worker,
 * which registers itself with its own.
 *
 *   wrangler deploy | node src/pikit/channel-telegram-webhook/setup-webhook.mjs
 *   node src/pikit/channel-telegram-webhook/setup-webhook.mjs https://my-bot.acme.workers.dev [<version id>]
 *
 * Piped, it passes wrangler's output through, and reads from it the Worker's URL (the first one listed
 * under `Deployed <name> triggers`: its workers.dev URL) and the version deployed (`Current Version ID:
 * …`). A Worker on a custom domain only, without workers.dev, is given by its URL. Then (SPEC §4.1, C8):
 * 1. it waits until `GET <url>/health` answers ok from that version (3 minutes at most). That request
 *    starts the new version, which already checks its webhook as it starts;
 * 2. `GET <url>/telegram/setup`: the Worker sets every bot's webhook at its own origin, with its own
 *    secret, and says what it did.
 *
 * It prints one line per bot, and exits 1 when something failed (the version stays deployed).
 * `SETUP_WAIT_MS` and `SETUP_INTERVAL_MS` change how long it waits, and how often it asks.
 */

const WAIT_MS = Number(process.env.SETUP_WAIT_MS ?? 180_000);
const INTERVAL_MS = Number(process.env.SETUP_INTERVAL_MS ?? 2_000);

/** Everything piped in, passed through to stdout as it comes. */
async function readPiped() {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of process.stdin) {
    const piece = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    process.stdout.write(piece);
    text += piece;
  }
  return text;
}

/** The Worker's URL and the version deployed, in wrangler deploy's output. */
function fromWrangler(text) {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  // Only after "Deployed <name> triggers": a warning above it may quote a link.
  const triggers = plain.search(/Deployed \S+ triggers/);
  return {
    url: triggers < 0 ? undefined : /https?:\/\/[^\s"'<>()]+/.exec(plain.slice(triggers))?.[0],
    version: /Current Version ID:\s*([0-9A-Za-z-]+)/.exec(plain)?.[1],
  };
}

const json = (response) => response.json().catch(() => undefined);

async function main(args) {
  let [url, version] = args;
  if (url === undefined) {
    if (process.stdin.isTTY) {
      console.error("usage: wrangler deploy | node setup-webhook.mjs, or node setup-webhook.mjs <the Worker's URL> [<version id>]");
      return 2;
    }
    ({ url, version } = fromWrangler(await readPiped()));
    if (url === undefined) {
      console.error("✗ Telegram: no Worker URL in wrangler's output (did the deploy fail?). Pass the Worker's URL instead.");
      return 1;
    }
  }
  const base = url.replace(/\/+$/, "");

  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const health = await fetch(`${base}/health`).then(json, () => undefined);
    if (health?.ok === true && (version === undefined || health.version === version)) break;
    if (Date.now() > deadline) {
      console.error(`✗ Telegram: ${base}/health did not answer ${version === undefined ? "ok" : `from version ${version}`} in time; open ${base}/telegram/setup once it does`);
      return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  const response = await fetch(`${base}/telegram/setup`).catch(() => undefined);
  const answer = response === undefined ? undefined : await json(response);
  if (answer === undefined || !Array.isArray(answer.bots)) {
    console.error(`✗ Telegram: ${base}/telegram/setup answered ${response?.status ?? "nothing"}`);
    return 1;
  }
  for (const bot of answer.bots) console.log(bot.ok ? `✓ Telegram ${bot.bot}: webhook ${bot.webhook}` : `✗ Telegram ${bot.bot}: ${bot.problem}`);
  return answer.ok === true ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
