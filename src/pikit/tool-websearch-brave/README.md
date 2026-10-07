# tool-websearch-brave

The `websearch` tool, for the agents that name it: it searches the web with the Brave Search API and
returns the most relevant results. The API key stays a secret: the model never sees it. It is also
**the reference for a tool that needs a secret** (`tool-fetch` is the one for a tool that needs
nothing).

- **Provides:** `agent.tool`, under the key `websearch`.
- **Requires:** `secrets` (for example `secrets-env`), holding `BRAVE_API_KEY`.
- **Targets:** `server` and `durable`: only `fetch`, wherever a `secrets` provider is installed.
- **Installs to:** `src/pikit/tool-websearch-brave/` (`index.ts` the component, `websearch.ts` the
  tool, `configure.ts` its step of `pikit configure`, and their tests).

```sh
pikit add secrets-env            # where BRAVE_API_KEY is read from, on a server
pikit add tool-websearch-brave
```

## How this tool is built

1. **`websearch.ts` is the tool**, pi-durable's `defineTool` from `@pikit/pi-adapter/tools`, as in
   tool-fetch. It takes the key as a function, `apiKey()`, asked at each call: the tool never holds
   the key, and never puts it in its description, parameters, answers, errors or memos. An answer that
   echoes the key has it replaced by `[redacted]` before the model or the transcript sees it.
2. **`index.ts` reads the key through `secrets`** (`pikit.use("secrets")`, then
   `secrets.get().get("BRAVE_API_KEY")` inside `apiKey`): an environment variable on a server, a
   Worker secret on Cloudflare. No component reads `process.env` or a binding for a secret.
3. **Config holds values, not secrets**: `apiBase` (Brave's API by default, a proxy or a test double
   otherwise). The component's TypeBox schema gives it a default, so a project needs no config.
4. **`component.json` declares the variable** (`environment`: `BRAVE_API_KEY`, secret, optional), and
   **`configure.ts` asks for it** in `pikit configure` (where to get one, asked without echo, Enter
   skips). It is optional: the app starts without it, and each search fails saying the key is not set,
   which the model passes on.
5. **Errors say what to do** and never show the key: 401/403 "the key was refused", 429 "the quota is
   reached", a missing key "ask whoever runs this app to add it".
6. **Replay `"safe"`**: a search only reads, so a run resumed after a crash searches again. Its name is
   `websearch`, not Brave's: another search component could provide it and no agent would change.
7. **Its tests**: Brave is a local stand-in on a free port (`Bun.serve`) reached through `apiBase`;
   the tool is tested installed (with a `secrets` double), called once as the runtime calls it
   (`callTool`), and in a real Harness turn (`runToolCalls`), whose transcript is searched for the key.
   `configure.test.ts` drives the configure step with a scripted terminal.

## What it does

The model gives a `query` and, if it wants, a `count` (1 to 20, default 5). It gets one entry per
result: title, address, age when Brave knows it, and a snippet, as plain text. It asks
`GET <apiBase>/res/v1/web/search?q=…&count=…` with the key in `X-Subscription-Token`, and gives up
after 20 s. Get a key at api-dashboard.search.brave.com (the free plan works).

`component.json` is generated from `setup` (`bun run registry generate`); the test "what setup
declares" pins it.
