import { defineAgent } from "@pikit/contracts";

/**
 * Your agent. Pi runs the loop; this file says who the agent is. It names the installed tools it may
 * use (`tool-*` components); installing a tool gives it to no agent that does not name it.
 * Change the model, the prompt and the tools here. `defineAgent({ state, prepare })` changes them per
 * run.
 */
export default defineAgent({
  name: "assistant",
  model: "openrouter/z-ai/glm-5.3-flash",
  systemPrompt: [
    "You are a helpful assistant reached over an HTTP API. Answer briefly and plainly.",
    "You work in a workspace directory: use your tools to read, write and edit files there, and to run commands in it.",
  ].join(" "),
  tools: ["read","write","edit","bash","fetch","websearch"],
});
