/**
 * The project's agents, provided to the runtime under `agent.definition` (SPEC §6.1). A project
 * component: it lives here, not in `src/pikit/`, because the agents are yours.
 */

import { defineComponent } from "@pikit/core";
import assistant from "../agents/assistant/agent.ts";

export default defineComponent({
  name: "agents",
  setup(pikit) {
    pikit.provideKeyed("agent.definition", assistant.name, assistant);
  },
});
