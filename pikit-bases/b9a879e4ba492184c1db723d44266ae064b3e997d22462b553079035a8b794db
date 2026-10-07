# provider-openrouter

The models OpenRouter serves (GLM, DeepSeek, Qwen, Llama, Claude, GPT…), for your agents, with one
API key. An agent names one as `openrouter/<vendor>/<model>`, for example
`openrouter/z-ai/glm-5.3-flash`.

- **Provides:** `model.provider`, under the key `openrouter`.
- **Requires:** nothing. The agent runtime reads credentials from `model.credentials` when it is
  installed.
- **Targets:** `server` and `durable`: the provider's module imports nothing node-only.
- **Installs to:** `src/pikit/provider-openrouter/`.
- **npm dependencies:** `@pikit/pi-adapter` (pinned with Pi), `typebox`.

## What it does

The provider is pi-ai's. It is imported by subpath (`@pikit/pi-adapter/providers/openrouter`), so
your app carries this provider and no other. Pi handles requests, retries and credentials, and knows
OpenRouter's catalogue of models as of the Pi version pikit pins.

```ts
defineAgent({ name: "support", model: "openrouter/z-ai/glm-5.3-flash" })
```

Everything after `openrouter/` is OpenRouter's model id, slashes included (`z-ai/glm-5.3-flash`, as
OpenRouter's site shows it).

## Credentials

An OpenRouter API key, from openrouter.ai/settings/keys. pi-ai looks for it in this order:
1. A credential stored for `openrouter` in `model.credentials` (for example `credentials-file`).
2. Only when nothing is stored, the environment: `OPENROUTER_API_KEY`.

The agent runtime refuses to start when neither exists.

On Cloudflare, pi-ai reads the environment through `process.env`, which a Worker fills from its
variables and secrets only with the `nodejs_compat` flag and a compatibility date of 2025-04-01 or
later. Without them, store the key in `model.credentials`.

The key's OAuth alternative (pi-ai's "Sign in with OpenRouter") runs a local callback server: it is
for a CLI on your machine, never for the app, which only reads the key it produced.

## Your account's guardrails

OpenRouter applies your account's (or your key's) settings to every request: the providers you
allow, the data policy (for example, no provider that trains on prompts), a spending limit. A model
they exclude is still listed here, and an agent naming it starts; its first request fails with
OpenRouter's error ("No endpoints found matching your data policy", 404 or 403). Pick another model,
or change the settings on openrouter.ai.

## Config

```ts
config: { "provider-openrouter": { apiBase: "https://openrouter.ai/api" } }
```

`apiBase` is OpenRouter's API by default: every model's address is under it (`<apiBase>/v1` for
most), the image and classifier models too (`moved` in `index.ts`: pi-ai's factory takes no base
URL). Change it only for a proxy in front of OpenRouter, or a test
double. The key goes wherever `apiBase` points.

## Tests

`provider-openrouter.test.ts` is copied with the component and runs in your project. It reads no
credential and reaches no network: a model answers through `apiBase` from
`fake-openrouter.test-support.ts`, a local stand-in of OpenRouter's streamed chat completions that
answers `answer: <your message>` and records what it was asked. Only tests import it. pikit's
end-to-end test of a Telegram bot on Cloudflare uses it as the bot's model.

`component.json` is generated from `setup` by `pikit registry generate` and is not written by hand;
the test "what setup declares" pins it.
