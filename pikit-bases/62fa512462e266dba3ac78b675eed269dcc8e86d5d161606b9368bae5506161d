/**
 * tool-fetch: the agent tool `fetch`, for the agents that name it (`tools: ["fetch"]`). It makes one
 * HTTP(S) request to a web page or an API and returns what came back, as text the model can read:
 * HTML as readable text with its links, JSON pretty-printed, other text as it is, binary refused.
 *
 * A reference: this is how a tool component is built.
 * 1. **The tool** (`fetch.ts`) is pi-durable's `defineTool` from `@pikit/pi-adapter/tools`: a name, a
 *    description the model reads, TypeBox parameters, a `replay`, and `execute(args, api, context)`.
 *    `context.abortSignal` is the call's cancellation; a throw becomes an error result the model reads.
 * 2. **Its replay** says what happens to a call a crash interrupted: `"safe"` runs it again, `"unsafe"`
 *    tells the model it was interrupted. `fetch` is `"unsafe"`: a POST may have had its effect.
 *    `component.json`'s `replay.tools` repeats it, so `pikit add` can show it.
 * 3. **The component** (below) provides it as `agent.tool` under its own name. An agent gets it only
 *    when it names it; runtime-pi checks the name and the key match.
 * 4. **What it needs** comes through capabilities (`secrets` for a key, as tool-websearch-brave does),
 *    never from config or the environment directly. This one needs nothing.
 *
 * Targets: `server` and `durable`: it uses only `fetch`, streams and `HTMLRewriter`, which Workers
 * and Bun both have.
 */

import { defineComponent } from "@pikit/core";
import { createFetchTool } from "./fetch.ts";

export { createFetchTool, FETCH_MAX_BYTES, FETCH_MAX_OUTPUT, FETCH_METHODS, FETCH_TIMEOUT_MS, type FetchToolOptions } from "./fetch.ts";

export default defineComponent({
  name: "tool-fetch",
  setup(pikit) {
    // Under the name the model calls it by: agents name it, and runtime-pi checks the two match.
    pikit.provideKeyed("agent.tool", "fetch", createFetchTool());
  },
});
