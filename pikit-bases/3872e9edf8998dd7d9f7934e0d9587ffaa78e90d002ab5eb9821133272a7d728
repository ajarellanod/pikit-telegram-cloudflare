# tool-fetch

The `fetch` tool, for the agents that name it: one HTTP(S) request to a web page or an API, with the
answer as text the model can read. It is also **the reference for writing a tool**: copy it.

- **Provides:** `agent.tool`, under the key `fetch`.
- **Requires:** nothing.
- **Targets:** `server` and `durable`: only `fetch`, streams and `HTMLRewriter`, which Workers and Bun
  both have.
- **Installs to:** `src/pikit/tool-fetch/` (`index.ts` the component, `fetch.ts` the tool, `tool-fetch.test.ts`).

```ts
defineAgent({ name: "research", model: "openrouter/z-ai/glm-5.3-flash", tools: ["fetch"] })
```

## How this tool is built

1. **`fetch.ts` is the tool**, written with pi-durable's `defineTool`, imported from
   `@pikit/pi-adapter/tools` (a component never imports Pi itself):
   ```ts
   defineTool({
     name: "fetch",                      // what the model calls, and the agent names
     description: "Makes one HTTP(S) request…", // what the model reads to decide when to call it
     parameters: Type.Object({ url: Type.String(), … }), // TypeBox: the Harness validates every call
     replay: "unsafe",                   // see below
     async execute(args, api, context) { // context.abortSignal: the call's cancellation
       return { content: [{ type: "text", text }] }; // a throw is an error result the model reads
     },
   });
   ```
   `api` has the call's conversation (`api.conversationId`) and its environment (`api.env`, the
   files and shell of `execution` or `workspace`), for tools that work on files. `fetch` uses neither.
2. **`index.ts` is the component**: it provides the tool as `agent.tool` under its own name, which
   runtime-pi checks. An agent gets a tool only when it names it.
3. **What it needs comes through capabilities**: a key through `secrets`
   (`tool-websearch-brave`, the reference for a tool with a secret), files through `api.env`. Never
   from the environment or config directly.
4. **Its limits are its own**, the same on both targets: one deadline for the whole call (20 s), a
   bounded read of the body (2 MB, the rest never downloaded), a bounded answer (50,000 characters).
   A tool's output goes into the transcript and the next model call: keep it small.
5. **Its replay is a decision.** pikit resumes a run after a crash. A `"safe"` tool is called again;
   an `"unsafe"` one is reported to the model as interrupted, and the model decides. `fetch` is
   `"unsafe"` because a POST, PUT, PATCH or DELETE may have had its effect before the crash, and a
   replay is one value for every call of a tool. `component.json`'s `replay.tools` repeats it.
6. **Its tests** (`tool-fetch.test.ts`) go from the inside out: `execute` called directly against a
   local server (`Bun.serve`, never the network), the tool as the component installs it in an app,
   and a real Harness turn (`runToolCalls` from `@pikit/pi-adapter/execution/testing`), where
   pi-durable validates the arguments and records the result.

## What it does

The model gives a `url` and, when it needs them, a `method`, `headers`, a `body`, `raw`. It gets the
status line (`HTTP 200 OK · text/html · <final URL>`) and the content: HTML as readable text (title,
text by blocks, then the links, absolute), or as it is with `raw: true`; JSON pretty-printed; other
text as it is. Binary content (images, PDFs, archives) is refused before it is downloaded. HEAD
returns the headers. Redirects are followed. An error status is an answer; a scheme other than
http(s), a method outside GET, HEAD, POST, PUT, PATCH, DELETE, a body on a GET, a network failure or
the timeout are errors. The description asks the model to confirm with the user before any method
other than GET or HEAD: an instruction, not an enforcement (that would be an approvals component).

**No credentials, no address filter.** It adds no cookie, token or key of its own. On a server it
reaches whatever the server reaches, private addresses included (`localhost`, your LAN, a cloud's
metadata endpoint); on Cloudflare, what the internet reaches. If your server can reach something the
agent must not, do not install it there, or firewall the server.

`component.json` is generated from `setup` (`bun run registry generate`); the test "what setup
declares" pins it.
