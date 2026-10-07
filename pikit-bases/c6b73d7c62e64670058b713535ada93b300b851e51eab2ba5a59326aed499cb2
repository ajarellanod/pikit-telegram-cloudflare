/**
 * The agent's shell in the Durable Object: just-bash (a bash interpreter and about 80 commands, in
 * TypeScript: pipes, redirections, loops, functions, `grep`, `sed`, `awk`, `find`, `jq`…) over the
 * workspace, with three host commands:
 * - `git`: isomorphic-git, with its fences (`git.ts`);
 * - `node` (and `js`): JavaScript in QuickJS (`quickjs.ts`);
 * - `curl`: just-bash's own, over the Worker's `fetch`.
 *
 * There are no processes and no native binaries: `npm`, `python`, `tar` are not here (C7).
 */

import { Bash, type CustomCommand, defineCommand, type IFileSystem } from "just-bash/browser";
import type { Files } from "./files.ts";
import type { createGit } from "./git.ts";
import { type QuickJsLimits, runScript, type ScriptResult } from "./quickjs.ts";

export interface ShellOptions {
  fs: IFileSystem;
  files: Files;
  git: ReturnType<typeof createGit>;
  /** The working directory, and `HOME`. */
  cwd: string;
  /** A command that runs longer is stopped (wall clock: see the README on CPU). */
  timeLimitMs: number;
  quickjs: QuickJsLimits;
}

export interface ShellRun {
  cwd?: string;
  env?: Record<string, string>;
  /** Start from `env` alone, not from the shell's own variables. */
  replaceEnv?: boolean;
  signal?: AbortSignal;
  /** Arguments of the command's program, passed to it unparsed (no expansion, splitting or globbing). */
  args?: string[];
}

/** Bytes read and requests' time, per `curl`. */
const CURL_MAX_BYTES = 4 * 1024 * 1024;
const CURL_TIMEOUT_MS = 20_000;

export function createShell(options: ShellOptions) {
  const { files } = options;

  const git = defineCommand("git", (args, ctx) => options.git.run(args, ctx.cwd));

  /** `node -e CODE`, `node -p EXPR`, `node FILE [args]`, or a script on stdin. */
  const node = defineCommand("node", async (args, ctx): Promise<ScriptResult> => {
    const io = (argv: string[]) => ({
      cwd: ctx.cwd,
      argv,
      env: ctx.exportedEnv ?? {},
      read: (path: string) => (files.lstat(path) === undefined || files.stat(path).kind !== "file" ? undefined : files.read(path)),
      write(path: string, bytes: Uint8Array) {
        files.refuseGit("open", path);
        files.mkdirp(path.slice(0, path.lastIndexOf("/")) || "/");
        files.write(path, bytes);
      },
      list: (path: string) => (files.lstat(path) === undefined || files.stat(path).kind !== "dir" ? undefined : files.list(path)),
    });
    const [first, second, ...more] = args;
    if (first === "--version" || first === "-v") return { stdout: "v0.0.0-quickjs\n", stderr: "", exitCode: 0 };
    if (first === "-e" || first === "--eval") return runScript(second ?? "", io(more), options.quickjs);
    if (first === "-p" || first === "--print") return runScript(`console.log((0, eval)(${JSON.stringify(second ?? "")}))`, io(more), options.quickjs);
    if (first !== undefined && !first.startsWith("-")) {
      const path = ctx.fs.resolvePath(ctx.cwd, first);
      if (files.lstat(path)?.kind !== "file") return { stdout: "", stderr: `node: cannot open '${first}': no such file\n`, exitCode: 1 };
      const source = new TextDecoder().decode(files.read(path)).replace(/^#!.*\n/, "");
      return runScript(source, io([path, ...args.slice(1)]), options.quickjs);
    }
    // Pipes carry bytes, one per character (latin1): the script is their UTF-8 text.
    const code = new TextDecoder().decode(Uint8Array.from(ctx.stdin as unknown as string, (char) => char.charCodeAt(0)));
    if (code.trim() === "") return { stdout: "", stderr: "usage: node -e CODE | node -p EXPR | node FILE [args] | echo CODE | node\n", exitCode: 1 };
    return runScript(code, io([]), options.quickjs);
  });
  const js = defineCommand("js", (args, ctx) => node.execute(args, ctx));

  // Built at the first command, once the object's storage is there (just-bash reads its filesystem).
  let bash: Bash | undefined;
  const create = () =>
    new Bash({
      fs: options.fs,
      cwd: options.cwd,
      env: { HOME: options.cwd, USER: "agent", LANG: "C.UTF-8" },
      customCommands: [git, node, js] satisfies CustomCommand[],
      network: { dangerouslyAllowFullInternetAccess: true },
      // just-bash's own fetch resolves DNS first, to refuse private addresses; a Worker has no DNS API,
      // and cannot reach a private network anyway. A plain `fetch`, bounded in time and size.
      fetch: async (url, init = {}) => {
        const response = await fetch(url, {
          method: init.method ?? "GET",
          headers: { "user-agent": "curl/8 (pikit agent)", ...(init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers) },
          ...(init.body !== undefined && { body: init.body }),
          redirect: init.followRedirects === false ? "manual" : "follow",
          signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? CURL_TIMEOUT_MS),
        });
        const body = new Uint8Array(await response.arrayBuffer()).slice(0, CURL_MAX_BYTES);
        return { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers), body, url: response.url || url };
      },
      // Its defense in depth patches globals (`setTimeout`, `Function`) while a script runs, which the
      // rest of the app in this isolate relies on. The fences here are the filesystem and the host commands.
      defenseInDepth: false,
      executionLimits: { maxExecutionTimeMs: options.timeLimitMs, maxOutputSize: 4 * 1024 * 1024 },
    });

  return {
    /** Runs `command` to its end; failures inside it are its exit code and stderr, as in bash. */
    async exec(command: string, run: ShellRun = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      try {
        bash ??= create();
        return await bash.exec(command, {
          ...(run.cwd !== undefined && { cwd: run.cwd }),
          ...(run.env !== undefined && { env: run.env }),
          ...(run.replaceEnv === true && { replaceEnv: true }),
          ...(run.signal !== undefined && { signal: run.signal }),
          ...(run.args !== undefined && { args: run.args }),
        });
      } catch (error) {
        // A redirection just-bash does not guard (`echo x > .git/HEAD`) throws the filesystem's error
        // out of the whole script; in bash it fails that command.
        if (error instanceof Error && typeof (error as { code?: unknown }).code === "string") return { stdout: "", stderr: `bash: ${error.message}\n`, exitCode: 1 };
        throw error;
      }
    },
  };
}
