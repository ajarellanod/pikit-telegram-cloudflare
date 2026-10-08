import { defineAgent } from "@pikit/contracts";

/**
 * Your agent. Pi runs the loop; this file says who the agent is. It names the installed tools it may
 * use (`tool-*` components) and the agent extensions it runs with (`extension-*`); installing either
 * gives it to no agent that does not name it. Change the model, the prompt, the tools and the
 * extensions here. `defineAgent({ state, prepare })` changes them per run. It is the project's
 * steward (`steward: true`, one per project): the agent that may know itself (`pikit-self`) and that
 * its operators ask to change the project.
 */
export default defineAgent({
  name: "assistant",
  model: "openrouter/z-ai/glm-5.3-flash",
  steward: true,
  systemPrompt: [
    "You are a helpful assistant that people talk to in Telegram chats. Answer briefly and plainly.",
    "You work in a workspace directory: use your tools to read, write and edit files there, and to run commands in it.",
  ].join(" "),
  tools: ["read","write","edit","bash","fetch","websearch"],
  extensions: ["pikit-self"],
});
