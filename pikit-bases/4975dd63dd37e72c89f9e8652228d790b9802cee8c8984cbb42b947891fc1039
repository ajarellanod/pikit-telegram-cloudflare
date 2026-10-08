/**
 * extension-pikit-self's tests. They are copied with the component and keep running in your project.
 *
 * The section is built from a real App's description (the components below stand in for yours) and
 * read offline: nothing here reaches the network. The same extension in an App run by runtime-pi is
 * `app.test.ts` beside `files/` in the registry (a component never imports another's files, SPEC P4).
 */

import { expect, test } from "bun:test";
import { defineApp, defineComponent, silentLogger } from "@pikit/core";
import { type AgentDefinition, defineAgent, type Proposals, type ProposalsRemote } from "@pikit/contracts";
import type { Extension } from "@pikit/pi-adapter/extensions";
import Type from "typebox";
import pikitSelf, { agentSummary, KIT_REPOSITORY, kitUrl, PIKIT_SELF, pikitSelfText, proposingText, stewardProblem } from "./index.ts";

const TELEGRAM_TOKEN = "123456789:AAEabcdefghijklmnopqrstuvwxyz012345";

const agents = (list: AgentDefinition[]) =>
  defineComponent({ name: "agents", setup: (pikit) => list.forEach((agent) => pikit.provideKeyed("agent.definition", agent.name, agent)) });

/** A tool provider whose config holds a value that looks like a secret, put there by mistake. */
const leaky = defineComponent({
  name: "tool-leaky",
  config: Type.Object({ botToken: Type.String(), tokenSecret: Type.String(), retries: Type.Integer() }),
  setup: (pikit) => pikit.provideKeyed("agent.tool", "leak", { name: "leak" } as never),
});

/** An App with the component, started; its `agent.extension` under `pikit-self`, and the section's text. */
async function sectionOf(list: AgentDefinition[], target: "server" | "durable" = "server", proposals?: Proposals) {
  let extension: Extension | undefined;
  const reader = defineComponent({
    name: "reader",
    setup(pikit) {
      const extensions = pikit.useKeyed("agent.extension");
      return { start: () => void (extension = extensions.get(PIKIT_SELF) as Extension | undefined) };
    },
  });
  const config = { "tool-leaky": { botToken: TELEGRAM_TOKEN, tokenSecret: "TELEGRAM_BOT_TOKEN", retries: 3 } };
  const provider = defineComponent({ name: "proposals-test", setup: (pikit) => void (proposals !== undefined && pikit.provide("proposals", proposals)) });
  const app = await defineApp({ components: [agents(list), leaky, provider, pikitSelf, reader], config, target, logger: silentLogger }).create();
  await app.start();
  const section = extension?.sections?.[0];
  const text = await section?.render({} as never, {} as never);
  await app.stop();
  return { app, extension, text: typeof text === "string" ? text : undefined };
}

const assistant = defineAgent({ name: "assistant", model: "faux/scripted", steward: true, tools: ["read", "leak"], extensions: [PIKIT_SELF] });

test("what setup declares: component.json's provides / requires / optional come from it", async () => {
  const { app } = await sectionOf([assistant]);

  expect(app.describe().components.find((component) => component.name === "extension-pikit-self")).toMatchObject({
    provides: ["agent.extension"],
    requires: [],
    optional: ["agent.definition", "proposals"],
  });
  expect(app.describe().capabilities["agent.extension"]?.keys).toEqual({ [PIKIT_SELF]: "extension-pikit-self" });
});

test("one extension named like its key, with one section and nothing else", async () => {
  const { extension } = await sectionOf([assistant]);

  expect(extension?.name).toBe(PIKIT_SELF);
  expect(extension?.sections?.map((section) => section.key)).toEqual([PIKIT_SELF]);
  expect(extension?.tools).toBeUndefined();
  expect(extension?.hooks).toBeUndefined();
});

test("the section says what runs: the target, each component and what it provides, the agents, the config", async () => {
  const { text } = await sectionOf([assistant, defineAgent({ name: "triage", model: "faux/echo" })]);

  expect(text).toContain("## What runs now\nTarget: server.");
  expect(text).toContain("Components, in start order, with what each provides:\n- agents: agent.definition (assistant, triage)\n- tool-leaky: agent.tool (leak)\n");
  expect(text).toContain("- extension-pikit-self: agent.extension (pikit-self)");
  expect(text).toContain("Agents:\n- assistant (the steward): model faux/scripted; tools read, leak; extensions pikit-self\n- triage: model faux/echo; tools none");
  expect(text).not.toContain("the Worker's App");
});

test("a config value that looks like a secret is redacted; a secret's name and the rest stay", async () => {
  const { text } = await sectionOf([assistant]);

  expect(text).not.toContain(TELEGRAM_TOKEN);
  expect(text).toContain('- tool-leaky: {"botToken":"[redacted]","tokenSecret":"TELEGRAM_BOT_TOKEN","retries":3}');
});

test("on Cloudflare it says it is the object's App", async () => {
  const { text } = await sectionOf([assistant], "durable");

  expect(text).toContain("Target: durable.\nThis is the App of each conversation's Durable Object; the Worker's App is not shown.");
});

test("the guide comes first: how each part is changed, and the docs at the kit's commit", () => {
  const text = pikitSelfText("abc1234-dirty", "## What runs now");
  const at = `${KIT_REPOSITORY}/tree/abc1234`;

  expect(text).toStartWith("You are an agent of a pikit project");
  expect(text).toContain("`src/agents/<agent>/agent.ts`");
  expect(text).toContain("`pikit/self/<topic>`");
  for (const doc of ["README", "concepts", "components", "contracts", "pipelines", "message-flow", "targets", "cli", "dashboard"]) {
    expect(text).toContain(`${at}/docs/${doc}.md`);
  }
  expect(text).toContain(`${at}/.agents/skills/`);
  expect(text).not.toContain("{{");
  expect(text).toEndWith("\n\n## What runs now");
  expect(kitUrl(undefined)).toBe(`${KIT_REPOSITORY}/tree/main`);
});

test("the section is the same text on every request: it is built once, when the App starts", async () => {
  const { extension } = await sectionOf([assistant]);
  const section = extension?.sections?.[0];

  expect(await section?.render({} as never, {} as never)).toBe(await section?.render({} as never, {} as never));
});

test("an agent is said by its model and the names of its tools, its own tool objects included", () => {
  expect(agentSummary("a", { model: "x/y", tools: ["read", { name: "mine" }, 3], extensions: ["memory"] })).toEqual({ name: "a", model: "x/y", tools: ["read", "mine"], extensions: ["memory"], steward: false });
  expect(agentSummary("b", undefined)).toEqual({ name: "b", model: "", tools: [], extensions: [], steward: false });
  expect(agentSummary("c", { model: "x/y", steward: true }).steward).toBe(true);
});

test("only the steward may name it: the App does not start with another agent that does", async () => {
  const helper = defineAgent({ name: "helper", model: "faux/scripted", extensions: [PIKIT_SELF] });
  const app = await defineApp({ components: [agents([assistant, helper]), pikitSelf], logger: silentLogger }).create();

  const error = await app.start().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(error instanceof Error ? String(error.cause instanceof Error ? error.cause.message : error.cause) : "started").toContain(
    'extension-pikit-self: agent "helper" names "pikit-self" and is not the steward',
  );
  expect(stewardProblem([agentSummary("assistant", assistant), agentSummary("triage", { model: "x/y" })])).toBeUndefined();
});

/** A `proposals` whose remote is `remote()`'s, read at each call; nothing else is asked. */
const proposalsAt = (remote: () => ProposalsRemote | undefined): Proposals => ({ remote: async () => remote() }) as unknown as Proposals;

test("how it proposes: the same steps from proposals' remote on every target, the path on a server, the repository's URL on Cloudflare", async () => {
  const local = await sectionOf([assistant], "server", proposalsAt(() => ({ kind: "path", path: "/app/.pikit/self/project.git", mainBranch: "main", branchPrefix: "pikit/self/" })));
  expect(local.text).toContain(
    [
      "## How you propose a change here",
      "With git in your shell, from /app/.pikit/self/project.git, never pushing main:",
      "1. `git clone /app/.pikit/self/project.git project`: a fresh clone for each change, so it starts from the latest main.",
      "2. `cd project && git checkout -b pikit/self/<topic>`, a short topic (`calendar-tool`).",
    ].join("\n"),
  );
  expect(local.text).toContain("5. `git push origin pikit/self/<topic>`: the pushed branch is the proposal");
  expect(local.text).toEndWith("rolled back if it is unhealthy.");

  // On Cloudflare the repository is a setting: the section reads it at each request.
  let repository: string | undefined;
  const github = proposalsAt(() => (repository === undefined ? undefined : { kind: "https", url: `https://github.com/${repository}.git`, mainBranch: "main", branchPrefix: "pikit/self/", authorization: async () => "Basic c2VjcmV0LXRva2Vu" }));
  let extension: Extension | undefined;
  const reader = defineComponent({
    name: "reader",
    setup(pikit) {
      const extensions = pikit.useKeyed("agent.extension");
      return { start: () => void (extension = extensions.get(PIKIT_SELF) as Extension | undefined) };
    },
  });
  const provider = defineComponent({ name: "proposals-test", setup: (pikit) => pikit.provide("proposals", github) });
  const app = await defineApp({ components: [agents([assistant]), provider, pikitSelf, reader], target: "durable", logger: silentLogger }).create();
  await app.start();
  const render = async () => String(await extension?.sections?.[0]?.render({} as never, {} as never));
  expect(await render()).toContain("Proposals are not set up yet: tell the operator to finish it in the dashboard's Settings → Self-improvement");
  repository = "ana/bot";
  const connected = await render();
  expect(connected).toContain("1. `git clone https://github.com/ana/bot.git project`");
  expect(connected).toContain("5. `git push origin pikit/self/<topic>`");
  expect(connected).not.toContain("Basic");
  await app.stop();
});

test("without proposals it says to tell the operator what to change", async () => {
  const { text } = await sectionOf([assistant]);
  expect(text).toEndWith(proposingText("none"));
  expect(proposingText("none")).toContain("This project has no proposals: tell the operator what to change, file by file.");
});
