/**
 * tool-write: pi-durable's own `write` tool, for the agents that name it (`tools: ["write"]`). It creates or overwrites a file, creating its parent directories.
 *
 * pikit does not reimplement it (SPEC P1). This component decides only what pi-durable leaves open:
 * - its replay, `"unsafe"` (`replay` below; pi-durable's own tools declare none, which is `"unsafe"`);
 * - what it needs installed: an `execution`, with or without a shell (`workspace-local` builds on it).
 *
 * The environment a call works on is not the tool's business: the runtime (runtime-pi) builds it for
 * each call, the conversation's own `workspace` when one is installed (`workspace-local`: a directory
 * per agent), otherwise `execution`.
 *
 * Targets: `server` and `durable`, wherever an `execution` provider is installed.
 */

import { defineComponent } from "@pikit/core";
import { createWriteTool } from "@pikit/pi-adapter/tools";

export default defineComponent({
  name: "tool-write",
  setup(pikit) {
    // Required to install, not read: the runtime gives each call its environment.
    pikit.use("execution");
    pikit.useOptional("workspace");
    // Under the name the model calls it by: agents name it, and runtime-pi checks the two match.
    // Replay "unsafe": it changes files: running it again could undo a change made since, so after a
    // crash the call is not run again: the model gets an `interrupted` result and decides whether to
    // write again.
    pikit.provideKeyed("agent.tool", "write", { ...createWriteTool(), replay: "unsafe" });
  },
});
