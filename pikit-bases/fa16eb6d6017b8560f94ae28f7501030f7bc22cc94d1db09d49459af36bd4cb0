# tool-write

pi-durable's own `write` tool, for the agents that name it: it creates or overwrites a file, creating its parent directories.

- **Provides:** `agent.tool`, under the key `write`.
- **Requires:** `execution` (for example `execution-local`).
- **Optional:** `workspace` (for example `workspace-local`): each agent's own directory.
- **Targets:** `server` and `durable`: any target with an `execution` provider.
- **Installs to:** `src/pikit/tool-write/`.
- **npm dependencies:** `@pikit/pi-adapter` (pinned with Pi).

## What it does

An agent gets this tool only when it names it:

```ts
defineAgent({ name: "ops", model: "anthropic/claude-sonnet-4-6", tools: ["write"] })
```

pikit does not reimplement the tool; it is Pi's. The component decides only what Pi leaves open:
- the environment it works on, read when the tool runs: in a run, the agent's own `workspace` when
  one is installed (`workspace-local` gives each agent a directory); otherwise `execution`;
- its replay, written in its `index.ts`: `"unsafe"`: it changes files, so after a crash pi-durable reports the call as interrupted and the model decides whether to write again.

## Tests

`tool-write.test.ts` is copied with the component and runs in your project. It covers what this
component decides: the tool under its name, unchanged but for its replay, and what it needs
installed. What the tool does is pi-durable's, tested there.

`component.json` is generated from `setup` by `pikit registry generate` and is not written by hand;
the test "what setup declares" pins it.
