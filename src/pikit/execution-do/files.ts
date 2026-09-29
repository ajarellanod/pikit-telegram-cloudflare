/**
 * The workspace's filesystem, in the Durable Object's own SQLite (SPEC §4.1, C7).
 *
 * Every file, directory and symlink is a row of `execution_do_nodes`, keyed by its absolute path;
 * a file's bytes are rows of `execution_do_chunks`, 1 MB each, because a row of a Durable Object's SQL
 * holds at most 2 MB. Everything is synchronous, because the object's SQL is: the shell's globbing,
 * and JavaScript run in QuickJS (which cannot await), read it directly.
 *
 * Errors carry Node's codes and messages (`ENOENT: no such file or directory, open '/work/x'`), which
 * is what isomorphic-git and just-bash expect of a filesystem.
 */

/** What this component uses of a `DurableObjectStorage` (Cloudflare's type, written structurally). */
export interface DurableObjectFilesStorage {
  sql: { exec(query: string, ...bindings: (string | number | null | ArrayBuffer)[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(closure: () => T): T;
}

export type Kind = "file" | "dir" | "symlink";

/** One path's row: what `lstat` describes. */
export interface Node {
  kind: Kind;
  mode: number;
  size: number;
  mtime: number;
  /** A symlink's target, as written. */
  target: string | null;
}

/** An error with Node's `code`, as a filesystem throws it. */
export type FsError = Error & { code: string };

export const CHUNK_BYTES = 1024 * 1024;
const FILE_MODE = 0o100644;
const DIR_MODE = 0o40755;
const LINK_MODE = 0o120777;
const ROOT: Node = { kind: "dir", mode: DIR_MODE, size: 0, mtime: 0, target: null };
const DESCRIPTIONS: Record<string, string> = {
  ENOENT: "no such file or directory",
  EEXIST: "file already exists",
  ENOTDIR: "not a directory",
  EISDIR: "illegal operation on a directory",
  ENOTEMPTY: "directory not empty",
  EPERM: "operation not permitted",
  ELOOP: "too many symbolic links encountered",
  EINVAL: "invalid argument",
};

export function fsError(code: string, syscall: string, path: string, detail?: string): FsError {
  return Object.assign(new Error(`${code}: ${detail ?? DESCRIPTIONS[code] ?? code}, ${syscall} '${path}'`), { code });
}

/** `path` absolute and clean: no `.`, `..`, doubled or trailing slashes. */
export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** `path` against `base` when relative. */
export const resolvePath = (base: string, path: string) => normalize(path.startsWith("/") ? path : `${base}/${path}`);

export const parentOf = (path: string) => normalize(path.slice(0, path.lastIndexOf("/")) || "/");

export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1) || "/";

/**
 * Whether `path` is inside a repository's `.git`. Only `git` changes those files (C7): the agent's
 * shell and file tools read them, and are refused a write.
 */
export const insideGit = (path: string) => normalize(path).split("/").includes(".git");

/** The rows under `path` (not `path` itself), as a range: LIKE fails on long patterns in a Durable Object. */
const under = (path: string): [string, string] => (path === "/" ? ["/", "0"] : [`${path}/`, `${path}0`]);

export type Files = ReturnType<typeof createFiles>;

/**
 * The filesystem over the storage `open` returns: the object's, once the app has started (`open`
 * throws before). `migrate` creates its tables.
 */
export function createFiles(open: () => DurableObjectFilesStorage) {
  const sql = { exec: (query: string, ...bindings: (string | number | null | ArrayBuffer)[]) => open().sql.exec(query, ...bindings) };
  const storage = { transactionSync: <T>(closure: () => T): T => open().transactionSync(closure) };

  const row = (path: string): Node | undefined =>
    path === "/" ? ROOT : (sql.exec("SELECT kind, mode, size, mtime, target FROM execution_do_nodes WHERE path = ?", path).toArray()[0] as Node | undefined);

  /** `path` with its symlinks followed (a missing last part is kept as it is). */
  const follow = (path: string, syscall: string, hops = 0): string => {
    const node = row(path);
    if (node?.kind !== "symlink" || node.target === null) return path;
    if (hops >= 32) throw fsError("ELOOP", syscall, path);
    return follow(resolvePath(parentOf(path), node.target), syscall, hops + 1);
  };

  const requireDir = (path: string, syscall: string) => {
    const node = row(path);
    if (node === undefined) throw fsError("ENOENT", syscall, path);
    if (node.kind !== "dir") throw fsError("ENOTDIR", syscall, path);
  };

  /**
   * Modification times never repeat: in a Worker the clock does not move while code computes, and git
   * takes a file whose size and time did not change for unchanged (its index compares them).
   */
  let last = 0;
  const now = () => (last = Math.max(Date.now(), last + 1));

  const insertNode = (path: string, kind: Kind, mode: number, size: number, target: string | null = null) =>
    sql.exec(
      "INSERT INTO execution_do_nodes VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET kind = excluded.kind, mode = excluded.mode, size = excluded.size, mtime = excluded.mtime, target = excluded.target",
      path,
      parentOf(path),
      kind,
      mode,
      size,
      now(),
      target,
    );

  /** Deletes `path` and everything under it; the caller holds the transaction. */
  const deleteTree = (path: string) => {
    const [from, to] = under(path);
    sql.exec("DELETE FROM execution_do_chunks WHERE path = ? OR (path >= ? AND path < ?)", path, from, to);
    sql.exec("DELETE FROM execution_do_nodes WHERE (path = ? OR (path >= ? AND path < ?)) AND path != '/'", path, from, to);
  };

  const files = {
    /** Creates the tables, when this object has none yet. */
    migrate(): void {
      sql.exec(
        "CREATE TABLE IF NOT EXISTS execution_do_nodes (path TEXT PRIMARY KEY, parent TEXT NOT NULL, kind TEXT NOT NULL, mode INTEGER NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, target TEXT)",
      );
      sql.exec("CREATE INDEX IF NOT EXISTS execution_do_nodes_parent ON execution_do_nodes (parent)");
      sql.exec("CREATE TABLE IF NOT EXISTS execution_do_chunks (path TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (path, seq))");
    },

    /** `path`'s row, without following a symlink; `undefined` when nothing is there. */
    lstat: (path: string): Node | undefined => row(normalize(path)),

    /** `path`'s row, following symlinks. */
    stat(path: string): Node {
      const p = normalize(path);
      const node = row(follow(p, "stat"));
      if (node === undefined) throw fsError("ENOENT", "stat", p);
      return node;
    },

    read(path: string): Uint8Array {
      const p = follow(normalize(path), "open");
      const node = row(p);
      if (node === undefined) throw fsError("ENOENT", "open", normalize(path));
      if (node.kind === "dir") throw fsError("EISDIR", "read", normalize(path));
      const out = new Uint8Array(node.size);
      let offset = 0;
      for (const chunk of sql.exec("SELECT data FROM execution_do_chunks WHERE path = ? ORDER BY seq", p).toArray()) {
        const bytes = new Uint8Array(chunk.data as ArrayBuffer);
        out.set(bytes, offset);
        offset += bytes.length;
      }
      return out;
    },

    /** Creates or replaces a file; its directory must exist. */
    write(path: string, bytes: Uint8Array, mode?: number): void {
      const p = follow(normalize(path), "open");
      requireDir(parentOf(p), "open");
      const existing = row(p);
      if (existing?.kind === "dir") throw fsError("EISDIR", "open", p);
      storage.transactionSync(() => {
        insertNode(p, "file", mode ?? existing?.mode ?? FILE_MODE, bytes.length);
        sql.exec("DELETE FROM execution_do_chunks WHERE path = ?", p);
        for (let seq = 0, at = 0; at < bytes.length || seq === 0; seq++, at += CHUNK_BYTES) {
          // A copy of exactly this chunk: a Node Buffer's slice() is a view, and its .buffer the whole
          // memory under it (isomorphic-git passes Buffers).
          sql.exec("INSERT INTO execution_do_chunks VALUES (?, ?, ?)", p, seq, new Uint8Array(bytes.subarray(at, at + CHUNK_BYTES)).buffer);
        }
      });
    },

    mkdir(path: string): void {
      const p = normalize(path);
      if (row(p) !== undefined) throw fsError("EEXIST", "mkdir", p);
      requireDir(parentOf(p), "mkdir");
      insertNode(p, "dir", DIR_MODE, 0);
    },

    /** `path` and its missing parents; nothing when it is already a directory. */
    mkdirp(path: string): void {
      const p = normalize(path);
      const node = row(follow(p, "mkdir"));
      if (node?.kind === "dir") return;
      if (node !== undefined) throw fsError("EEXIST", "mkdir", p);
      files.mkdirp(parentOf(p));
      insertNode(p, "dir", DIR_MODE, 0);
    },

    /** The names in a directory, sorted. */
    list(path: string): string[] {
      const p = follow(normalize(path), "scandir");
      requireDir(p, "scandir");
      return sql
        .exec("SELECT path FROM execution_do_nodes WHERE parent = ? AND path != '/' ORDER BY path", p)
        .toArray()
        .map((entry) => nameOf(entry.path as string));
    },

    unlink(path: string): void {
      const p = normalize(path);
      const node = row(p);
      if (node === undefined) throw fsError("ENOENT", "unlink", p);
      if (node.kind === "dir") throw fsError("EISDIR", "unlink", p);
      storage.transactionSync(() => {
        sql.exec("DELETE FROM execution_do_chunks WHERE path = ?", p);
        sql.exec("DELETE FROM execution_do_nodes WHERE path = ?", p);
      });
    },

    rmdir(path: string): void {
      const p = normalize(path);
      requireDir(p, "rmdir");
      if (p === "/") throw fsError("EPERM", "rmdir", p);
      if (sql.exec("SELECT 1 FROM execution_do_nodes WHERE parent = ? LIMIT 1", p).toArray().length > 0) throw fsError("ENOTEMPTY", "rmdir", p);
      sql.exec("DELETE FROM execution_do_nodes WHERE path = ?", p);
    },

    /** Removes `path` and everything under it, in one transaction. A missing path is not an error. */
    removeTree(path: string): void {
      const p = normalize(path);
      storage.transactionSync(() => deleteTree(p));
    },

    /**
     * Moves a file, a symlink or a whole directory to `to`, replacing a file there, in one
     * transaction: rows are renamed, no byte is copied.
     */
    rename(from: string, to: string): void {
      const source = normalize(from);
      const target = normalize(to);
      if (source === target) return;
      const node = row(source);
      if (node === undefined || source === "/") throw fsError("ENOENT", "rename", source);
      requireDir(parentOf(target), "rename");
      if (target.startsWith(`${source}/`)) throw fsError("EINVAL", "rename", source);
      const existing = row(target);
      if (existing?.kind === "dir") {
        if (node.kind !== "dir") throw fsError("EISDIR", "rename", target);
        if (sql.exec("SELECT 1 FROM execution_do_nodes WHERE parent = ? LIMIT 1", target).toArray().length > 0) throw fsError("ENOTEMPTY", "rename", target);
      } else if (existing !== undefined && node.kind === "dir") {
        throw fsError("ENOTDIR", "rename", target);
      }
      const [from0, to0] = under(source);
      const cut = source.length + 1;
      storage.transactionSync(() => {
        if (existing !== undefined) deleteTree(target);
        sql.exec("UPDATE execution_do_nodes SET path = ?, parent = ?, mtime = ? WHERE path = ?", target, parentOf(target), now(), source);
        sql.exec("UPDATE execution_do_chunks SET path = ? WHERE path = ?", target, source);
        // Everything under a directory moves with it: its paths and parents change prefix.
        sql.exec(
          "UPDATE execution_do_nodes SET path = ? || substr(path, ?), parent = ? || substr(parent, ?) WHERE path >= ? AND path < ?",
          target,
          cut,
          target,
          cut,
          from0,
          to0,
        );
        sql.exec("UPDATE execution_do_chunks SET path = ? || substr(path, ?) WHERE path >= ? AND path < ?", target, cut, from0, to0);
      });
    },

    symlink(target: string, path: string): void {
      const p = normalize(path);
      if (row(p) !== undefined) throw fsError("EEXIST", "symlink", p);
      requireDir(parentOf(p), "symlink");
      insertNode(p, "symlink", LINK_MODE, target.length, target);
    },

    readlink(path: string): string {
      const p = normalize(path);
      const node = row(p);
      if (node === undefined) throw fsError("ENOENT", "readlink", p);
      if (node.kind !== "symlink" || node.target === null) throw fsError("EINVAL", "readlink", p);
      return node.target;
    },

    chmod(path: string, mode: number): void {
      const p = follow(normalize(path), "chmod");
      const node = row(p);
      if (node === undefined) throw fsError("ENOENT", "chmod", p);
      // The kind's bits stay; only the permission bits change.
      sql.exec("UPDATE execution_do_nodes SET mode = ? WHERE path = ?", (node.mode & ~0o7777) | (mode & 0o7777), p);
    },

    /** `path` with the symlinks of every part that exists followed; missing parts are kept. */
    canonical(path: string): string {
      let resolved = "/";
      for (const part of normalize(path).split("/").filter(Boolean)) resolved = follow(normalize(`${resolved}/${part}`), "open");
      return resolved;
    },

    /**
     * Throws `EPERM` when changing any of `paths` would change a file inside a `.git`, through a
     * symlink too (a cloned repository may hold one pointing into its `.git`). The shell, Pi's file
     * tools and `node` call it before every change; `git` does not.
     */
    refuseGit(syscall: string, ...paths: string[]): void {
      for (const path of paths) {
        if (insideGit(path) || insideGit(files.canonical(path))) {
          throw fsError("EPERM", syscall, normalize(path), "files inside .git change only through git");
        }
      }
    },

    /** The canonical path of an existing `path`. */
    realpath(path: string): string {
      const resolved = files.canonical(path);
      if (row(resolved) === undefined) throw fsError("ENOENT", "realpath", normalize(path));
      return resolved;
    },

    /** Every path, sorted: what the shell's globbing and `find` walk. */
    paths: (): string[] => ["/", ...sql.exec("SELECT path FROM execution_do_nodes ORDER BY path").toArray().map((entry) => entry.path as string)],

    /** How much the workspace takes in the object: its files and their bytes. */
    usage: () => sql.exec("SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM execution_do_nodes WHERE kind = 'file'").toArray()[0] as { files: number; bytes: number },
  };
  return files;
}
