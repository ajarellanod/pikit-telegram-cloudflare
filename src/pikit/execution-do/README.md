# execution-do

The agent's workspace and shell on Cloudflare, inside the conversation's Durable Object (SPEC §4.1,
C7). Its files live in the object's own SQLite; its shell is a bash interpreter written in TypeScript,
with `git`, `node` and `curl`. pi-durable's own `read`, `write`, `edit` and `bash` tools work on it unchanged.

- **Provides:** `execution` and `execution.shell` (one pi-durable `ExecutionEnv`, `env.ts`, whose files are the object's own namespace: `execution-do:<object id>`).
- **Requires:** nothing. **Optional:** `secrets`, for the GitHub token.
- **Target:** `durable`. On a server, use `execution-local`.
- **Installs to:** `src/pikit/execution-do/`.
- **npm dependencies:** `just-bash` 3.4.2, `isomorphic-git` 1.42.3, `quickjs-emscripten-core` and
  `@jitl/quickjs-wasmfile-release-sync` 0.32.0, `diff` 8.0.4, `@pikit/pi-adapter` (pinned with Pi),
  `typebox`.

```sh
pikit add execution-do tool-bash tool-read tool-write tool-edit
```

It belongs in the Durable Object's App (the default export of `pikit.config.ts`), not in the
Worker's. It reads the object from `WORKERS_HOST`, which `deployment-cloudflare` puts in the start
context, and refuses to start without it, or on an object without SQLite.

## What it does

- **Files in the object's SQL.** Every file, directory and symlink is a row of `execution_do_nodes`;
  a file's bytes are rows of `execution_do_chunks`, 1 MB each (a row holds at most 2 MB). They survive
  evictions and deploys, like everything the object stores. The agent works in `root` (`/work`);
  `/tmp` and the rest of the tree are the object's too.
- **A shell without processes.** [just-bash](https://github.com/vercel-labs/just-bash): pipes,
  redirections, loops, functions, and about 80 commands (`ls`, `cat`, `grep`, `sed`, `awk`, `find`,
  `sort`, `jq`, `diff`…). `npm`, `python`, `tar` and native binaries are not here.
- **`node`** (and `js`): JavaScript in QuickJS compiled to WebAssembly. `node -e CODE`, `node -p EXPR`,
  `node FILE`, or a script on stdin; `require("fs")` and `require("path")` over the workspace,
  `console`, `process.argv`, `process.env`, `process.exit`. No npm, no network.
- **`curl`**: just-bash's own, over the Worker's `fetch`. It carries no credential.
- **`git`**: isomorphic-git. `clone` (GitHub over HTTPS, latest commit only), `status`, `diff`, `add`,
  `commit -m` (takes every change, like `git add -A && git commit`), `log`, `push`, and `pr` (opens a
  pull request through GitHub's API: `git pr pikit/self/<topic> <title> [-b <body>]`).
- **pi-durable's output rules.** A command's output streams to pi-durable's `bash` tool, which keeps
  what it shows within its limits; past them, the whole output is also written to a file under `/tmp`
  (`spillPath`). A host's argv (`exec(["git", "status"])`) reaches the program unparsed.
- **No file watching.** `watch` answers `not_supported`: only the object changes its files. pi-durable's
  `ExecutionEnv` suite passes on everything else, in workerd too.

## The fences

They are code, not instructions to the model:

- **Only `git` changes files inside `.git`.** Pi's file tools, the shell and `node` get "permission
  denied" for any change there, a symlink pointing into it included. Deleting a whole repository
  (`rm -r repo`) is allowed.
- **Pushes go only to `git.pushRepositories`, on branches under `git.branchPrefix`** (`pikit/self/` by
  default): never to `main`. Those branches are the agent's own, so a push replaces what is there. A
  pull request is opened from such a branch, for a person to review.
- **The token never reaches the shell.** It is the secret named `git.tokenSecret` (`GITHUB_TOKEN`),
  read through `secrets` when `git` needs it, and sent only to github.com and api.github.com. It is
  also sent when cloning other public repositories, because GitHub rate-limits anonymous git traffic
  per IP and Cloudflare's are shared. Without it, clones are public and read-only. Use a fine-grained
  token scoped to the push repositories, and protect `main` with a ruleset.
- **A failed clone leaves nothing behind**, and a 429 or 5xx from GitHub is retried twice.

## Config

```ts
"execution-do": {
  root: "/work",                        // default: the working directory and HOME
  shell: { timeLimitSeconds: 25 },      // default
  node: { interruptBudget: 10_000, heapMegabytes: 32 }, // defaults
  git: {
    tokenSecret: "GITHUB_TOKEN",        // default
    pushRepositories: ["you/your-bot"], // default: none
    branchPrefix: "pikit/self/",        // default
  },
}
```

## On Cloudflare

Two settings in the Worker's `wrangler.jsonc`, besides the object's class in `new_sqlite_classes`.
`deployment-cloudflare`'s `wrangler.jsonc` has both; keep them if you write your own:

```jsonc
"compatibility_flags": ["nodejs_compat"],   // isomorphic-git uses Node's Buffer
"rules": [{ "type": "CompiledWasm", "globs": ["@jitl/quickjs-wasmfile-release-sync/wasm"], "fallthrough": true }]
```

The rule bundles QuickJS's WebAssembly as a compiled module (a Worker cannot compile WebAssembly at
run time). Wrangler's own rule matches only imports ending in `.wasm`, and this one is a package
export; without the rule, the build fails with `No loader is configured for ".wasm" files`.

**Bundle size.** In the workerd lane (`tests/workerd`, `bun run --cwd tests/workerd bundle`),
a conversation's object with storage-do, runtime-pi (pi-durable) and pi-durable's four tools is
980 KiB gzip with execution-do (4.0 MB uncompressed, of which QuickJS's WebAssembly is 503 KB,
226 KiB gzip). The budget is 10 MB compressed.

## Limits

Measured on Cloudflare's Free plan (September 2026), or documented:

- **CPU: 30 s per event** (a request, an alarm). Past it the object is reset; what was committed
  survives. A clone of a 30 MB repository took 5.9 s of CPU; `grep -rn` over it 0.7 s.
- **The shell's time limit is wall clock**, and in a Worker the clock does not move while code
  computes: it stops commands that wait on the network, not a loop. just-bash's own limits (commands,
  loop iterations) stop those, and `node`'s interrupt budget stops a script: about 1,150 interrupts
  per CPU second, so 10,000 is about 9 s.
- **Memory: about 128 MB per isolate**, shared with the app. `node`'s heap is capped
  (`heapMegabytes`), but many small allocations can still reset the object.
- **50 subrequests per event on Free** (10,000 on paid): a `curl` is one, a clone or a push two.
- **Output:** 4 MB per command, `curl` reads at most 4 MB and waits 20 s.
- **Storage:** 1 GB per object on Free, 10 GB on paid. Clones are shallow for that reason.
- **Git:** GitHub over HTTPS only; no `fetch`, `pull`, `merge` or `checkout` of another branch.

## Removing it

`pikit remove execution-do` refuses while a component requires `execution` or `execution.shell`
(the `tool-*` components). The files stay in each object's `execution_do_*` tables until the object is
deleted: they are your data.

## Tests

Copied with the component, they run in your project under `bun test`, over a double of a Durable
Object's storage (`node:sqlite`) and a fake GitHub reached through `fetch` (no network): Pi's
`ExecutionEnv` suite with a shell, the lifecycle suite, files in chunks surviving a restart, the
shell, `node` and its limits, `curl`, the `.git` fence, and `git` from clone to pull request with
every fence. pikit also runs the component in workerd on a real SQLite-backed Durable Object, with
Pi's own tools through the `tool-*` components (`tests/workerd`).
