/**
 * pi-durable's `ExecutionEnv` over the workspace (`files.ts`) and the shell (`shell.ts`): what
 * pi-durable's own `read`, `write`, `edit` and `bash` tools work on, unmodified (`index.ts` provides it
 * as `execution` and `execution.shell`).
 *
 * As pi-durable requires, no method throws: every failure is a `Result`. Changes inside a `.git` are
 * refused as `permission_denied`. What it adds to a plain environment:
 * - **`id`**: the object's files are its own, so each object is its own namespace (`execution-do:<object id>`):
 *   pi-durable serializes `edit` and `write` on one file by `id` and path, and two objects in one
 *   isolate never wait on each other.
 * - **`truncateFile`** cuts or zero-extends a file; **`flushFile`** has nothing to flush (a write is a
 *   committed row of the object's SQL) and answers whether the file is there.
 * - **`openBinaryReader`** reads the file once, when it is opened: rows have no inode to hold on to,
 *   so the reader keeps the file it opened, through a rename or a replacement of its path, as Node's
 *   does. `scanLines` is pi-durable's own `LineScanner` over those bytes.
 * - **`openDirReader`** takes the names when it is opened and each entry's metadata when its page is
 *   read: an entry removed in between is skipped.
 * - **`watch`** is `not_supported`: only this object changes its files (its tools, its shell, `git`),
 *   and pikit loads nothing from a workspace that it would need to reload.
 * - **`exec`** runs a string through just-bash, and an argv array as its program with the arguments
 *   unparsed (just-bash's `args`); a program the shell does not have is a `spawn_error`. It streams the
 *   output to `onOutput` and bounds nothing: the Harness keeps what a tool shows. just-bash runs a
 *   command to its end, so the output arrives once it ended, one chunk per stream (stdout, then
 *   stderr). `window` is not used: the output is in the object's memory already, so every chunk is
 *   delivered and none `skipped`. Past `spill`'s thresholds the whole output is also written to a file
 *   under `/tmp` (`spillPath`). A command stopped by its timeout or the call's cancellation has no output.
 *
 * Methods read `this.cwd` at each call, so `atCwd` (`@pikit/pi-adapter/execution`) can give a
 * conversation another working directory over the same files.
 */

import {
  type BinaryReader,
  type Context,
  type DirReader,
  err,
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileErrorCode,
  type FileInfo,
  type FileWatcher,
  type LineScan,
  LineScanner,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputInfo,
  type TextLine,
  type TextLineReader,
  type WatchChange,
  type WatchTarget,
} from "@pikit/pi-adapter/execution";
import { type Files, fsError, nameOf, normalize, parentOf, resolvePath } from "./files.ts";
import type { createShell } from "./shell.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CODES: Record<string, FileErrorCode> = {
  ENOENT: "not_found",
  ENOTDIR: "not_directory",
  EISDIR: "is_directory",
  EPERM: "permission_denied",
  EEXIST: "invalid",
  ENOTEMPTY: "invalid",
  EINVAL: "invalid",
};
/** The longest timeout `setTimeout` takes, in seconds (pi-durable's limit). */
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

export interface DurableExecutionEnvOptions {
  /** The files' namespace: `execution-do:<the object's id>`. A function when the id is known only at start. */
  id: string | (() => string);
}

/** Text as lines, remembering whether the last one ended with a newline. */
function linesOf(content: string): TextLine[] {
  const lines = content.split("\n");
  const last = lines.pop() ?? "";
  const out = lines.map((text) => ({ text, terminated: true }));
  if (last !== "") out.push({ text: last, terminated: false });
  return out;
}

/** `work`'s value, or its thrown filesystem error as a `FileError` about `path`; an aborted call does nothing. */
async function attempt<T>(path: string, context: Context, work: () => T | Promise<T>): Promise<Result<T, FileError>> {
  if (context.abortSignal?.aborted === true) return err(new FileError("aborted", "the operation was cancelled", path));
  try {
    return ok(await work());
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    return err(new FileError(CODES[code] ?? "unknown", error instanceof Error ? error.message : String(error), path));
  }
}

/** Whether `output` crosses `spill`'s thresholds: more bytes, or more (complete or partial) lines. */
function crosses(output: string, spill: NonNullable<ShellExecOptions["spill"]>): boolean {
  if (output === "") return false;
  const bytes = encoder.encode(output).length;
  let newlines = 0;
  for (let at = output.indexOf("\n"); at !== -1; at = output.indexOf("\n", at + 1)) newlines++;
  const lines = newlines + (output.endsWith("\n") ? 0 : 1);
  return bytes > spill.afterBytes || lines > spill.afterLines;
}

/** `word` as one word of a shell command line, whatever it holds. */
const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

/** Why a reader cannot serve a call: a cancelled call, or the reader closed. */
function refused<T>(what: string, closed: boolean, path: string, context: Context): Result<T, FileError> | undefined {
  if (context.abortSignal?.aborted === true) return err(new FileError("aborted", "the operation was cancelled", path));
  if (closed) return err(new FileError("invalid", `${what} is closed`, path));
  return undefined;
}

/** A file's bytes as they were when it was opened. */
class OpenedFile implements BinaryReader {
  private closed = false;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly opened: FileInfo,
  ) {}

  async info(context: Context): Promise<Result<FileInfo, FileError>> {
    return refused<FileInfo>("Binary reader", this.closed, this.opened.path, context) ?? ok({ ...this.opened });
  }

  async read(offset: number, length: number, context: Context): Promise<Result<Uint8Array, FileError>> {
    const refusal = refused<Uint8Array>("Binary reader", this.closed, this.opened.path, context);
    if (refusal !== undefined) return refusal;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
      return err(new FileError("invalid", "Offset and length must be non-negative safe integers", this.opened.path));
    }
    return ok(this.bytes.slice(offset, offset + length));
  }

  async scanLines(options: { startLine: number; endLine?: number }, context: Context): Promise<Result<LineScan, FileError>> {
    const refusal = refused<LineScan>("Binary reader", this.closed, this.opened.path, context);
    if (refusal !== undefined) return refusal;
    let scanner: LineScanner;
    try {
      scanner = new LineScanner(options.startLine, options.endLine);
    } catch {
      return err(new FileError("invalid", "Invalid line range", this.opened.path));
    }
    scanner.push(this.bytes);
    return ok(scanner.finish());
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** A directory's names as they were when it was opened, described page by page. */
class Listing implements DirReader {
  private position = 0;
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly names: string[],
    /** An entry's metadata; `undefined` once it is gone. */
    private readonly describe: (name: string) => FileInfo | undefined,
  ) {}

  async next(maxEntries: number, context: Context): Promise<Result<{ entries: FileInfo[]; done: boolean }, FileError>> {
    const refusal = refused<{ entries: FileInfo[]; done: boolean }>("Directory reader", this.closed, this.path, context);
    if (refusal !== undefined) return refusal;
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) return err(new FileError("invalid", "maxEntries must be a positive safe integer", this.path));
    return attempt(this.path, context, () => {
      const entries: FileInfo[] = [];
      while (this.position < this.names.length && entries.length < maxEntries) {
        const entry = this.describe(this.names[this.position++] as string);
        if (entry !== undefined) entries.push(entry);
      }
      return { entries, done: this.position >= this.names.length };
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class DurableObjectExecutionEnv implements ExecutionEnv {
  cwd: string;
  /** Names of temporary files and directories, unique within this environment. */
  private temporary = 0;

  constructor(
    private readonly files: Files,
    private readonly shell: ReturnType<typeof createShell>,
    cwd: string,
    private readonly namespace: () => string,
  ) {
    this.cwd = normalize(cwd);
  }

  get id(): string {
    return this.namespace();
  }

  private abs(path: string): string {
    return resolvePath(this.cwd, path);
  }

  /** `path`'s metadata, read at `at` (its canonical path, for an entry under a symlinked directory). */
  private info(path: string, at = path): FileInfo {
    const node = this.files.lstat(at);
    if (node === undefined) throw fsError("ENOENT", "lstat", path);
    return { name: nameOf(path), path, kind: node.kind === "dir" ? "directory" : node.kind, size: node.size, mtimeMs: node.mtime };
  }

  /** The names in directory `dir` (absolute), and a function describing each one, `undefined` once it is gone. */
  private entries(dir: string): { names: string[]; describe(name: string): FileInfo | undefined } {
    const names = this.files.list(dir);
    const real = this.files.canonical(dir);
    return {
      names,
      describe: (name) => (this.files.lstat(resolvePath(real, name)) === undefined ? undefined : this.info(resolvePath(dir, name), resolvePath(real, name))),
    };
  }

  private readText(path: string): string {
    return decoder.decode(this.files.read(path));
  }

  /** Changes `path` (absolute) after refusing `.git` and making its directory. */
  private change(path: string, context: Context, write: (target: string) => void): Promise<Result<void, FileError>> {
    const target = this.abs(path);
    return attempt(target, context, () => {
      this.files.refuseGit("open", target);
      this.files.mkdirp(parentOf(target));
      write(target);
    });
  }

  async absolutePath(path: string): Promise<Result<string, FileError>> {
    return ok(this.abs(path));
  }

  /** Relative parts stay relative, as with Node's `path.join`. */
  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    const joined = parts.join("/");
    return ok(joined.startsWith("/") ? normalize(joined) : normalize(joined).slice(1) || ".");
  }

  readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    return attempt(this.abs(path), context, () => this.readText(this.abs(path)));
  }

  openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
    return attempt(this.abs(path), context, () => {
      const lines = linesOf(this.readText(this.abs(path)));
      let index = 0;
      return { readLine: async () => ok(lines[index++]), close: async () => {} };
    });
  }

  readTextLines(path: string, options: { maxLines?: number } | undefined, context: Context): Promise<Result<string[], FileError>> {
    return attempt(this.abs(path), context, () => {
      const lines = linesOf(this.readText(this.abs(path))).map((line) => line.text);
      return options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines);
    });
  }

  readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    return attempt(this.abs(path), context, () => this.files.read(this.abs(path)));
  }

  openBinaryReader(path: string, options: { noFollow?: boolean } | undefined, context: Context): Promise<Result<BinaryReader, FileError>> {
    const target = this.abs(path);
    return attempt(target, context, () => {
      // Only the last part is refused: the directories before it still resolve through symlinks.
      if (options?.noFollow === true && this.files.lstat(resolvePath(this.files.canonical(parentOf(target)), nameOf(target)))?.kind === "symlink") {
        throw fsError("EINVAL", "open", target, "Refusing to follow a symbolic link");
      }
      const real = this.files.canonical(target);
      const bytes = this.files.read(real);
      return new OpenedFile(bytes, { name: nameOf(target), path: target, kind: "file", size: bytes.length, mtimeMs: this.files.stat(real).mtime });
    });
  }

  writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.change(path, context, (target) => this.files.write(target, typeof content === "string" ? encoder.encode(content) : content));
  }

  appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.change(path, context, (target) => {
      const before = this.files.lstat(target) === undefined ? new Uint8Array() : this.files.read(target);
      const added = typeof content === "string" ? encoder.encode(content) : content;
      const out = new Uint8Array(before.length + added.length);
      out.set(before);
      out.set(added, before.length);
      this.files.write(target, out);
    });
  }

  truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    const target = this.abs(path);
    if (!Number.isSafeInteger(size) || size < 0) return Promise.resolve(err(new FileError("invalid", "File size must be a non-negative safe integer", target)));
    return attempt(target, context, () => {
      this.files.refuseGit("open", target);
      // Read first: a missing file is not_found (Node opens it r+), a directory is_directory.
      const before = this.files.read(target);
      const out = new Uint8Array(size);
      out.set(before.subarray(0, size));
      this.files.write(target, out);
    });
  }

  flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    const target = this.abs(path);
    return attempt(target, context, () => {
      // Every write is already a committed row of the object's SQL: nothing to flush.
      const node = this.files.stat(target);
      if (node.kind === "dir") throw fsError("EISDIR", "fsync", target);
    });
  }

  renameFile(source: string, destination: string, context: Context): Promise<Result<void, FileError>> {
    return attempt(this.abs(source), context, () => {
      this.files.refuseGit("rename", this.abs(source), this.abs(destination));
      this.files.mkdirp(parentOf(this.abs(destination)));
      this.files.rename(this.abs(source), this.abs(destination));
    });
  }

  fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    return attempt(this.abs(path), context, () => this.info(this.abs(path)));
  }

  listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    return attempt(this.abs(path), context, () => {
      const { names, describe } = this.entries(this.abs(path));
      return names.flatMap((name) => describe(name) ?? []);
    });
  }

  openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
    const dir = this.abs(path);
    return attempt(dir, context, () => {
      const { names, describe } = this.entries(dir);
      return new Listing(dir, names, describe);
    });
  }

  /**
   * Not supported: only this object changes its files (its tools, its shell, `git`), and pikit loads
   * nothing from a workspace that it would reload on a change, so nothing here needs to be told.
   */
  async watch(_targets: readonly WatchTarget[], _onChange: (change: WatchChange) => void, context: Context): Promise<Result<FileWatcher, FileError>> {
    if (context.abortSignal?.aborted === true) return err(new FileError("aborted", "the operation was cancelled"));
    return err(new FileError("not_supported", "a Durable Object's workspace cannot be watched"));
  }

  canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    return attempt(this.abs(path), context, () => this.files.realpath(this.abs(path)));
  }

  exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    return attempt(this.abs(path), context, () => this.files.lstat(this.abs(path)) !== undefined);
  }

  createDir(path: string, options: { recursive?: boolean } | undefined, context: Context): Promise<Result<void, FileError>> {
    return attempt(this.abs(path), context, () => {
      this.files.refuseGit("mkdir", this.abs(path));
      if (options?.recursive === false) this.files.mkdir(this.abs(path));
      else this.files.mkdirp(this.abs(path));
    });
  }

  remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, context: Context): Promise<Result<void, FileError>> {
    return attempt(this.abs(path), context, () => {
      const target = this.abs(path);
      this.files.refuseGit("rm", target);
      const node = this.files.lstat(target);
      if (node === undefined) {
        if (options?.force === true) return;
        throw fsError("ENOENT", "rm", target);
      }
      if (node.kind === "dir" && options?.recursive !== true) this.files.rmdir(target);
      else this.files.removeTree(target);
    });
  }

  createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>> {
    return attempt("/tmp", context, () => {
      const path = `/tmp/${prefix ?? "tmp-"}${Date.now()}-${this.temporary++}`;
      this.files.mkdirp(path);
      return path;
    });
  }

  createTempFile(options: { prefix?: string; suffix?: string } | undefined, context: Context): Promise<Result<string, FileError>> {
    return attempt("/tmp", context, () => {
      this.files.mkdirp("/tmp");
      const path = `/tmp/${options?.prefix ?? ""}${Date.now()}-${this.temporary++}${options?.suffix ?? ""}`;
      this.files.write(path, new Uint8Array());
      return path;
    });
  }

  async exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
    if (context.abortSignal?.aborted === true) return err(new ExecutionError("aborted", "the command was cancelled"));
    // An argv runs its program with the arguments unparsed: only the program's name is a shell word.
    const [program, ...args] = typeof command === "string" ? [command] : command;
    if (program === undefined) return err(new ExecutionError("spawn_error", "Empty argv: no program to run"));
    const line = typeof command === "string" ? command : quote(program);
    const seconds = options?.timeout;
    if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0)) return err(new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"));
    if (seconds !== undefined && seconds > MAX_TIMEOUT_SECONDS) return err(new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`));
    const cwd = options?.cwd === undefined ? this.cwd : this.abs(options.cwd);
    try {
      if (this.files.stat(cwd).kind !== "dir") throw fsError("ENOTDIR", "chdir", cwd);
    } catch (error) {
      return err(new ExecutionError("spawn_error", `Working directory does not exist: ${cwd}\nCannot execute bash commands.`, error instanceof Error ? error : undefined));
    }

    // A command stops at its timeout or when the call is cancelled (a slice's deadline, `stop`).
    const timeout = seconds === undefined ? undefined : AbortSignal.timeout(seconds * 1_000);
    const signals = [context.abortSignal, timeout].filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = signals.length === 0 ? undefined : AbortSignal.any(signals);
    const stopped = (): Result<never, ExecutionError> | undefined => {
      if (timeout?.aborted === true) return err(new ExecutionError("timeout", `timeout:${seconds}`));
      if (context.abortSignal?.aborted === true) return err(new ExecutionError("aborted", "the command was cancelled"));
      return undefined;
    };

    let result: { stdout: string; stderr: string; exitCode: number };
    try {
      if (typeof command !== "string" && (await this.shell.exec(`command -v ${line}`, { cwd })).exitCode !== 0) {
        return err(new ExecutionError("spawn_error", `${program}: command not found`));
      }
      result = await this.shell.exec(line, {
        cwd,
        ...(options?.env !== undefined && { env: options.env }),
        ...(options?.inheritEnv === false && { replaceEnv: true }),
        ...(signal !== undefined && { signal }),
        ...(typeof command !== "string" && { args }),
      });
    } catch (error) {
      return stopped() ?? err(new ExecutionError("unknown", error instanceof Error ? error.message : String(error)));
    }
    const cut = stopped();
    if (cut !== undefined) return cut;

    const output = `${result.stdout}${result.stderr}`;
    let spillPath: string | undefined;
    if (options?.spill !== undefined && crosses(output, options.spill)) {
      const created = await this.createTempFile({ prefix: "pi-output-", suffix: ".log" }, context);
      const written = created.ok ? await this.writeFile(created.value, output, context) : created;
      if (!written.ok) return err(new ExecutionError("unknown", `Failed to preserve complete shell output: ${written.error.message}`, written.error));
      spillPath = created.ok ? created.value : undefined;
    }
    const chunks: [string, ShellOutputInfo["stream"]][] = [
      [result.stdout, "stdout"],
      [result.stderr, "stderr"],
    ];
    if (options?.onOutput !== undefined) {
      try {
        for (const [text, stream] of chunks) if (text !== "") options.onOutput(text, context, { stream });
      } catch (error) {
        return err(new ExecutionError("callback_error", error instanceof Error ? error.message : String(error), error instanceof Error ? error : undefined));
      }
    }
    return ok({ exitCode: result.exitCode, ...(spillPath !== undefined && { spillPath }) });
  }

  async cleanup(): Promise<void> {
    // No process outlives a command: a running one ends with its call, whose context is cancelled.
  }
}

/**
 * pi-durable's `ExecutionEnv` over the object's `files` and `shell`, at `cwd` (the component's `root`).
 * One environment serves `execution` and `execution.shell`.
 */
export function createDurableExecutionEnv(files: Files, shell: ReturnType<typeof createShell>, cwd: string, options: DurableExecutionEnvOptions): ExecutionEnv {
  const id = options.id;
  return new DurableObjectExecutionEnv(files, shell, cwd, typeof id === "string" ? () => id : id);
}
