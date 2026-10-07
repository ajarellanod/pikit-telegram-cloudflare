---
name: pikit-extension
description: Add agent behaviour to a pikit assistant as an agent extension (`agent.extension`): system prompt sections, hooks on model requests, tool calls and compaction, tool wrappers, documents and tools, selected by the agents that name it. Use when the user wants the agent to know something in every request (rules, a persona, memories), to check or rewrite tool calls or model requests, or to keep per-conversation state, and when building a feature whose design note says "extension".
---

# Write an agent extension

What an agent does besides its model, prompt and tools is a Pi extension (pi-durable's
`defineExtension`), provided by a component under the keyed capability `agent.extension` and run
only by the agents that name it. Read `.agents/skills/pikit-component/SKILL.md` first: an extension
component is a component, with the same rules (synchronous `setup`, resources in `start`, config holds
values, tests ship with it). `https://github.com/ajarellanod/pikit/tree/faa544dd2182d556936d7d0ef296e4962ece5bb8` below is the pikit repository (the kit) on this machine
(https://github.com/ajarellanod/pikit/tree/faa544dd2182d556936d7d0ef296e4962ece5bb8 online), as that skill says.

**Reference:** `extension-house-rules` (a section from config, a `beforeTool` hook): `pikit add
extension-house-rules --yes` to read it in `src/pikit/extension-house-rules/`, its README "How this
extension is built". **A real App test:** `src/pikit/runtime-pi/extensions.test.ts` (a section that reads a
document a tool wrote, a hook that blocks `bash`, another that rewrites requests, per-agent selection,
state across a restart).

## 0. Extension, tool, or `prepare`?

| You want | Write |
|---|---|
| One more thing the model can call | a tool component (`pikit-component`, reference `tool-fetch`) |
| Switch model, prompt, tools or extensions with the conversation's state (a mode, a phase) | the agent's `prepare(state)` in `src/agents/<agent>/agent.ts`: pure and synchronous. The definition owns the conversation's agent (SPEC §6): the runtime rebuilds it from `prepare` at each admission and state update, so nothing else changes it live |
| Text in every request (rules, a persona, recalled memories), possibly read from a store | an extension's **section** |
| See or change each model request or answer, each tool call or result, a compaction | an extension's **hook** |
| Decorate a tool or a section someone else provides | an extension's **wrap** |
| Tools that belong with that behaviour (`remember` with memory's section) | the extension's **tools** |

## 1. The pieces

Import everything from `@pikit/pi-adapter/extensions`, never from `@earendil-works/*`:

```ts
import {
  CompactionTask, ConversationDoc, defineDoc, defineExtension, defineTask, defineTool,
  GenerationTask, hook, section, ToolTask, wrapSection, wrapTool,
  type Extension, type PromptInput, type ToolExecutionApi,
} from "@pikit/pi-adapter/extensions";
import Type from "typebox";

defineExtension({
  name: "my-thing",                      // what agents name, and its key under agent.extension
  sections: [section("my-thing", async (input, context) => "text, or undefined to leave it out")],
  hooks: [
    hook(GenerationTask, {
      beforeRequest: ({ messages }, api, context) => ({ messages }),          // this request only; undefined: unchanged
      afterResponse: (message, api, context) => {},                          // every terminal provider message
      onYield: (answer, api, context) => undefined,                          // { continue: "user text" } runs one more turn
      afterTools: (assistant, results, api, context) => {},                  // a round's tools are all done
    }),
    hook(ToolTask, {
      beforeTool: (call, api, context) => undefined,  // { block: "reason" } refuses; { arguments } rewrites; a throw blocks
      afterTool: (call, result, api, context) => result,                     // replaces the result
    }),
    hook(CompactionTask, { beforeCompact: (compaction, api, context) => undefined }), // { decline: true } or { summary }
  ],
  tools: [/* defineTool({ name, description, parameters: Type.Object({…}), replay, execute }) */],
  wraps: [/* wrapTool(tool, (t) => ({ ...t, execute: … })), wrapSection("key", (s) => s) */],
  tasks: [/* defineTask(…): durable work of its own, pi-durable README "Child Tasks" */],
});
```

- **A section** renders before every model request, in the order the agent's extensions are named,
  wrapped as `<key>\n…\n</key>` (`section(key, render, { tag: false })` for bare text). It may be
  async. A section that throws keeps the text it showed last, and the run goes on.
- **Which conversation:** a section gets `input.conversationId` (pi-durable's) and `input.read`; a
  hook gets `api.conversationId` and `api` as a reader. The conversation's key and agent are its
  `ConversationDoc`: `await input.read.snapshot(ConversationDoc, input.conversationId, context)` (in a
  hook, `api.snapshot(…)`), `{ key, agent }`, or `undefined`. A tool reads `CONVERSATION` (the whole
  `ConversationRef`) and `AGENT_STATE` from its context: `context.value(CONVERSATION)`, from
  `@pikit/contracts`.
- **The extension's own state, per conversation:** a document, committed with the transcript, so it
  survives crashes and is reset with the conversation:

  ```ts
  const Notes = defineDoc<{ items: string[] }>({
    kind: "my-thing.notes", version: 1, scope: "conversation", history: "latest", fork: "current",
    initial: () => ({ items: [] }),
  });
  // in a tool:     await api.commit(async (tx) => void (await tx.doc(Notes, api.conversationId)).items.push(x), context);
  // in a section:  const notes = await input.read.snapshot(Notes, input.conversationId, context); // undefined: never written
  ```

  Hooks only read documents (`api.snapshot`); they keep a value per task with
  `api.memo(name, candidate, context)`. State shared across conversations (a person's memory, a
  project's settings) is not a document: it is a capability of yours (`storage.sql`, or an actor
  per owner reached with `actor.mailbox`'s `call`, as `https://github.com/ajarellanod/pikit/tree/faa544dd2182d556936d7d0ef296e4962ece5bb8/features/memory.md` does).
- **Using a capability inside a section, hook or tool:** they get a Chord context, and capabilities
  take an `AppContext`. Keep the App's context from `start` without its cancellation, and put the
  call's context under it:

  ```ts
  setup(pikit) {
    const store = pikit.use("my.store");
    let app: AppContext | undefined;
    const within = (context: Context): AppContext => {
      if (app === undefined) throw new Error("my-thing: used while the App is not running");
      return app.derive(() => context);       // the call's values and cancellation, the App's logger and clock
    };
    // … section(…, async (input, context) => (await store.get().read(…, within(context))).text)
    return { start: (ctx) => void (app = ctx.derive(() => BACKGROUND_CONTEXT)), stop: () => void (app = undefined) };
  }
  ```

## 2. Provide it, and name it

```ts
export default defineComponent({
  name: "extension-my-thing",            // kind `extension-`; or your feature's own kind, declared (pikit-component)
  config: Config,
  setup(pikit, config) {
    pikit.provideKeyed("agent.extension", "my-thing", createMyThing(config));
  },
});
```

In the agent (`src/agents/<agent>/agent.ts`): `defineAgent({ …, extensions: ["my-thing"] })`. Only
the agents that name it run with it, in the order named; agents that share extensions share a list
(`extensions: [...shared, "plan-mode"]`); `prepare(state)` may change the list per run. A later
extension's tool replaces an earlier one, or one of `tools`, of the same name. runtime-pi refuses to
start when an agent names an extension nobody provides, when the key and the extension's `name`
differ, or when the name starts with `pikit.` (the runtime's own). `pikit doctor` lists
`agent.extension: my-thing → extension-my-thing` and says when an agent names a missing one.

## 3. Pitfalls

- **Prompt caching.** pi-durable sends a section again only when its text changes, which keeps the
  provider's prompt cache warm. A section that changes on every request (the time, a search over the
  newest message, a random order) defeats it and appends a system message each time: render from
  config once, or from stored data in a stable order; put per-message lookups in a tool.
- **Replay.** pi-durable records a tool call's intent before `execute` and, after a crash, runs it
  again only if its `replay` is `"safe"`; otherwise the model gets an `interrupted` error. A tool
  with an effect is `"unsafe"`, unless the effect is idempotent by `${api.conversationId}:${api.callId}`
  (the same on the rerun), which makes `"safe"` correct. Hooks and sections may also run again
  (recovery, a retried request): they decide from their input, have no effect of their own, or key
  what they write so a second run changes nothing.
- **Names.** A tool's name is what the model calls (`^[A-Za-z][A-Za-z0-9_-]*$`), unique across the
  agent's tools and extensions unless you mean to replace one. Document kinds and section keys carry
  your extension's name (`my-thing.notes`). `pikit.` is reserved.
- **Hooks are on the hot path.** `beforeRequest` and `beforeTool` run before every request and call;
  keep them fast, and never call a model from one (start a `defineTask` instead).
- **`beforeRequest` changes one request only**; it does not rewrite the transcript. To change what
  the model knows from now on, use a section.
- **No state in closures.** A variable in `setup` dies with the process and is shared by every
  conversation; use a document or a capability.

## 4. Test it

The model in a real App is provider-faux's `faux/scripted` (`pikit add provider-faux --yes`; compose
`src/pikit/provider-faux/index.ts`, agents on `model: "faux/scripted"`), which needs no account:

- `call: <tool> <json>` makes it call that tool with those arguments; the turn after answers
  `<tool>: <result text>`, or `<tool> failed: <error text>`;
- `echo-system <section>` answers with that section as the request carried it (`<key>\n...\n</key>`),
  or `(no section <section>)`; `echo-system` alone, with the whole system prompt;
- `echo-tools` answers with the tools it was offered, sorted, or `(no tools)`;
- anything else answers `faux: <the message>`.

A run's answer is its `agent.settled` event's `text`: assert what your extension put in the prompt with
`echo-system <your section>`, and what a tool or hook did with `call:`. `sqliteStorage(path)`
(`@pikit/pi-adapter/testing`) is a `storage.sql` on a file, so a second App over the same path is a
restart. To see the requests themselves (how many system messages carried a section: "sent once"),
provide `scriptedProvider({ onRequest })` from `@pikit/pi-adapter/testing` under `faux` instead (the
same `call:` rule; it answers `answer: <message>`, `bash: <command>` calls `bash`): a request's
sections are its `system` messages' `sections` (a change per message; `null` removes one).
`recordingBash(ran)` is a `bash` that records instead of running.

1. **The component's own tests** (`files/src/pikit/<name>/<name>.test.ts`, copied with it): "what
   setup declares" (`provides: ["agent.extension"]`, `capabilities["agent.extension"].keys`), the
   extension's name, sections and hooks, the pure functions behind them (what the section says, what
   the hook decides), refused config. They cannot import another component's files (P4 in `https://github.com/ajarellanod/pikit/tree/faa544dd2182d556936d7d0ef296e4962ece5bb8/SPEC.md`).
2. **A real App** (in a project, a test of the project's own, `test/<name>.test.ts`, which may import
   `src/pikit/runtime-pi/index.ts`; in the pikit repository, `app.test.ts` beside `files/`): runtime-pi,
   your component, an agents component, provider-faux (`faux/scripted`) and `sqliteStorage(path)`.
   Copy the `start` / `ask` helpers of `src/pikit/runtime-pi/extensions.test.ts`. Prove: the section
   is what `echo-system <section>` answers for an agent that names it, and `(no section <section>)` for one
   that does not; a hook blocks or rewrites what it should and nothing else; a tool's effect is seen
   by the next request; what must survive does after `stop()` and a new App over the same file; a
   stable section is sent once (`scriptedProvider({ onRequest })`).
3. **End to end**, optional: `pikit add provider-faux --yes`, an agent on `faux/scripted`, `pikit
   dev`, and `call: <tool> <json>` / `echo-system <section>` through the real channel.

## 5. Done

`bun test` and `bun run typecheck` pass; `pikit registry generate` / `validate` are clean for your
registry; `pikit add --yes` then `pikit doctor` is green; an agent that names it behaves as designed
and one that does not is unchanged; `pikit remove <name>` (after taking the name out of the agents:
it refuses while one names it, and with `--force` doctor reports that agent until you do) leaves the
project as it was; its README says what it adds to the prompt, which calls it blocks or changes, what
it stores, and how it is tested (copy `extension-house-rules`' README).
