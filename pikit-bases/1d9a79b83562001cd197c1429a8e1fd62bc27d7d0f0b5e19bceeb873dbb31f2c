/// <reference path="./wasm.d.ts" />
/**
 * `node` for the agent's shell: JavaScript in QuickJS compiled to WebAssembly (quickjs-emscripten's
 * release sync build). There is no Node here: no npm, no network, no processes. A script sees a small
 * Node-like surface: `console`, `process` (`argv`, `cwd()`, `env`, `exit()`), and `require("fs")` and
 * `require("path")` over the workspace, synchronous because the object's SQL is.
 *
 * - **Bundled, not compiled.** A Worker cannot compile WebAssembly at run time, so the module is
 *   imported and bundled as a compiled module (wrangler's default rule for `.wasm`), and handed to
 *   Emscripten ready. Under Bun (the tests) the same import is a file path, and Emscripten reads it.
 * - **A budget, not a clock.** In a Worker the clock does not move while code computes, so a time limit
 *   cannot stop `while (true) {}`. QuickJS calls an interrupt handler as it runs; a script is stopped
 *   after `interruptBudget` calls (measured on Cloudflare: about 1,150 per CPU second, so the default
 *   10,000 is about 9 s, under the object's 30 s of CPU per event, SPEC C4).
 * - **A heap limit.** Each run gets a fresh runtime of at most `heapBytes`: with the app and the shell in
 *   the same isolate (about 128 MB), more risks resetting the object. Many small allocations can still
 *   exhaust the isolate before the heap limit; that resets this conversation's object, and what was
 *   committed survives (K6).
 */

import releaseSync from "@jitl/quickjs-wasmfile-release-sync";
import wasm from "@jitl/quickjs-wasmfile-release-sync/wasm";
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSHandle, type QuickJSWASMModule, type VmFunctionImplementation } from "quickjs-emscripten-core";

export interface QuickJsLimits {
  /** Interrupt-handler calls before the script is stopped. */
  interruptBudget: number;
  heapBytes: number;
}

/** What a script reaches of the workspace: synchronous reads and writes. */
export interface ScriptIo {
  cwd: string;
  argv: string[];
  env: Record<string, string>;
  /** The file's bytes, or `undefined` when it is not a file. */
  read(path: string): Uint8Array | undefined;
  /** Throws (an `EPERM` inside `.git`) when the write is refused. */
  write(path: string, bytes: Uint8Array): void;
  /** A directory's names, or `undefined` when it is not a directory. */
  list(path: string): string[] | undefined;
}

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

let loading: Promise<QuickJSWASMModule> | undefined;
/** One compiled QuickJS per isolate, loaded the first time `node` runs. */
const quickjs = () =>
  (loading ??= newQuickJSWASMModuleFromVariant(wasm instanceof WebAssembly.Module ? newVariant(releaseSync, { wasmModule: wasm }) : releaseSync));

/** `path` and `fs`, written in the guest's JavaScript over `__host` (below). */
const PRELUDE = `
const __path = {
  sep: "/",
  normalize(p) { const out = []; for (const part of String(p).split("/")) { if (!part || part === ".") continue; if (part === "..") out.pop(); else out.push(part); } return (String(p).startsWith("/") ? "/" : "") + out.join("/"); },
  join(...parts) { return __path.normalize(parts.join("/")); },
  resolve(...parts) { let p = process.cwd(); for (const part of parts) p = String(part).startsWith("/") ? String(part) : p + "/" + part; return __path.normalize(p); },
  dirname(p) { const i = String(p).lastIndexOf("/"); return i <= 0 ? (i === 0 ? "/" : ".") : String(p).slice(0, i); },
  basename(p, ext) { let b = String(p).slice(String(p).lastIndexOf("/") + 1); if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; },
  extname(p) { const b = __path.basename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; },
  isAbsolute(p) { return String(p).startsWith("/"); },
};
const __missing = (p, syscall) => { const e = new Error("ENOENT: no such file or directory, " + syscall + " '" + p + "'"); e.code = "ENOENT"; return e; };
const __fs = {
  readFileSync(p) { const text = __host.read(__path.resolve(p)); if (text === undefined) throw __missing(p, "open"); return text; },
  writeFileSync(p, data) { __host.write(__path.resolve(p), String(data)); },
  appendFileSync(p, data) { const before = __host.read(__path.resolve(p)); __host.write(__path.resolve(p), (before ?? "") + String(data)); },
  existsSync(p) { return __host.read(__path.resolve(p)) !== undefined || __host.list(__path.resolve(p)) !== undefined; },
  readdirSync(p) { const names = __host.list(__path.resolve(p)); if (names === undefined) throw __missing(p, "scandir"); return names; },
  mkdirSync() {},
};
__fs.promises = { readFile: async (p) => __fs.readFileSync(p), writeFile: async (p, d) => __fs.writeFileSync(p, d), appendFile: async (p, d) => __fs.appendFileSync(p, d), readdir: async (p) => __fs.readdirSync(p) };
globalThis.require = (name) => {
  const id = String(name).replace(/^node:/, "");
  if (id === "fs") return __fs;
  if (id === "fs/promises") return __fs.promises;
  if (id === "path") return __path;
  const e = new Error("Cannot find module '" + name + "': only fs and path exist here, there is no npm"); e.code = "MODULE_NOT_FOUND"; throw e;
};
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;
`;

/** A thrown `process.exit`, to unwind the guest's stack. */
const EXIT = "__pikit_exit__";

/** Runs `code` as a script (not a module) in a fresh QuickJS runtime. */
export async function runScript(code: string, io: ScriptIo, limits: QuickJsLimits): Promise<ScriptResult> {
  const runtime = (await quickjs()).newRuntime();
  runtime.setMemoryLimit(limits.heapBytes);
  runtime.setMaxStackSize(1024 * 1024);
  let interrupts = 0;
  runtime.setInterruptHandler(() => ++interrupts > limits.interruptBudget);
  const vm = runtime.newContext();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const show = (handle: QuickJSHandle) => {
    const value = vm.dump(handle);
    return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
  };
  // A host function answers a handle, or `{ error }` to throw in the guest.
  const define = (target: QuickJSHandle, name: string, fn: VmFunctionImplementation<QuickJSHandle>) => {
    const handle = vm.newFunction(name, fn);
    vm.setProp(target, name, handle);
    handle.dispose();
  };
  const setObject = (target: QuickJSHandle, name: string, fill: (object: QuickJSHandle) => void) => {
    const object = vm.newObject();
    fill(object);
    vm.setProp(target, name, object);
    object.dispose();
  };

  try {
    setObject(vm.global, "__host", (host) => {
      define(host, "read", (path) => {
        const bytes = io.read(vm.getString(path));
        return bytes === undefined ? vm.undefined : vm.newString(decoder.decode(bytes));
      });
      define(host, "write", (path, data) => {
        try {
          io.write(vm.getString(path), encoder.encode(vm.getString(data)));
          return vm.undefined;
        } catch (error) {
          return { error: vm.newError(error instanceof Error ? error.message : String(error)) };
        }
      });
      define(host, "list", (path) => {
        const names = io.list(vm.getString(path));
        if (names === undefined) return vm.undefined;
        const array = vm.newArray();
        names.forEach((name, index) => {
          const value = vm.newString(name);
          vm.setProp(array, index, value);
          value.dispose();
        });
        return array;
      });
    });
    setObject(vm.global, "console", (console) => {
      for (const [name, sink] of [["log", stdout], ["info", stdout], ["debug", stdout], ["warn", stderr], ["error", stderr]] as const) {
        define(console, name, (...args) => {
          sink.push(`${args.map(show).join(" ")}\n`);
          return vm.undefined;
        });
      }
    });
    setObject(vm.global, "process", (process) => {
      const argv = vm.newArray();
      ["node", ...io.argv].forEach((arg, index) => {
        const value = vm.newString(arg);
        vm.setProp(argv, index, value);
        value.dispose();
      });
      vm.setProp(process, "argv", argv);
      argv.dispose();
      setObject(process, "env", (env) => {
        for (const [name, value] of Object.entries(io.env)) {
          const handle = vm.newString(value);
          vm.setProp(env, name, handle);
          handle.dispose();
        }
      });
      const platform = vm.newString("quickjs");
      vm.setProp(process, "platform", platform);
      platform.dispose();
      define(process, "cwd", () => vm.newString(io.cwd));
      define(process, "exit", (code) => {
        exitCode = code === undefined ? 0 : vm.getNumber(code);
        return { error: vm.newError(EXIT) };
      });
    });

    vm.unwrapResult(vm.evalCode(PRELUDE, "prelude.js")).dispose();
    const result = vm.evalCode(code, "script.js");
    if (result.error) {
      const error = vm.dump(result.error) as { name?: string; message?: string; stack?: string } | string;
      result.error.dispose();
      if (exitCode === undefined) {
        const text = typeof error === "string" ? error : `${error?.name ?? "Error"}: ${error?.message ?? ""}\n${error?.stack ?? ""}`;
        const stopped = interrupts > limits.interruptBudget ? "node: stopped: the script used its whole CPU budget\n" : "";
        stderr.push(`${stopped}${text.trimEnd()}\n`);
        exitCode = 1;
      }
    } else {
      result.value.dispose();
      // Promises the script left (`async` functions, `fs.promises`) settle now.
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        if (exitCode === undefined) {
          stderr.push(`${show(jobs.error)}\n`);
          exitCode = 1;
        }
        jobs.error.dispose();
      }
    }
  } catch (error) {
    if (exitCode === undefined) {
      stderr.push(`node: ${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 1;
    }
  } finally {
    vm.dispose();
    runtime.dispose();
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: exitCode ?? 0 };
}
