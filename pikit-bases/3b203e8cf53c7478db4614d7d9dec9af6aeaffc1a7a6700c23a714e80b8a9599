/**
 * tool-edit: Pi's own `edit` tool, for the agents that name it (`tools: ["edit"]`). It replaces exact
 * pieces of text in a file, each one unique in it.
 *
 * pikit does not reimplement it (SPEC P1). This component adds only what the kit owns:
 * - the environment it works on, read when the tool runs: the agent's own `workspace` when one is
 *   installed (`workspace-local`: a directory per agent), otherwise `execution`. Any
 *   `execution` will do, with or without a shell;
 * - its replay, `"never"`: applying an edit twice is not the same as applying it once, so after a
 *   crash Pi reports the call as interrupted, and the model decides (`agentTool`'s replay, in
 *   @pikit/pi-adapter).
 *
 * Targets: `server` and `cloudflare`, wherever an `execution` provider is installed.
 */

import { defineComponent } from "@pikit/core";
import { CONVERSATION } from "@pikit/contracts";
import { bindTool, createEditTool } from "@pikit/pi-adapter/tools";

export default defineComponent({
  name: "tool-edit",
  setup(pikit) {
    const environment = pikit.use("execution");
    const workspace = pikit.useOptional("workspace");
    const tool = bindTool(createEditTool(), {
      // In a run, the agent's own workspace when one is installed; otherwise, and outside a run,
      // `execution` as before.
      async env(context) {
        const conversation = context.value(CONVERSATION);
        const workspaces = workspace.get();
        if (workspaces === undefined || conversation === undefined) return environment.get();
        return (await workspaces.resolve(conversation, context)).env;
      },
      replay: "never",
    });
    // Under the name the model calls it by: agents name it, and runtime-pi checks the two match.
    pikit.provideKeyed("agent.tool", "edit", tool);
  },
});
