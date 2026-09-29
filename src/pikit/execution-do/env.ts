/**
 * Pi's `ExecutionEnv` over the workspace (`files.ts`) and the shell (`shell.ts`): what Pi's own
 * `read`, `write`, `edit` and `bash` tools work on, unmodified (C7).
 *
 * As Pi requires, no method throws: every failure is a `Result`. Changes inside a `.git` are refused
 * as `permission_denied`. `exec` reports as Pi's own environment does: the combined output, bounded
 * (its tail, or head) and sent in one `replace` update, and, when it was cut and the caller asks, the
 * whole output kept in a file under `/tmp` (`spillPath`).
 */

import {
  err,
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileErrorCode,
  type FileInfo,
  ok,
  type Result,
  truncateHead,
  truncateTail,
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

/** Text as lines, remembering whether the last one ended with a newline. */
function linesOf(content: string) {
  const lines = content.split("\n");
  const last = lines.pop() ?? "";
  const out = lines.map((text) => ({ text, terminated: true }));
  if (last !== "") out.push({ text: last, terminated: false });
  return out;
}

export function createExecutionEnv(files: Files, shell: ReturnType<typeof createShell>, cwd: string): ExecutionEnv {
  const abs = (path: string) => resolvePath(cwd, path);
  /** `work`'s value, or its thrown filesystem error as a `FileError` about `path`. */
  const attempt = async <T>(path: string, work: () => T | Promise<T>): Promise<Result<T, FileError>> => {
    try {
      return ok(await work());
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      return err(new FileError(CODES[code] ?? "unknown", error instanceof Error ? error.message : String(error), path));
    }
  };
  const info = (path: string): FileInfo => {
    const node = files.lstat(path);
    if (node === undefined) throw fsError("ENOENT", "lstat", path);
    return { name: nameOf(path), path, kind: node.kind === "dir" ? "directory" : node.kind, size: node.size, mtimeMs: node.mtime };
  };
  const readText = (path: string) => decoder.decode(files.read(path));
  const change = (path: string, write: (target: string) => void) =>
    attempt(abs(path), () => {
      const target = abs(path);
      files.refuseGit("open", target);
      files.mkdirp(parentOf(target));
      write(target);
    });
  let temporary = 0;

  return {
    cwd,
    absolutePath: async (path) => ok(abs(path)),
    // Relative parts stay relative, as with Node's `path.join`.
    joinPath: async (parts) => {
      const joined = parts.join("/");
      return ok(joined.startsWith("/") ? normalize(joined) : normalize(joined).slice(1) || ".");
    },
    readTextFile: async (path) => attempt(abs(path), () => readText(abs(path))),
    openTextLineReader: async (path) =>
      attempt(abs(path), () => {
        const lines = linesOf(readText(abs(path)));
        let index = 0;
        return { readLine: async () => ok(lines[index++]), close: async () => {} };
      }),
    readTextLines: async (path, options) =>
      attempt(abs(path), () => {
        const lines = linesOf(readText(abs(path))).map((line) => line.text);
        return options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines);
      }),
    readBinaryFile: async (path) => attempt(abs(path), () => files.read(abs(path))),
    writeFile: async (path, content) => change(path, (target) => files.write(target, typeof content === "string" ? encoder.encode(content) : content)),
    appendFile: async (path, content) =>
      change(path, (target) => {
        const before = files.lstat(target) === undefined ? new Uint8Array() : files.read(target);
        const added = typeof content === "string" ? encoder.encode(content) : content;
        const out = new Uint8Array(before.length + added.length);
        out.set(before);
        out.set(added, before.length);
        files.write(target, out);
      }),
    renameFile: async (source, destination) =>
      attempt(abs(source), () => {
        files.refuseGit("rename", abs(source), abs(destination));
        files.mkdirp(parentOf(abs(destination)));
        files.rename(abs(source), abs(destination));
      }),
    fileInfo: async (path) => attempt(abs(path), () => info(abs(path))),
    listDir: async (path) =>
      attempt(abs(path), () => {
        const dir = abs(path);
        return files.list(dir).map((name) => info(resolvePath(dir, name)));
      }),
    canonicalPath: async (path) => attempt(abs(path), () => files.realpath(abs(path))),
    exists: async (path) => attempt(abs(path), () => files.lstat(abs(path)) !== undefined),
    createDir: async (path, options) =>
      attempt(abs(path), () => {
        files.refuseGit("mkdir", abs(path));
        if (options?.recursive === false) files.mkdir(abs(path));
        else files.mkdirp(abs(path));
      }),
    remove: async (path, options) =>
      attempt(abs(path), () => {
        const target = abs(path);
        files.refuseGit("rm", target);
        const node = files.lstat(target);
        if (node === undefined) {
          if (options?.force === true) return;
          throw fsError("ENOENT", "rm", target);
        }
        if (node?.kind === "dir" && options?.recursive !== true) files.rmdir(target);
        else files.removeTree(target);
      }),
    createTempDir: async (prefix) =>
      attempt("/tmp", () => {
        const path = `/tmp/${prefix ?? "tmp-"}${Date.now()}-${temporary++}`;
        files.mkdirp(path);
        return path;
      }),
    createTempFile: async (options) =>
      attempt("/tmp", () => {
        files.mkdirp("/tmp");
        const path = `/tmp/${options?.prefix ?? ""}${Date.now()}-${temporary++}${options?.suffix ?? ""}`;
        files.write(path, new Uint8Array());
        return path;
      }),
    cleanup: async () => {},

    async exec(command, options, context) {
      // A command stops at its timeout or when the run is cancelled (a slice's deadline, `stop`).
      const timeout = options?.timeout === undefined ? undefined : AbortSignal.timeout(options.timeout * 1_000);
      const signals = [context.abortSignal, timeout].filter((signal): signal is AbortSignal => signal !== undefined);
      const signal = signals.length === 0 ? undefined : AbortSignal.any(signals);
      const stopped = (): Result<never, ExecutionError> | undefined => {
        if (timeout?.aborted === true) return err(new ExecutionError("timeout", `the command timed out after ${options?.timeout} seconds`));
        if (context.abortSignal?.aborted === true) return err(new ExecutionError("aborted", "the command was cancelled"));
        return undefined;
      };
      try {
        const result = await shell.exec(command, {
          cwd: options?.cwd === undefined ? cwd : abs(options.cwd),
          ...(options?.env !== undefined && { env: options.env }),
          ...(options?.inheritEnv === false && { replaceEnv: true }),
          ...(signal !== undefined && { signal }),
        });
        const cut = stopped();
        if (cut !== undefined) return cut;
        const separator = result.stdout !== "" && result.stderr !== "" && !result.stdout.endsWith("\n") ? "\n" : "";
        const output = `${result.stdout}${separator}${result.stderr}`;
        const limits = options?.capture?.limits;
        const bounded = limits?.retain === "head" ? truncateHead : truncateTail;
        const { content, ...truncation } = bounded(output, limits === undefined ? {} : { maxLines: limits.maxLines, maxBytes: limits.maxBytes });
        let spillPath: string | undefined;
        if (truncation.truncated && options?.capture?.spill === true) {
          files.mkdirp("/tmp");
          spillPath = `/tmp/pikit-output-${Date.now()}-${temporary++}.log`;
          files.write(spillPath, encoder.encode(output));
        }
        options?.onUpdate?.({ kind: "replace", output: { text: content, truncation, ...(spillPath !== undefined && { spillPath }) } }, context);
        return ok({ exitCode: result.exitCode, truncation, ...(spillPath !== undefined && { spillPath }) });
      } catch (error) {
        return stopped() ?? err(new ExecutionError("unknown", error instanceof Error ? error.message : String(error)));
      }
    },
  };
}
