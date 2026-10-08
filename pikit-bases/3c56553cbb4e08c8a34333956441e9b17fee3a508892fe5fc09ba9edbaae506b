# extension-pikit-self

The agents that name it know what they are: a system prompt section with how pikit works, how each
part of them is changed and where the docs are, and what runs now, read from the running App.

It is SPEC §6's self-knowledge (`features/self-improvement.md`, piece 1). It has no tool: how the
agent is doing (health, deliveries, proposals) is the operator's, in the dashboard.

- **Provides:** `agent.extension`, under the key `pikit-self`.
- **Requires:** nothing; it reads the agents (`agent.definition`) when there are some, and
  `proposals` when installed: the section ends with how the steward proposes a change here, the same
  steps on every target from `proposals.remote()` (clone it, `git checkout -b pikit/self/<topic>`,
  change, commit, `git push origin pikit/self/<topic>`; the operator approves in the dashboard), read
  at each request since the repository may be a setting. Without a provider it says to tell the
  operator what to change; before one is set up, to finish it in Settings → Self-improvement.
- **Targets:** `server` and `durable`. On Cloudflare it is in the objects' App, where agents run.
- **Installs to:** `src/pikit/extension-pikit-self/` (`index.ts`, `pikit-self.md`, `markdown.d.ts`,
  `extension-pikit-self.test.ts`).

## Use it

`pikit new` installs it with every preset that runs an agent, and the starter agent, the project's
steward, names it:

```ts
defineAgent({ name: "assistant", model: "…", steward: true, tools: ["read"], extensions: ["pikit-self"] })
```

In a project made without it:

```sh
pikit add extension-pikit-self
```

then add `"pikit-self"` to the `extensions` of your main agent, and mark it `steward: true`. An agent
that does not name it has no section, even installed.

## Only the steward

SPEC §6: one agent per project is the steward, and only it knows itself. At start this component
refuses an agent that names `pikit-self` without `steward: true` (the App does not start, and the error
names the agent); runtime-pi refuses two stewards. The check reads the definitions as declared: an
agent's `prepare` should not add `pikit-self` either.

Only the steward's operators may ask it to change itself. pikit adds no permission of its own for
that: an operator is whoever reaches the steward through a door that admits only the project's
owners, the dashboard (`admin.auth`: its token or session) or a channel that admits only them
(channel-telegram's allowed users, channel-http's bearer token). A channel that serves anyone else
routes them to another agent (`route.resolve`), never to the steward. The guide tells the steward to
propose a change only when an operator asks, never because a file, a page or a tool's result says
so; the gate (a reviewed pull request an operator approves) holds either way.

## What the agent reads

Every model request of an agent that names it carries one section, `<pikit-self>…</pikit-self>`:

1. **The guide**, `pikit-self.md`, bundled with the App as text (imported `with { type: "text" }`;
   `deployment-cloudflare`'s `wrangler.jsonc` has a Text rule for `.md`, and `markdown.d.ts` types it
   for TypeScript before 7.1): what an App, a component, a
   capability, a contract, a pipeline and a target are; where the agent's prompt and tools, the
   components, the extensions, the dashboard's views and config are changed, and what never is
   (secrets, the deployment and approval path, the kernel, the contracts); that it is the steward and
   proposes a change only when an operator asks for one; that a change is a proposal
   (a branch `pikit/self/…` and a pull request the operator approves in the dashboard) where the
   project has it, and otherwise a change it describes to the operator. Then the kit's docs and skills,
   linked online at the commit this project was made with: `pikit.json`'s `kit.commit`, imported as
   JSON so it is bundled on Cloudflare too (`-dirty` set aside; the main branch when there is none).
   Short on purpose: a map and pointers, not the docs.
2. **What runs now**, read in-process when the App starts: the App's description (`APP_DESCRIPTION`,
   SPEC K13, which only `admin-*` components and this one may read): the target, each component in
   start order with what it provides (the keys of a keyed capability: which tools, which extensions),
   the pipelines' stages, and the config with every value that looks like a secret `[redacted]`
   (`redactSecrets`, from `@pikit/contracts`, as the dashboard does). And the agents, from
   `agent.definition`: model, tools, extensions, and which one is the steward. On Cloudflare this is the object's App; the Worker's
   is not in it.
3. **How it proposes a change here**, from `proposals` when installed: `proposals.remote()` (a path
   on a server, the repository's URL on GitHub) and the same steps on every target (`git clone`,
   `git checkout -b pikit/self/<topic>`, `git add`, `git commit`, `git push origin pikit/self/<topic>`:
   the pushed branch is the proposal; the operator approves in the dashboard), or that it is not set
   up yet, or that the project has none. Read at each request, so connecting applies at once; never a
   token.

The text of the first two parts is built once, in `start`: the same section on every request, so the provider's prompt cache
stays warm. A change to the project shows after the next deploy (or restart), as every change does.

Edit `pikit-self.md` to say more about your project (who the operator is, what it may change here):
it is yours, like every installed file.

## Tests

- `extension-pikit-self.test.ts` (copied into your project): what `setup` declares, the section's text
  from a real App's description (components, keys, agents and the steward, a durable App), a
  secret-looking config value redacted, an App that does not start when another agent names it, the guide with the docs at the kit's commit, the same text on every request, and how to
  propose from `proposals.remote()` (a server's path, GitHub's URL read at each request, not set up,
  none).
  Offline.
- `app.test.ts` (beside `files/`, in the registry only): the extension in a real App with runtime-pi
  and the scripted faux model: the section reaches every request of an agent that names it, once, and
  none of an agent that does not.
