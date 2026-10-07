/**
 * tool-read: pi-durable's own `read` tool, for the agents that name it (`tools: ["read"]`). It reads a text file (from a line, up to a number of lines) or an image, and truncates long files for the model.
 *
 * pikit does not reimplement it (SPEC P1). This component decides only what pi-durable leaves open:
 * - its replay, `"safe"` (`replay` below; pi-durable's own tools declare none, which is `"unsafe"`);
 * - what it needs installed: an `execution`, with or without a shell (`workspace-local` builds on it).
 *
 * The environment a call works on is not the tool's business: the runtime (runtime-pi) builds it for
 * each call, the conversation's own `workspace` when one is installed (`workspace-local`: a directory
 * per agent), otherwise `execution`.
 *
 * Targets: `server` and `durable`, wherever an `execution` provider is installed.
 */

import { defineComponent } from "@pikit/core";
import { createReadTool } from "@pikit/pi-adapter/tools";

export default defineComponent({
  name: "tool-read",
  setup(pikit) {
    // Required to install, not read: the runtime gives each call its environment.
    pikit.use("execution");
    pikit.useOptional("workspace");
    // Under the name the model calls it by: agents name it, and runtime-pi checks the two match.
    // Replay "safe": it only reads, so a call a crash interrupted is run again when the run resumes.
    pikit.provideKeyed("agent.tool", "read", { ...createReadTool(), replay: "safe" });
  },
});
