# Your own AI agent in Telegram, on Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ajarellanod/pikit-telegram-cloudflare)

A Telegram bot that answers with an AI agent, running in your own Cloudflare account: a Worker that
receives Telegram's messages, and one Durable Object per chat where the agent runs
([Pi](https://github.com/earendil-works/pi) on an [OpenRouter](https://openrouter.ai) model) with a
workspace, a shell, web fetch and web search. Only you can talk to it, once you claim it.

It is a [pikit](https://github.com/ajarellanod/pikit) project (`pikit new --target cloudflare --preset
telegram-cloudflare`), so every part of it is source in this repository, yours to read and change.

## Before you click

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up), a GitHub account (the
button copies this repository into it), and these values, which the setup page asks for as the
Worker's secrets:

| Secret | What to type |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Your bot's token. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, choose a name and a username ending in `bot`, and paste the token it answers (two parts separated by `:`). |
| `TELEGRAM_WEBHOOK_SECRET` | A random string that Telegram sends with every message, so only Telegram reaches your bot: 16 to 256 letters, digits, `_` or `-`. Run `openssl rand -hex 32`, or type any long random string of those characters. You never need it again. |
| `TELEGRAM_CLAIM_CODE` | A passphrase you choose, **8 characters or more** (the bot does not start with a shorter one). Once deployed, send `/claim <passphrase>` to your bot: your chat is the one it talks to. Whoever knows it can claim the bot too: keep it secret, and change it to revoke every claim. |
| `OPENROUTER_API_KEY` | Your [OpenRouter API key](https://openrouter.ai/settings/keys): the model your agent runs on. You pay OpenRouter for its tokens; a credit limit on the key caps it. |
| `BRAVE_API_KEY` | Optional: a [Brave Search API key](https://api-dashboard.search.brave.com) for the agent's web search (the free plan works). Without one, the bot works and only web search fails; if the form wants a value, type `none`. |

The button then copies this repository into your GitHub, creates the Worker (`pikit-telegram-bot`, which you
may rename on that page) and its Durable Objects, and builds and deploys it with Workers Builds. It
deploys again on every push to your copy.

## After deploying

1. **Wait for the first build** (a few minutes). Its deploy step ends with
   `✓ Telegram telegram: webhook https://pikit-telegram-bot.<your-subdomain>.workers.dev/telegram`: Telegram
   now sends your bot's messages to your Worker.
2. **Open your bot in Telegram** (the `t.me/…` link @BotFather gave you) and send it anything. It
   answers that it is private, with your Telegram user id.
3. **Send `/claim <your claim code>`.** It answers "✓ This chat can talk to the agent now." Delete
   that message: it holds the claim code.
4. **Talk to it.** `/new` starts a new conversation; `/help` says what it does.
5. **Optionally, make it yours with pikit.** The repository the button made is a normal pikit
   project. Clone it, [install pikit](https://github.com/ajarellanod/pikit/tree/main/installer), and:

   ```sh
   npm install             # or bun install
   pikit doctor            # the components, what each one needs, and the files you changed
   pikit add <component>   # another tool or channel; then npm install, and commit package-lock.json
   git push                # Workers Builds deploys it
   ```

   `pikit upgrade`, which brings newer versions of the installed components, is planned and not
   there yet; until then `pikit remove` and `pikit add` replace a component. Change the model and the
   prompt in `src/agents/assistant/agent.ts`.

**The bot does not answer?** Open `https://pikit-telegram-bot.<your-subdomain>.workers.dev/health`: it answers
`{"ok":true,…}` when the Worker and its objects start. Then open `/telegram/setup` on the same URL
once: it registers the webhook again and says what Telegram answered. The Worker's logs are in the
Cloudflare dashboard (Workers & Pages → your Worker → Logs).

## How it works

- **The webhook registers itself.** The deploy command (`npm run deploy`, the `deploy` script in
  `package.json`) runs `wrangler deploy`, then `src/pikit/channel-telegram-webhook/setup-webhook.mjs`,
  which reads the Worker's URL and version from wrangler's output, waits until `/health` answers from
  that version, and asks the Worker to register its webhook (`GET /telegram/setup`). The build has no
  secrets and needs none: the Worker registers itself with its own. Besides, each new version checks
  its webhook on its first HTTPS request and fixes it if Telegram has another URL.
- **Messages.** Telegram posts each message to `POST /telegram` with the webhook secret. The Worker
  checks the secret and who wrote, and hands the message to that chat's Durable Object, which runs the
  agent and sends the answer back. A message is acknowledged once it is stored, never after the run.
- **Where things are.** Conversations, sessions and the agent's files live in each chat's Durable
  Object (SQLite). Nothing is stored anywhere else.

## What it costs

- **Cloudflare: the Workers Free plan is enough.** It allows 100,000 requests a day (Telegram's
  messages, the objects' calls and alarms count) and 5 GB of Durable Object storage per account;
  Workers Builds includes 3,000 build minutes a month. The Workers Paid plan ($5 a month) raises the
  limits.
- **The model's tokens**, which you pay OpenRouter for, per message. Set a credit limit on the key
  at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
- Brave Search has a free plan.

## Security

- **Who can talk to the bot.** Nobody, until you claim it. Then: the private chats that sent
  `/claim` with the right code, and the Telegram user ids you list in `TELEGRAM_ALLOWED_USERS` (ids
  separated by commas; the bot tells a stranger their id). Add it in the dashboard as a **secret**
  (Settings → Variables and Secrets): the next `wrangler deploy` would remove a plain variable that
  `wrangler.jsonc` does not list. Everyone else is told the bot is private, and nothing they write reaches the agent.
  Groups, channels and other bots are ignored.
- **The claim code** lets whoever knows it claim the bot: choose a long one, tell nobody, and delete
  your `/claim` message. After 5 wrong codes in a row a chat waits 15 minutes. It never reaches the
  agent or the logs. Change the `TELEGRAM_CLAIM_CODE` secret to revoke every claim made with the old
  one (you then `/claim` again with the new one); delete it to close new claims while keeping the
  chats that claimed.
- **The webhook secret** is how the Worker knows a message comes from Telegram: a request without it
  is refused (`401`). If you change it, open `/telegram/setup` once so Telegram gets the new one.
- **`/telegram/setup` and `/health` are public**, and harmless: setup can only point your bot at your
  own Worker, with its own secret, and neither shows a secret.
- **Whoever can talk to the agent can use its tools**: fetch pages, search the web, and run commands
  in its own workspace (a shell without processes, inside the chat's Durable Object). And they spend
  your model's tokens.
- **Secrets live only in Cloudflare**, as the Worker's secrets. This repository has none:
  `.dev.vars.example` lists their names, and `.dev.vars` and `.env` (for local runs) are ignored by
  Git.

## Run it on your machine

`.dev.vars.example` lists the secrets: copy it to `.dev.vars`, fill it in, and `npx wrangler dev`
runs the Worker and its objects locally (Telegram cannot reach it there, so talk to it with a
deployed copy). With pikit, `pikit configure` asks for everything, writes `.env`, and allows you by
reading your first message; `pikit up` deploys to the same Worker (`wrangler.jsonc`'s `name`).

## What is in here

| Path | What it is |
|---|---|
| `pikit.config.ts` | the composition root: the Worker's App (`worker`) and each chat's Durable Object's App (the default export) |
| `src/agents/assistant/agent.ts` | your agent: its model, prompt and tools |
| `src/pikit/<component>/` | the installed components, with their tests and a README each |
| `wrangler.jsonc` | the Worker: its name, the `Conversation` Durable Object and its SQLite migration |
| `.dev.vars.example` | the secrets the Deploy button asks for |
| `package.json`, `package-lock.json` | the dependencies (installed with npm), the `deploy` script, and the setup page's descriptions (`cloudflare.bindings`) |
| `pikit.json`, `pikit-bases/` | what pikit installed, from which pikit commit, and each file as installed |
| `vendor/` | pikit's own packages (`@pikit/core` and the rest), until they are on npm |

Its tests run with [Bun](https://bun.sh): `bun test`.

This repository is generated by pikit (`bun scripts/template.ts telegram-cloudflare`, see
[`templates/README.md`](https://github.com/ajarellanod/pikit/blob/main/templates/README.md)): change
pikit, not this repository. Your copy is yours: change anything.
