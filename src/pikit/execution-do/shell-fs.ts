/**
 * just-bash's `IFileSystem` over the workspace (`files.ts`), so the shell, `git` and Pi's file tools
 * see the same files. Every change inside a `.git` is refused (`EPERM`): only `git` writes there.
 */

import type { BufferEncoding, FsStat, IFileSystem } from "just-bash/browser";
import { type Files, fsError, type Node, normalize, parentOf, resolvePath } from "./files.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** Always there, always empty: what is written to it is dropped, not stored. */
const DEV_NULL = "/dev/null";
const NULL_STAT: FsStat = { isFile: true, isDirectory: false, isSymbolicLink: false, mode: 0o20666, size: 0, mtime: new Date(0) };

/** Bytes as text in `encoding` (UTF-8 by default), as Node's `Buffer.toString` gives them. */
export function decode(bytes: Uint8Array, encoding?: BufferEncoding | null): string {
  switch (encoding) {
    case "binary":
    case "latin1":
    case "ascii": {
      let out = "";
      for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return out;
    }
    case "base64":
      return btoa(decode(bytes, "latin1"));
    case "hex":
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    default:
      return decoder.decode(bytes);
  }
}

/** Text in `encoding` (UTF-8 by default) as bytes; bytes stay as they are. */
export function encode(content: string | Uint8Array, encoding?: BufferEncoding): Uint8Array {
  if (typeof content !== "string") return content;
  switch (encoding) {
    case "binary":
    case "latin1":
    case "ascii":
      return Uint8Array.from(content, (char) => char.charCodeAt(0) & 0xff);
    case "base64":
      return encode(atob(content), "latin1");
    case "hex":
      return Uint8Array.from(content.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    default:
      return encoder.encode(content);
  }
}

const encodingOf = (options: { encoding?: BufferEncoding | null } | BufferEncoding | undefined) =>
  (typeof options === "string" ? options : options?.encoding) ?? undefined;

const statOf = (node: Node): FsStat => ({
  isFile: node.kind === "file",
  isDirectory: node.kind === "dir",
  isSymbolicLink: node.kind === "symlink",
  mode: node.mode,
  size: node.size,
  mtime: new Date(node.mtime),
});

export function createShellFs(files: Files): IFileSystem {
  const refuseGit = files.refuseGit;
  const copy = (source: string, target: string, recursive: boolean): void => {
    const node = files.lstat(source);
    if (node === undefined) throw fsError("ENOENT", "cp", source);
    if (node.kind === "dir") {
      if (!recursive) throw fsError("EISDIR", "cp", source);
      files.mkdirp(target);
      for (const name of files.list(source)) copy(`${source}/${name}`, `${target}/${name}`, true);
    } else if (node.kind === "symlink") {
      files.symlink(files.readlink(source), target);
    } else {
      files.write(target, files.read(source), node.mode);
    }
  };

  const isNull = (path: string) => normalize(path) === DEV_NULL;

  return {
    async readFile(path, options) {
      return isNull(path) ? "" : decode(files.read(path), encodingOf(options));
    },
    async readFileBuffer(path) {
      return isNull(path) ? new Uint8Array() : files.read(path);
    },
    async writeFile(path, content, options) {
      const target = normalize(path);
      if (target === DEV_NULL) return;
      refuseGit("open", target);
      files.mkdirp(parentOf(target));
      files.write(target, encode(content, encodingOf(options)));
    },
    async appendFile(path, content, options) {
      const target = normalize(path);
      if (target === DEV_NULL) return;
      refuseGit("open", target);
      files.mkdirp(parentOf(target));
      const before = files.lstat(target) === undefined ? new Uint8Array() : files.read(target);
      const added = encode(content, encodingOf(options));
      const out = new Uint8Array(before.length + added.length);
      out.set(before);
      out.set(added, before.length);
      files.write(target, out);
    },
    async exists(path) {
      if (isNull(path)) return true;
      try {
        files.stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async stat(path) {
      return isNull(path) ? NULL_STAT : statOf(files.stat(path));
    },
    async lstat(path) {
      if (isNull(path)) return NULL_STAT;
      const node = files.lstat(path);
      if (node === undefined) throw fsError("ENOENT", "lstat", normalize(path));
      return statOf(node);
    },
    async mkdir(path, options) {
      refuseGit("mkdir", path);
      if (options?.recursive === true) files.mkdirp(path);
      else files.mkdir(path);
    },
    async readdir(path) {
      return files.list(path);
    },
    async rm(path, options) {
      const target = normalize(path);
      refuseGit("rm", target);
      const node = files.lstat(target);
      if (node === undefined) {
        if (options?.force === true) return;
        throw fsError("ENOENT", "rm", target);
      }
      if (node.kind === "dir" && options?.recursive !== true) {
        if (files.list(target).length > 0) throw fsError("ENOTEMPTY", "rm", target);
      }
      // Removing a whole repository (its directory, `.git` with it) is allowed: nothing is left to corrupt.
      files.removeTree(target);
    },
    async cp(source, target, options) {
      refuseGit("cp", target);
      copy(normalize(source), normalize(target), options?.recursive === true);
    },
    async mv(source, target) {
      refuseGit("rename", source, target);
      files.rename(source, target);
    },
    resolvePath(base, path) {
      return resolvePath(base, path);
    },
    getAllPaths() {
      return files.paths();
    },
    async chmod(path, mode) {
      refuseGit("chmod", path);
      files.chmod(path, mode);
    },
    async symlink(target, linkPath) {
      refuseGit("symlink", linkPath);
      files.symlink(target, linkPath);
    },
    async link(existingPath, newPath) {
      // No hard links in SQL rows: a copy, which is what a reader of either name sees.
      refuseGit("link", newPath);
      copy(normalize(existingPath), normalize(newPath), false);
    },
    async readlink(path) {
      return files.readlink(path);
    },
    async realpath(path) {
      return files.realpath(path);
    },
    async utimes(path) {
      // Modification times are kept by writes; a `touch` of an existing file only needs it to exist.
      files.stat(path);
    },
  };
}
