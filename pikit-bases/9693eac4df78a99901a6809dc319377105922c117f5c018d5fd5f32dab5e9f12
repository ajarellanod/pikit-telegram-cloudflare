/**
 * `git` for the agent's shell: isomorphic-git over the workspace, as a trusted host command. It behaves
 * as real git for the subset an agent needs to change a repository and propose the change, so the
 * steward's steps are the same wherever it runs: `clone`, `checkout -b <branch>` and
 * `checkout <branch>`, `status`, `diff` (`--staged`), `add`, `commit -m` (what was added; `-a` adds the
 * tracked changes first), `log`, `push origin <branch>`. Anything else says it is not supported here.
 * There is no pull request command: a pushed `pikit/self/*` branch is the proposal, which the
 * proposals' provider shows the operator.
 *
 * The fences are code, not a prompt:
 * - **Push only to the connected repository, only branches under the prefix** (`pikit/self/` by
 *   default), never `main`. The connected repository is the `github` capability's (`repository`):
 *   none connected, nothing is pushed.
 * - **The token never reaches the shell.** It is asked for (`token`: `github`'s, for the connected
 *   repository) when a command needs it, and sent only to github.com for that repository: in the
 *   headers of git's requests and in `onAuth`. Other repositories are cloned without one (public only).
 * - **Only `git` writes inside `.git`**: this is the one caller of the filesystem that is not fenced
 *   (`files.refuseGit`).
 * - **A failed clone leaves nothing** behind, and a 429 or 5xx from GitHub is retried twice.
 *
 * GitHub over HTTPS only (`https://github.com/<owner>/<repository>`). Clones are shallow (depth 1,
 * one branch): the workspace is the object's SQL, and history is rarely what the agent needs.
 */

import { createTwoFilesPatch } from "diff";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { type Files, fsError, type Node, normalize, resolvePath } from "./files.ts";

export interface GitOptions {
  files: Files;
  /** The connected repository, `owner/name`, read at each command that needs it; `undefined` while none is. */
  repository(): Promise<string | undefined>;
  /** A token for the connected repository; rejects (saying how to connect) while none is. */
  token(): Promise<string>;
  /** What every pushed branch starts with. */
  branchPrefix: string;
  /** Who commits. */
  author?: { name: string; email: string };
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const AUTHOR = { name: "pikit agent", email: "agent@pikit.invalid" };
const USAGE =
  "usage: git clone <https://github.com/owner/repo> [dir] | checkout -b <branch> | checkout <branch> | status | diff [--staged] [path] | add <path>... | -A | commit [-a] -m <message> | log [-n N] [--oneline] | push origin <branch>\n";
const SUPPORTED = ["status", "diff", "add", "commit", "log", "push", "checkout"];
const NOT_CONNECTED = "GitHub is not connected: an operator connects it in the dashboard's Settings → GitHub";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** `owner` and `name` of a GitHub repository URL; `undefined` for anything else. */
export function githubRepository(url: string): { owner: string; name: string } | undefined {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match?.[1] !== undefined && match[2] !== undefined ? { owner: match[1], name: match[2] } : undefined;
}

/** Whether `branch` starts with `prefix` and is a plain, safe branch name after it. */
export function branchAllowed(branch: string, prefix: string): boolean {
  if (!branch.startsWith(prefix)) return false;
  const rest = branch.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(rest) && !rest.includes("..") && !rest.includes("//") && !rest.endsWith("/") && !rest.endsWith(".lock");
}

/** Node's `fs` as isomorphic-git asks for it, over the workspace, with no `.git` fence. */
export function gitFs(files: Files) {
  const stats = (node: Node) => ({
    type: node.kind,
    mode: node.mode,
    size: node.size,
    ino: 0,
    uid: 1,
    gid: 1,
    dev: 1,
    mtimeMs: node.mtime,
    ctimeMs: node.mtime,
    isFile: () => node.kind === "file",
    isDirectory: () => node.kind === "dir",
    isSymbolicLink: () => node.kind === "symlink",
  });
  const encodingOf = (options: unknown) => (typeof options === "string" ? options : (options as { encoding?: string } | undefined)?.encoding);
  return {
    promises: {
      async readFile(path: string, options?: unknown) {
        const bytes = files.read(path);
        return encodingOf(options) === "utf8" ? decoder.decode(bytes) : bytes;
      },
      async writeFile(path: string, data: string | Uint8Array, options?: unknown) {
        const mode = (options as { mode?: number } | undefined)?.mode;
        files.write(path, typeof data === "string" ? encoder.encode(data) : data, mode);
      },
      unlink: async (path: string) => files.unlink(path),
      readdir: async (path: string) => files.list(path),
      mkdir: async (path: string) => files.mkdir(path),
      rmdir: async (path: string) => files.rmdir(path),
      stat: async (path: string) => stats(files.stat(path)),
      async lstat(path: string) {
        const node = files.lstat(path);
        if (node === undefined) throw fsError("ENOENT", "lstat", normalize(path));
        return stats(node);
      },
      readlink: async (path: string) => files.readlink(path),
      symlink: async (target: string, path: string) => files.symlink(target, path),
      chmod: async (path: string, mode: number) => files.chmod(path, mode),
    },
  };
}


/** A date as git prints it: `Tue Nov 14 22:13:20 2023 +0000`, in the commit's own offset (isomorphic-git's is minutes behind UTC). */
function gitDate(timestamp: number, timezoneOffset: number): string {
  const local = new Date((timestamp - timezoneOffset * 60) * 1000);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][local.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][local.getUTCMonth()];
  const two = (n: number) => String(n).padStart(2, "0");
  const offset = Math.abs(timezoneOffset);
  const zone = `${timezoneOffset <= 0 ? "+" : "-"}${two(Math.floor(offset / 60))}${two(offset % 60)}`;
  return `${day} ${month} ${local.getUTCDate()} ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())} ${local.getUTCFullYear()} ${zone}`;
}

/** The `git` command: `run(args, cwd)` answers as a process would, with output and an exit code. */
export function createGit(options: GitOptions) {
  const { files } = options;
  const fs = gitFs(files);
  const author = options.author ?? AUTHOR;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  /** Whether `repository` is the connected one. */
  const connected = async (repository: { owner: string; name: string }) => {
    const current = await options.repository();
    return current !== undefined && same(current, `${repository.owner}/${repository.name}`);
  };
  const ok = (stdout: string): CommandResult => ({ stdout: stdout === "" || stdout.endsWith("\n") ? stdout : `${stdout}\n`, stderr: "", exitCode: 0 });
  const fail = (message: string, exitCode = 1): CommandResult => ({ stdout: "", stderr: `${message}\n`, exitCode });
  /** Every request to github.com carries the token, when there is one (the key isomorphic-git's `onAuth` sets too). */
  const headersFor = (token: string | undefined) => (token === undefined ? {} : { Authorization: `Basic ${btoa(`x-access-token:${token}`)}` });

  /** A real clone has its remote-tracking branch and a commit; a directory without them is half made. */
  const isClone = async (dir: string) => {
    try {
      return (await git.listBranches({ fs, dir, remote: "origin" })).length > 0 && (await git.log({ fs, dir, depth: 1 })).length > 0;
    } catch {
      return false;
    }
  };

  const originOf = async (dir: string) => {
    const url = (await git.getConfig({ fs, dir, path: "remote.origin.url" })) as string | undefined;
    const repository = url === undefined ? undefined : githubRepository(url);
    if (url === undefined || repository === undefined) throw new Error("this repository's origin is not a GitHub repository");
    return { url, ...repository };
  };

  /**
   * statusMatrix's rows: [file, HEAD (0 absent, 1 present), WORKDIR (0 absent, 1 as HEAD, 2 changed),
   * STAGE (0 absent, 1 as HEAD, 2 as WORKDIR, 3 neither)], the files that differ anywhere.
   */
  const matrix = async (dir: string) => (await git.statusMatrix({ fs, dir })).filter(([, head, work, stage]) => !(head === 1 && work === 1 && stage === 1));
  /** Whether the index differs from HEAD for a row: a change to be committed. */
  const staged = (head: number, stage: number) => (head === 0 ? stage !== 0 : stage !== 1);
  /** Whether the working tree differs from the index for a row (an untracked file is not a change of the index). */
  const unstaged = (head: number, work: number, stage: number) => (stage === 0 ? head === 1 && work !== 0 : work === 0 || stage === 3 || (stage === 1 && work === 2));

  /** The index's blob ids, by path. */
  const indexOids = async (dir: string): Promise<Map<string, string>> => {
    const oids = new Map<string, string>();
    await git.walk({
      fs,
      dir,
      trees: [git.STAGE()],
      map: async (filepath, [entry]) => {
        if (entry !== null && entry !== undefined && filepath !== "." && (await entry.type()) === "blob") oids.set(filepath, (await entry.oid()) as string);
        return undefined;
      },
    });
    return oids;
  };

  const repositoryAt = async (cwd: string) => {
    try {
      return await git.findRoot({ fs, filepath: cwd });
    } catch {
      return undefined;
    }
  };

  /** `path` (as typed in `cwd`) relative to the repository at `dir`: `""` for all of it, `undefined` outside it. */
  const inRepository = (dir: string, cwd: string, path: string): string | undefined => {
    const absolute = resolvePath(cwd, path);
    if (absolute === dir) return "";
    return absolute.startsWith(`${dir}/`) ? absolute.slice(dir.length + 1) : undefined;
  };
  const under = (file: string, spec: string) => spec === "" || file === spec || file.startsWith(`${spec}/`);

  /** Runs `attempt`, again after a 429 or a 5xx from GitHub (twice, after 4 s then 8 s). */
  const retrying = async <T>(attempt: () => Promise<T>, cleanup: () => void): Promise<T> => {
    for (let round = 1; ; round++) {
      try {
        return await attempt();
      } catch (error) {
        cleanup();
        const message = error instanceof Error ? error.message : String(error);
        if (round >= 3 || !/\b(429|5\d\d)\b/.test(message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, round * 4_000));
      }
    }
  };

  async function clone(args: string[], cwd: string): Promise<CommandResult> {
    const [url, target] = args.filter((arg) => !arg.startsWith("-"));
    if (url === undefined) return fail(USAGE, 129);
    const repository = githubRepository(url);
    if (repository === undefined) return fail(`fatal: only GitHub repositories over HTTPS can be cloned here (https://github.com/<owner>/<repository>), not '${url}'`, 128);
    const dir = resolvePath(cwd, target ?? repository.name);
    const existing = files.lstat(dir);
    if (existing !== undefined && (existing.kind !== "dir" || files.list(dir).length > 0)) {
      return fail(`fatal: destination path '${target ?? repository.name}' already exists and is not an empty directory`, 128);
    }
    // The connected repository's token for the connected repository only: any other is cloned without one.
    const pushable = await connected(repository);
    const token = pushable ? await options.token() : undefined;
    const onAuth = token === undefined ? undefined : () => ({ username: "x-access-token", password: token });
    try {
      await retrying(
        () => git.clone({ fs, http, dir, url, depth: 1, singleBranch: true, headers: headersFor(token), ...(onAuth !== undefined && { onAuth }) }),
        // Never leave a half clone behind.
        () => files.removeTree(dir),
      );
    } catch (error) {
      return fail(`fatal: could not clone ${url}: ${error instanceof Error ? error.message : String(error)}`, 128);
    }
    const branch = await git.currentBranch({ fs, dir });
    const count = (await git.listFiles({ fs, dir })).length;
    const push = pushable ? `you may push branches ${options.branchPrefix}… to it` : "read-only: it is not the connected repository, so nothing is pushed to it";
    return ok(`Cloned ${url} into ${dir} (branch ${branch}, ${count} files, latest commit only); ${push}.`);
  }

  async function checkout(dir: string, args: string[]): Promise<CommandResult> {
    const create = args[0] === "-b" || args[0] === "-B";
    const names = (create ? args.slice(1) : args).filter((arg) => arg !== "--");
    const [name, start] = names;
    if (name === undefined || start !== undefined || name.startsWith("-")) return fail("git checkout here: git checkout -b <new-branch>, or git checkout <branch> (restoring files is not supported here)", 129);
    const branches = await git.listBranches({ fs, dir });
    if (create) {
      if (branches.includes(name) && args[0] === "-b") return fail(`fatal: a branch named '${name}' already exists`, 128);
      // As `git checkout -b`: a branch at HEAD, the index and the working tree kept as they are.
      await git.branch({ fs, dir, ref: name, checkout: true, force: args[0] === "-B" });
      return ok(`Switched to a new branch '${name}'`);
    }
    if (!branches.includes(name)) return fail(`error: pathspec '${name}' did not match any branch known to git (restoring files is not supported here)`);
    await git.checkout({ fs, dir, ref: name });
    return ok(`Switched to branch '${name}'`);
  }

  async function status(dir: string): Promise<CommandResult> {
    const branch = await git.currentBranch({ fs, dir });
    const lines = (await matrix(dir)).flatMap(([file, head, work, stage]) => {
      if (head === 0 && stage === 0) return work === 0 ? [] : [`?? ${file}`];
      const x = !staged(head, stage) ? " " : head === 0 ? "A" : stage === 0 ? "D" : "M";
      const y = !unstaged(head, work, stage) ? " " : work === 0 ? "D" : "M";
      return x === " " && y === " " ? [] : [`${x}${y} ${file}`];
    });
    return ok(`On branch ${branch}\n${lines.length === 0 ? "nothing to commit, working tree clean" : lines.join("\n")}`);
  }

  async function diff(dir: string, cwd: string, args: string[]): Promise<CommandResult> {
    const cached = args.includes("--staged") || args.includes("--cached");
    const specs: string[] = [];
    for (const path of args.filter((arg) => !arg.startsWith("-"))) {
      const spec = inRepository(dir, cwd, path);
      if (spec === undefined) return fail(`fatal: ${path}: '${path}' is outside repository`, 128);
      specs.push(spec);
    }
    const index = await indexOids(dir);
    const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
    const blob = async (oid: string | undefined) => (oid === undefined ? new Uint8Array() : (await git.readBlob({ fs, dir, oid })).blob);
    const atHead = async (file: string) => (await git.readBlob({ fs, dir, oid: head, filepath: file })).blob;
    const patches: string[] = [];
    for (const [file, inHead, work, stage] of await matrix(dir)) {
      if (specs.length > 0 && !specs.some((spec) => under(file, spec))) continue;
      let before: Uint8Array;
      let after: Uint8Array;
      if (cached) {
        // What a commit would take: HEAD against the index.
        if (!staged(inHead, stage)) continue;
        before = inHead === 1 ? await atHead(file) : new Uint8Array();
        after = await blob(index.get(file));
      } else {
        // What is not added yet: the index against the working tree.
        if (!unstaged(inHead, work, stage) || stage === 0) continue;
        before = await blob(index.get(file));
        after = work === 0 ? new Uint8Array() : files.read(`${dir}/${file}`);
      }
      if (before.includes(0) || after.includes(0)) {
        patches.push(`Binary files a/${file} and b/${file} differ\n`);
        continue;
      }
      patches.push(createTwoFilesPatch(`a/${file}`, `b/${file}`, decoder.decode(before), decoder.decode(after), "", "", { context: 3 }));
    }
    return ok(patches.join(""));
  }

  /** Stages the changes of `rows` (an addition, a change, a removal). */
  const stage = async (dir: string, rows: Awaited<ReturnType<typeof matrix>>) => {
    for (const [file, , work] of rows) {
      if (work === 0) await git.remove({ fs, dir, filepath: file });
      else await git.add({ fs, dir, filepath: file });
    }
  };

  async function add(dir: string, cwd: string, args: string[]): Promise<CommandResult> {
    const all = args.includes("-A") || args.includes("--all");
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (!all && paths.length === 0) return ok("Nothing specified, nothing added.");
    const rows = (await matrix(dir)).filter(([, head, work, stage]) => unstaged(head, work, stage) || (head === 0 && stage === 0 && work !== 0));
    const specs = all && paths.length === 0 ? [""] : [];
    for (const path of paths) {
      const spec = inRepository(dir, cwd, path);
      if (spec === undefined) return fail(`fatal: ${path}: '${path}' is outside repository`, 128);
      const known = files.lstat(resolvePath(cwd, path)) !== undefined || (await git.listFiles({ fs, dir })).some((file) => under(file, spec));
      if (!known) return fail(`fatal: pathspec '${path}' did not match any files`, 128);
      specs.push(spec);
    }
    await stage(
      dir,
      rows.filter(([file]) => specs.some((spec) => under(file, spec))),
    );
    return ok("");
  }

  async function commit(dir: string, args: string[]): Promise<CommandResult> {
    const messages: string[] = [];
    let all = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? "";
      if (arg === "-m" || arg === "--message") messages.push(args[++i] ?? "");
      else if (arg === "-am" || arg === "-a" || arg === "--all") {
        all = true;
        if (arg === "-am") messages.push(args[++i] ?? "");
      } else if (arg.startsWith("--message=")) messages.push(arg.slice("--message=".length));
      else return fail(`error: git commit here takes -m <message> and -a, not '${arg}'`, 129);
    }
    if (messages.length === 0 || messages.every((message) => message.trim() === "")) return fail("error: git commit here needs a message: git commit -m <message>");
    // `-a`: the tracked files' changes first, as real git (never an untracked file).
    if (all) await stage(dir, (await matrix(dir)).filter(([, head, work, stage]) => head === 1 && unstaged(head, work, stage)));
    const rows = await matrix(dir);
    const toCommit = rows.filter(([, head, , stage]) => staged(head, stage));
    const branch = await git.currentBranch({ fs, dir });
    if (toCommit.length === 0) {
      const untracked = rows.some(([, head, work, stage]) => head === 0 && stage === 0 && work !== 0);
      const changed = rows.some(([, head, work, stage]) => unstaged(head, work, stage));
      const why = changed
        ? 'no changes added to commit (use "git add" and/or "git commit -a")'
        : untracked
          ? 'nothing added to commit but untracked files present (use "git add" to track)'
          : "nothing to commit, working tree clean";
      return { stdout: `On branch ${branch}\n${why}\n`, stderr: "", exitCode: 1 };
    }
    const oid = await git.commit({ fs, dir, message: messages.join("\n\n"), author });
    return ok(`[${branch} ${oid.slice(0, 7)}] ${messages[0]}\n ${toCommit.length} file(s) changed: ${toCommit.map(([file]) => file).join(", ")}`);
  }

  /** As real git's: `log` in its default format (the whole message), `--oneline` one line per commit. */
  async function log(dir: string, args: string[]): Promise<CommandResult> {
    let count = 10;
    let oneline = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? "";
      if (arg === "-n") count = Number(args[++i]);
      else if (/^-\d+$/.test(arg)) count = Number(arg.slice(1));
      else if (arg.startsWith("--max-count=")) count = Number(arg.slice("--max-count=".length));
      else if (arg === "--oneline") oneline = true;
      else return fail(`error: git log here takes -n <count> and --oneline, not '${arg}'`, 129);
    }
    const entries = await git.log({ fs, dir, depth: Math.min(Math.max(Number.isFinite(count) ? count : 10, 1), 100) });
    if (oneline) return ok(entries.map((entry) => `${entry.oid.slice(0, 7)} ${entry.commit.message.split("\n")[0]}`).join("\n"));
    return ok(
      entries
        .map(({ oid, commit }) => {
          const message = commit.message.replace(/\n+$/, "").split("\n").map((line) => (line === "" ? "" : `    ${line}`));
          return `commit ${oid}\nAuthor: ${commit.author.name} <${commit.author.email}>\nDate:   ${gitDate(commit.author.timestamp, commit.author.timezoneOffset)}\n\n${message.join("\n")}\n`;
        })
        .join("\n"),
    );
  }

  async function push(dir: string, args: string[]): Promise<CommandResult> {
    const [remote, named, extra] = args.filter((arg) => !arg.startsWith("-"));
    if (remote !== "origin" || named === undefined || extra !== undefined) return fail(`usage: git push origin ${options.branchPrefix}<topic>`, 129);
    const branch = named === "HEAD" ? await git.currentBranch({ fs, dir }) : named;
    if (branch === undefined || branch === null || !branchAllowed(branch, options.branchPrefix)) {
      return fail(`fatal: pushing is allowed only to branches ${options.branchPrefix}<topic> (letters, digits, . _ / -), not '${named}'`);
    }
    if (!(await isClone(dir))) return fail(`fatal: ${dir} is not a complete clone: clone it again`);
    if (!(await git.listBranches({ fs, dir })).includes(branch)) return fail(`error: src refspec ${branch} does not match any (create it first: git checkout -b ${branch})`);
    const origin = await originOf(dir);
    const current = await options.repository();
    if (current === undefined) return fail(`fatal: ${NOT_CONNECTED}`);
    if (!same(current, `${origin.owner}/${origin.name}`)) return fail(`fatal: pushing to ${origin.owner}/${origin.name} is not allowed here: only to ${current}, the connected repository`);
    const token = await options.token();
    const result = await git.push({
      fs,
      http,
      dir,
      remote: "origin",
      ref: branch,
      remoteRef: branch,
      // The agent's own branches: it may rewrite them.
      force: true,
      headers: headersFor(token),
      onAuth: () => ({ username: "x-access-token", password: token }),
    });
    if (!result.ok) return fail(`fatal: the push was rejected: ${result.error ?? JSON.stringify(result.refs)}`);
    return ok(`To https://github.com/${origin.owner}/${origin.name}\n * ${branch} -> ${branch}\nThe operator sees it as a proposal in the dashboard.`);
  }

  return {
    isClone,
    async run(args: string[], cwd: string): Promise<CommandResult> {
      const [command, ...rest] = args;
      try {
        if (command === undefined || command === "help" || command === "--help") return ok(USAGE);
        if (command === "clone") return await clone(rest, cwd);
        if (!SUPPORTED.includes(command)) return fail(`git: '${command}' is not supported here.\n${USAGE}`);
        const dir = await repositoryAt(cwd);
        if (dir === undefined) return fail("fatal: not a git repository (or any of the parent directories): .git", 128);
        switch (command) {
          case "status":
            return await status(dir);
          case "diff":
            return await diff(dir, cwd, rest);
          case "add":
            return await add(dir, cwd, rest);
          case "commit":
            return await commit(dir, rest);
          case "log":
            return await log(dir, rest);
          case "checkout":
            return await checkout(dir, rest);
          default:
            return await push(dir, rest);
        }
      } catch (error) {
        return fail(`git ${command}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
