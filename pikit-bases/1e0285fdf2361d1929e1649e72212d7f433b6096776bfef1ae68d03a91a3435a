/**
 * For the tests only: execution-do's pi-durable environment (`env.ts`) over a Durable Object's
 * `storage`, built from the same parts and defaults `index.ts` builds its environment from (files,
 * fenced git, just-bash with `node` in QuickJS), with no app around it. Used under `bun test` with the
 * double of `durable-object.test-support.ts` and in workerd on a real object (`tests/workerd`).
 */

import type { ExecutionEnv } from "@pikit/pi-adapter/execution";
import { createDurableExecutionEnv } from "./env.ts";
import { createFiles, type DurableObjectFilesStorage, type Files } from "./files.ts";
import { createGit } from "./git.ts";
import { createShell } from "./shell.ts";
import { createShellFs } from "./shell-fs.ts";

export interface ObjectExecution {
  env: ExecutionEnv;
  files: Files;
}

/** The environment over `storage`, migrated, at `root` (made), with the files' namespace `id`. */
export function objectExecution(storage: DurableObjectFilesStorage, options: { id: string; root?: string; timeLimitSeconds?: number }): ObjectExecution {
  const root = options.root ?? "/work";
  const files = createFiles(() => storage);
  const git = createGit({
    files,
    repository: async () => undefined,
    token: async () => {
      throw new Error("not connected");
    },
    branchPrefix: "pikit/self/",
  });
  const shell = createShell({
    fs: createShellFs(files),
    files,
    git,
    cwd: root,
    timeLimitMs: (options.timeLimitSeconds ?? 25) * 1_000,
    quickjs: { interruptBudget: 10_000, heapBytes: 32 * 1024 * 1024 },
  });
  files.migrate();
  files.mkdirp(root);
  return { env: createDurableExecutionEnv(files, shell, root, { id: options.id }), files };
}
