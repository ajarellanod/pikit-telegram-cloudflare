# secrets-cloudflare

Secrets from the Worker's `env`, on Cloudflare.

- **Provides:** `secrets`.
- **Requires:** nothing; it reads the Worker's `env` from `WORKERS_HOST`, which
  `deployment-cloudflare`'s entrypoint puts in the start context of each App.
- **Target:** `durable`. On a server, secrets are environment variables: `secrets-env`.
- **Installs to:** `src/pikit/secrets-cloudflare/`.
- **npm dependencies:** none.

## What it does

`secrets.get(name)` returns the Worker's `env[name]` when it is a string: a secret
(`wrangler secret put NAME`, or `.dev.vars` when running locally) or a variable (`vars` in
`wrangler.jsonc`). Anything else reads `undefined`:

- an empty string, so a component that needs a token sees it missing instead of accepting `""`;
- a binding (a Durable Object namespace, a KV namespace, a service): it is not a secret.

It works in both of a Cloudflare project's Apps (the Worker's and each Durable Object's): both are
given the same `env`. So `component.json` says `"apps": { "worker": "default" }`, and `pikit add`
lists it in both (`pikit remove` takes it out of both). It refuses to start where there is no
`WORKERS_HOST` (off Cloudflare).

It never writes or logs a value.

## Tests

`secrets-cloudflare.test.ts` is copied with the component and runs in your project under `bun test`:
the `secrets` conformance suite from `@pikit/contracts/testing` (values read back exactly, unset and
empty ones read `undefined`, and no value reaches `describe()` or a log line), with the `env` given
in `WORKERS_HOST`, bindings that read `undefined`, and the refusal off Cloudflare. pikit runs the
suite in workerd too, over a real Worker's `env` (`tests/workerd`).
