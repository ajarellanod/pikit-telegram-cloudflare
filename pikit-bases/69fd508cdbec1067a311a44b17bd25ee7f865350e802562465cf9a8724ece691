/**
 * tool-websearch-brave: the agent tool `websearch`, for the agents that name it
 * (`tools: ["websearch"]`). It searches the web with the Brave Search API and returns the results:
 * title, address, when Brave knows it how old the page is, and a snippet.
 *
 * A reference: this is how a tool that needs a secret is built (tool-fetch is the one that needs
 * nothing).
 * - **The tool** (`websearch.ts`) is pi-durable's `defineTool` from `@pikit/pi-adapter/tools`. It takes
 *   the key as a function (`apiKey()`), asked at each call: it never holds the key, never puts it in
 *   its description, parameters, answers or errors, so the model and the transcript never see it.
 * - **The key is a secret**, `BRAVE_API_KEY`, read through `secrets` (the component `use`s it): an
 *   environment variable on a server, a Worker secret on Cloudflare. A call without it fails, saying
 *   so. `configure.ts` asks for it in `pikit configure`; `component.json` declares it.
 * - **Values in config**: `apiBase` is Brave's API by default; a proxy or a test double replaces it.
 * - **Its replay is `"safe"`**: a search only reads, so a run resumed after a crash searches again.
 *
 * Targets: `server` and `durable`: it uses only `fetch`, wherever a `secrets` provider is installed.
 */

import { defineComponent } from "@pikit/core";
import Type from "typebox";
import { BRAVE_KEY_SECRET, createBraveSearchTool } from "./websearch.ts";

export { BRAVE_KEY_SECRET as KEY_SECRET, BRAVE_SEARCH_PATH as SEARCH_PATH, BRAVE_TIMEOUT_MS as TIMEOUT_MS, type BraveSearchToolOptions, createBraveSearchTool } from "./websearch.ts";

const Config = Type.Object({
  /** Brave Search's API. A value, for a proxy or a test double. */
  apiBase: Type.String({ minLength: 1, default: "https://api.search.brave.com" }),
});

export default defineComponent({
  name: "tool-websearch-brave",
  config: Config,
  setup(pikit, config) {
    const secrets = pikit.use("secrets");
    // The key is read at each call, in start or later: `secrets.get()` throws during setup.
    const tool = createBraveSearchTool({ apiKey: () => secrets.get().get(BRAVE_KEY_SECRET), apiBase: config.apiBase });
    // Under the name the model calls it by: agents name it, and runtime-pi checks the two match.
    pikit.provideKeyed("agent.tool", "websearch", tool);
  },
});
