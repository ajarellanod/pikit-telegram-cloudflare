/**
 * execution-do: the agent's workspace and shell inside its Durable Object, on Cloudflare (SPEC §4.1, C7).
 *
 * It provides `execution` and `execution.shell`, one pi-durable `ExecutionEnv` (`env.ts`), so
 * pi-durable's own `read`, `write`, `edit` and `bash` tools (the `tool-*` components) work there
 * unmodified:
 * - **Files** live in the object's own SQLite, under `root` (`/work`), in the tables `execution_do_*`
 *   (`files.ts`). They survive evictions and deploys, as the object's storage does.
 * - **The shell** is just-bash, a bash interpreter in TypeScript, with `git` (isomorphic-git, fenced),
 *   `node` (QuickJS in WebAssembly) and `curl` as host commands (`shell.ts`). There are no processes.
 * - **Only `git` changes files inside `.git`**, and it pushes only to where proposals go
 *   (`proposals.remote()`: proposals-github, the project's repository once GitHub is connected from
 *   the dashboard), on branches under that remote's `branchPrefix`. The remote and its authorization
 *   are asked of `proposals` at each command that needs them, so connecting after deploying needs no
 *   deploy; the credential is sent to that remote alone and never reaches the shell. With nowhere to
 *   go (no proposals provider, or not connected): clones are public and read-only, and a push says so.
 *
 * It refuses to start outside a Durable Object's App, or on an object without SQLite. It reads the
 * object from `WORKERS_HOST`, which `deployment-cloudflare` puts in the start context; it imports
 * nothing from `cloudflare:*`. Its dependencies use Node's `Buffer`: the Worker needs the
 * `nodejs_compat` compatibility flag.
 *
 * Target: `durable`. On a server, `execution-local` gives the agent the machine's own shell.
 */

import { type AppContext, BACKGROUND_CONTEXT, defineComponent } from "@pikit/core";
import { WORKERS_HOST } from "@pikit/contracts/cloudflare";
import Type from "typebox";
import { createDurableExecutionEnv } from "./env.ts";
import { createFiles, type DurableObjectFilesStorage } from "./files.ts";
import { createGit } from "./git.ts";
import { createShell } from "./shell.ts";
import { createShellFs } from "./shell-fs.ts";

const NAME = "execution-do";

const Config = Type.Object({
  /** The agent's working directory, and the shell's `HOME`. */
  root: Type.String({ pattern: "^/", default: "/work" }),
  shell: Type.Object(
    {
      /**
       * A command running longer is stopped. Wall clock: in a Worker it does not move while code
       * computes, so it stops commands that wait (on the network), not loops; just-bash's own limits
       * (commands, loop iterations) stop those.
       */
      timeLimitSeconds: Type.Number({ exclusiveMinimum: 0, default: 25 }),
    },
    { default: {} },
  ),
  node: Type.Object(
    {
      /** How long a script may compute, in QuickJS interrupts: about 1,150 per CPU second on Cloudflare. */
      interruptBudget: Type.Integer({ minimum: 1, default: 10_000 }),
      /** A script's heap. The whole isolate has about 128 MB. */
      heapMegabytes: Type.Integer({ minimum: 1, maximum: 128, default: 32 }),
    },
    { default: {} },
  ),
});

function isFilesStorage(storage: unknown): storage is DurableObjectFilesStorage {
  const candidate = storage as Partial<DurableObjectFilesStorage> | undefined;
  try {
    return typeof candidate?.sql?.exec === "function" && typeof candidate.transactionSync === "function";
  } catch {
    // An object without SQLite (declared in `new_classes`) throws when `sql` is read.
    return false;
  }
}

export default defineComponent({
  name: NAME,
  config: Config,
  setup(pikit, config) {
    // Where proposals go (proposals-github): the only remote `git push` reaches, and its credential.
    const proposals = pikit.useOptional("proposals");
    // A context of its own for asking `proposals` from a command: never start's.
    let background: AppContext | undefined;
    const remote = async () => {
      const provider = proposals.get();
      return provider === undefined || background === undefined ? undefined : provider.remote(background);
    };
    // Everything is built now; only the object's storage arrives at `start`. Used before or after,
    // the files answer that the app is not running.
    let storage: DurableObjectFilesStorage | undefined;
    const files = createFiles(() => {
      if (storage === undefined) throw new Error("execution-do: the workspace was used while the app is not running");
      return storage;
    });
    const git = createGit({ files, remote });
    const shell = createShell({
      fs: createShellFs(files),
      files,
      git,
      cwd: config.root,
      timeLimitMs: config.shell.timeLimitSeconds * 1_000,
      quickjs: { interruptBudget: config.node.interruptBudget, heapBytes: config.node.heapMegabytes * 1024 * 1024 },
    });
    // One environment serves both capabilities. Its files are the object's own: their namespace is the
    // object (pi-durable serializes `edit` and `write` on a file by namespace and path), known at start.
    let objectId: string | undefined;
    const env = createDurableExecutionEnv(files, shell, config.root, { id: () => `execution-do:${objectId ?? "unstarted"}` });
    pikit.provide("execution", env);
    pikit.provide("execution.shell", env);

    return {
      start(ctx) {
        const host = ctx.value(WORKERS_HOST);
        if (host?.object === undefined) {
          throw new Error(
            host === undefined
              ? "execution-do: no WORKERS_HOST in the start context: it runs only on Cloudflare, in a Durable Object's App started by deployment-cloudflare. On a server, use execution-local."
              : "execution-do: this App is not a Durable Object's (WORKERS_HOST has no object): install execution-do in the default export of pikit.config.ts, the conversation object's App, not in the Worker's.",
          );
        }
        const candidate = host.object.storage;
        if (!isFilesStorage(candidate)) {
          throw new Error("execution-do: the Durable Object's storage has no SQL API: declare its class in new_sqlite_classes (not new_classes) in the migrations of wrangler.jsonc.");
        }
        storage = candidate;
        objectId = host.object.id;
        files.migrate();
        files.mkdirp(config.root);
        background = ctx.derive(() => BACKGROUND_CONTEXT);
      },
      stop() {
        // Nothing to close: the files are the object's, and no process outlives a command. A command
        // still running ends with its run, whose context the runtime cancels.
        storage = undefined;
      },
    };
  },
});
