/**
 * extension-pikit-self: the agents that name it (`extensions: ["pikit-self"]`) know what they are.
 * One system prompt section, `<pikit-self>`, in two parts:
 *
 * 1. **How pikit works and how each part is changed** (`pikit-self.md`, bundled as text): what an App,
 *    a component, a capability, a contract, a pipeline and a target are; where the agent's prompt,
 *    tools, components, extensions, dashboard views and config are changed, and what never is; that a
 *    change is a proposal the operator approves; and the kit's docs, linked online at the commit this
 *    project was made with (`pikit.json`'s `kit.commit`).
 * 2. **What runs now**, read in-process when the App starts: the App's description (`APP_DESCRIPTION`,
 *    SPEC K13: the components in start order and what each provides, the pipelines, the config with
 *    values that look like secrets redacted) and the agents (`agent.definition`: model, tools,
 *    extensions). It reads them to describe them, never to decide anything: K13 lets only the
 *    dashboard's components and this one read the description.
 *
 * Only the steward names it (SPEC §6: `steward: true` in its `defineAgent`, one per project): the agent
 * that knows what the project is made of is the one its operators ask to change it. `start` refuses an
 * agent that names it and is not the steward; runtime-pi refuses two stewards.
 *
 * 3. **How it proposes a change here**, from `proposals` when installed (`remote()`: where to clone
 *    from and push to), the same steps on every target: clone, `git checkout -b pikit/self/<topic>`,
 *    change, commit, `git push origin pikit/self/<topic>`; the operator approves in the dashboard.
 *    Read at each request (the repository is a setting on Cloudflare), the same text while it does not
 *    change.
 *
 * The rest is built once, in `start`, so the section is the same on every request and the provider's
 * prompt cache stays warm. Live state (health, deliveries, proposals) is not in it: that is the
 * operator's, in the dashboard.
 *
 * Targets: `server` and `durable`. On Cloudflare it belongs in the objects' App, where agents run; the
 * description it reads is that App's.
 */

import { APP_DESCRIPTION, type AppContext, type AppDescription, BACKGROUND_CONTEXT, defineComponent } from "@pikit/core";
import { type ProposalsRemote, redactSecrets } from "@pikit/contracts";
import { defineExtension, type Extension, section } from "@pikit/pi-adapter/extensions";
import GUIDE from "./pikit-self.md" with { type: "text" };

/** The name agents give it, its key under `agent.extension`, and its section's key. */
export const PIKIT_SELF = "pikit-self";

/** The kit's repository, which the docs links point into. */
export const KIT_REPOSITORY = "https://github.com/ajarellanod/pikit";

/**
 * The kit online at `commit` (`pikit.json`'s `kit.commit`, its `-dirty` set aside: uncommitted
 * changes have no URL), or at its main branch when there is none.
 */
export function kitUrl(commit: string | undefined): string {
  return `${KIT_REPOSITORY}/tree/${commit === undefined ? "main" : commit.replace(/-dirty$/, "")}`;
}

/**
 * The commit of the kit this project was made with: `pikit.json` at the project's root, bundled with
 * the App (a JSON import, so it is there on Cloudflare too). `undefined` where there is no project
 * around this file (the registry) or it records none.
 */
export async function projectKitCommit(): Promise<string | undefined> {
  try {
    // @ts-ignore: in the registry this file has no project around it. Installed at `src/pikit/extension-pikit-self/`, it is the project's pikit.json.
    const project = (await import("../../../pikit.json", { with: { type: "json" } })) as { default?: { kit?: { commit?: unknown } } };
    const commit = project.default?.kit?.commit;
    return typeof commit === "string" ? commit : undefined;
  } catch {
    return undefined;
  }
}

/** An agent as the section says it: its name, its model, the names of its tools and extensions, whether it is the steward. */
export interface AgentSummary {
  name: string;
  model: string;
  tools: string[];
  extensions: string[];
  steward: boolean;
}

/** `definition` (an `agent.definition`) as the section says it. */
export function agentSummary(
  name: string,
  definition: { model?: unknown; tools?: readonly unknown[]; extensions?: readonly unknown[]; steward?: unknown } | undefined,
): AgentSummary {
  const tools = (definition?.tools ?? []).flatMap((tool) => {
    const named = typeof tool === "string" ? tool : (tool as { name?: unknown } | null)?.name;
    return typeof named === "string" ? [named] : [];
  });
  const extensions = (definition?.extensions ?? []).filter((extension): extension is string => typeof extension === "string");
  return { name, model: typeof definition?.model === "string" ? definition.model : "", tools, extensions, steward: definition?.steward === true };
}

/**
 * Why `agents` may not start with `pikit-self`, or `undefined`: an agent names it and is not the
 * steward. The section is the steward's: what the project is made of and how it is changed, for the
 * agent its operators ask to change it.
 */
export function stewardProblem(agents: readonly AgentSummary[]): string | undefined {
  const agent = agents.find((each) => !each.steward && each.extensions.includes(PIKIT_SELF));
  if (agent === undefined) return undefined;
  return (
    `extension-pikit-self: agent "${agent.name}" names "${PIKIT_SELF}" and is not the steward; only the steward ` +
    `(\`steward: true\` in its defineAgent, one per project) knows itself: mark it so, or take "${PIKIT_SELF}" out of its extensions`
  );
}

/** What runs now: the App's components, pipelines and config (secrets redacted), and its agents. */
export function compositionText(description: AppDescription, agents: readonly AgentSummary[]): string {
  const lines = ["## What runs now", `Target: ${description.target}.`];
  if (description.target === "durable") lines.push("This is the App of each conversation's Durable Object; the Worker's App is not shown.");

  lines.push("", "Components, in start order, with what each provides:");
  for (const component of description.components) {
    const provides = component.provides.map((capability) => {
      const { keys, selected, providers = [] } = description.capabilities[capability] ?? {};
      const own = Object.entries(keys ?? {}).flatMap(([key, provider]) => (provider === component.name ? [key] : []));
      if (own.length > 0) return `${capability} (${own.join(", ")})`;
      return providers.length > 1 && selected !== component.name ? `${capability} (not selected)` : capability;
    });
    lines.push(`- ${component.name}${provides.length > 0 ? `: ${provides.join("; ")}` : ""}`);
  }

  const pipelines = Object.entries(description.pipelines).filter(([, stages]) => stages.length > 0);
  if (pipelines.length > 0) {
    lines.push("", "Pipelines, each stage in the order it runs:");
    for (const [name, stages] of pipelines) lines.push(`- ${name}: ${stages.map((stage) => stage.id).join(", ")}`);
  }

  lines.push("", "Agents:");
  if (agents.length === 0) lines.push("- none");
  for (const agent of agents) {
    const tools = agent.tools.length > 0 ? agent.tools.join(", ") : "none";
    const extensions = agent.extensions.length > 0 ? `; extensions ${agent.extensions.join(", ")}` : "";
    lines.push(`- ${agent.name}${agent.steward ? " (the steward)" : ""}: model ${agent.model}; tools ${tools}${extensions}`);
  }

  // Config holds no secret (K13); one put there by mistake is still never shown.
  const config = Object.entries(redactSecrets(description.config)).filter(([, value]) => !isEmpty(value));
  if (config.length > 0) {
    lines.push("", "Config, under each component's name (a value that looks like a secret is [redacted]):");
    for (const [name, value] of config) lines.push(`- ${name}: ${JSON.stringify(value)}`);
  }
  return lines.join("\n");
}

function isEmpty(value: unknown): boolean {
  return value === undefined || (typeof value === "object" && value !== null && Object.keys(value).length === 0);
}

/** The section's text: the guide, its docs at the kit's commit, then what runs now (when known). */
export function pikitSelfText(commit: string | undefined, composition: string | undefined): string {
  const guide = GUIDE.replaceAll("{{PIKIT_URL}}", kitUrl(commit)).trim();
  return composition === undefined ? guide : `${guide}\n\n${composition}`;
}

/**
 * How the steward proposes a change here: from `proposals`' `remote()` (`undefined` while it is not
 * set up), or `"none"` when no component provides `proposals`. The same steps on every target.
 */
export function proposingText(remote: ProposalsRemote | undefined | "none"): string {
  const title = "## How you propose a change here";
  if (remote === "none") {
    return `${title}\nThis project has no proposals: tell the operator what to change, file by file. Self-improvement adds them (\`pikit add admin-proposals\` with \`proposals-local\` on a server, \`proposals-github\` on Cloudflare).`;
  }
  if (remote === undefined) {
    return `${title}\nProposals are not set up yet: tell the operator to finish it in the dashboard's Settings → Self-improvement, and until then what to change, file by file.`;
  }
  const from = remote.kind === "path" ? remote.path : remote.url;
  const branch = `${remote.branchPrefix}<topic>`;
  return [
    title,
    `With git in your shell, from ${from}, never pushing ${remote.mainBranch}:`,
    `1. \`git clone ${from} project\`: a fresh clone for each change, so it starts from the latest ${remote.mainBranch}.`,
    `2. \`cd project && git checkout -b ${branch}\`, a short topic (\`calendar-tool\`).`,
    "3. Make the change; run `bun install` and `bun test` there where you can.",
    '4. `git add -A && git commit -m "<title>" -m "<description>"`: the first line is the proposal\'s title, the rest its description (what, why, what you checked).',
    `5. \`git push origin ${branch}\`: the pushed branch is the proposal; pushing it again replaces it.`,
    "The operator reads it in the dashboard's Proposals and approves or rejects it; an approved change is deployed, and rolled back if it is unhealthy.",
  ].join("\n");
}

/**
 * The extension, whose section is `text()` then `proposing()`: `undefined` (before the App starts)
 * leaves it out.
 */
export function createPikitSelf(text: () => string | undefined, proposing: () => Promise<string | undefined> = async () => undefined): Extension {
  return defineExtension({
    name: PIKIT_SELF,
    sections: [
      section(PIKIT_SELF, async () => {
        const known = text();
        if (known === undefined) return undefined;
        const how = await proposing();
        return how === undefined ? known : `${known}\n\n${how}`;
      }),
    ],
  });
}

export default defineComponent({
  name: "extension-pikit-self",
  setup(pikit) {
    // The agents, for what each is (model, tools, extensions): the description has only their names.
    const definitions = pikit.useKeyed("agent.definition");
    // Where the steward clones from and pushes to: the contract's, whichever provider (P4).
    const proposals = pikit.useOptional("proposals");
    let text: string | undefined;
    let background: AppContext | undefined;
    const proposing = async () => {
      const provider = proposals.get();
      if (provider === undefined) return proposingText("none");
      if (background === undefined) return undefined;
      return proposingText(await provider.remote(background).catch(() => undefined));
    };
    pikit.provideKeyed("agent.extension", PIKIT_SELF, createPikitSelf(() => text, proposing));
    return {
      async start(ctx) {
        const agents = definitions
          .keys()
          .sort()
          .map((name) => agentSummary(name, definitions.get(name)));
        const problem = stewardProblem(agents);
        if (problem !== undefined) throw new Error(problem);
        background = ctx.derive(() => BACKGROUND_CONTEXT);
        const description = ctx.value(APP_DESCRIPTION);
        text = pikitSelfText(await projectKitCommit(), description === undefined ? undefined : compositionText(description, agents));
      },
    };
  },
});
