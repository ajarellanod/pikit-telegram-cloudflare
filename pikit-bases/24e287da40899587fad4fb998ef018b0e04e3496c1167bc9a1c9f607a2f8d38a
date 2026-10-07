/**
 * tool-bash: pi-durable's own `bash` tool, for the agents that name it (`tools: ["bash"]`). It runs a shell command in the working directory and returns its output (the last lines when it is long), with an optional timeout.
 *
 * pikit does not reimplement it (SPEC P1). This component decides only what pi-durable leaves open:
 * - its replay, `"unsafe"` (`replay` below; pi-durable's own tools declare none, which is `"unsafe"`);
 * - what it needs installed: `execution.shell`, a real shell, so a project whose environment provides `execution` only cannot install it, and `pikit doctor` says so. `workspace-local` gives each agent `execution` itself in a directory, so its shell too.
 *
 * The environment a call works on is not the tool's business: the runtime (runtime-pi) builds it for
 * each call, the conversation's own `workspace` when one is installed (`workspace-local`: a directory
 * per agent), otherwise `execution`.
 *
 * A shell can do anything the environment's OS user can, outside the working directory too. Give
 * `bash` only to the agents that need it, and know the limits of the environment it runs in:
 * `execution-local` is not a sandbox.
 *
 * Targets: wherever an `execution.shell` provider is installed (`server` with `execution-local`, `durable` with `execution-do`).
 */

import { defineComponent } from "@pikit/core";
import { createBashTool } from "@pikit/pi-adapter/tools";

export default defineComponent({
  name: "tool-bash",
  setup(pikit) {
    // Required to install, not read: the runtime gives each call its environment.
    pikit.use("execution.shell");
    pikit.useOptional("workspace");
    // Under the name the model calls it by: agents name it, and runtime-pi checks the two match.
    // Replay "unsafe": a command can do anything, so after a crash the call is not run again: the
    // model gets an `interrupted` result with the output so far, and decides whether to run it again.
    pikit.provideKeyed("agent.tool", "bash", { ...createBashTool(), replay: "unsafe" });
  },
});
