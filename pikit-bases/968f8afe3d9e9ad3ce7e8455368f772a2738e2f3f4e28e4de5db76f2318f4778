# tool-read

pi-durable's own `read` tool, for the agents that name it: it reads a text file (from a line, up to a number of lines) or an image, and truncates long files for the model.

- **Provides:** `agent.tool`, under the key `read`.
- **Requires:** `execution` (for example `execution-local`).
- **Optional:** `workspace` (for example `workspace-local`): each agent's own directory.
- **Targets:** `server` and `durable`: any target with an `execution` provider.
- **Installs to:** `src/pikit/tool-read/`.
- **npm dependencies:** `@pikit/pi-adapter` (pinned with Pi).

## What it does

An agent gets this tool only when it names it:

```ts
defineAgent({ name: "ops", model: "anthropic/claude-sonnet-4-6", tools: ["read"] })
```

pikit does not reimplement the tool; it is Pi's. The component decides only what Pi leaves open:
- the environment it works on, read when the tool runs: in a run, the agent's own `workspace` when
  one is installed (`workspace-local` gives each agent a directory); otherwise `execution`;
- its replay, written in its `index.ts`: `"safe"`: it only reads, so a run resumed after a crash reads again.

## Tests

`tool-read.test.ts` is copied with the component and runs in your project. It covers what this
component decides: the tool under its name, unchanged but for its replay, and what it needs
installed. What the tool does is pi-durable's, tested there.

`component.json` is generated from `setup` by `pikit registry generate` and is not written by hand;
the test "what setup declares" pins it.
