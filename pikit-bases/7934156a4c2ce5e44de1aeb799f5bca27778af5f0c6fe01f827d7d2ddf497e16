/**
 * router-basic's section of the Settings dialog, Agent (features/settings.md): which agent answers by
 * default (router-basic's own setting, its default the config's `defaultAgent`), and that agent's
 * system prompt, model and tools (runtime-pi's settings: an operator's override over the agent's
 * definition, applied from its next run). With several agents, any one of them is edited here.
 *
 * What runtime-pi's schema says is all it reads: the agents (its properties), each one's definition
 * (the `default`s), the models the installed providers have and the tools the definition names (the
 * options). It stores only what differs from the definition, so "Use the definition" takes an override
 * away.
 */

import { User } from "iconoir-react";
import { useState } from "react";
import { Button } from "@/components/bui/Button";
import { Switch } from "@/components/bui/Switch";
import { ErrorNote } from "@/components/pikit/error-note";
import { PromptEditor, SelectControl, SettingsHeading, SettingsRow, storedOf } from "@/components/pikit/settings";
import { assistantName } from "@/lib/names";
import { choicesOf, defineSettings, type SettingsValue, useSettings } from "@/lib/settings";

/** One agent's override (runtime-pi's settings): absent, the definition's. */
type Override = { systemPrompt?: string; model?: string; tools?: string[] };

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((each) => b.includes(each));

function AgentSettings() {
  const router = useSettings("router-basic");
  const runtime = useSettings("runtime-pi");
  const [editing, setEditing] = useState<string>();
  const [failed, setFailed] = useState<Error>();
  const saving = (work: Promise<void>) => {
    setFailed(undefined);
    work.catch((thrown: unknown) => setFailed(thrown instanceof Error ? thrown : new Error(String(thrown))));
  };

  if (router.error !== undefined && router.section === undefined) return <ErrorNote error={router.error} title="The router's settings cannot be read" />;
  if (router.section === undefined) return <p className="text-[13px] text-ink-3">Loading</p>;
  const routing = router.section;
  const defaultAgent = String(routing.value.defaultAgent);
  const agentNames = choicesOf(routing.schema.properties?.defaultAgent) ?? [defaultAgent];
  const agent = editing !== undefined && agentNames.includes(editing) ? editing : defaultAgent;

  const agents = runtime.section;
  const fields = agents?.schema.properties?.[agent]?.properties ?? {};
  const override = (agents?.value[agent] ?? {}) as Override;
  const definition = {
    systemPrompt: typeof fields.systemPrompt?.default === "string" ? fields.systemPrompt.default : "",
    model: typeof fields.model?.default === "string" ? fields.model.default : "",
    tools: Array.isArray(fields.tools?.default) ? (fields.tools.default as string[]) : [],
  };
  const models = choicesOf(fields.model) ?? [definition.model];
  const toolOptions = choicesOf(fields.tools?.items) ?? definition.tools;
  const tools = override.tools ?? definition.tools;

  /** Saves `next` as `agent`'s override, without what is the definition's. */
  const saveOverride = (next: Override): Promise<void> => {
    if (agents === undefined) return Promise.resolve();
    const kept: Override = {
      ...(next.systemPrompt !== undefined && next.systemPrompt !== definition.systemPrompt && { systemPrompt: next.systemPrompt }),
      ...(next.model !== undefined && next.model !== definition.model && { model: next.model }),
      ...(next.tools !== undefined && !sameSet(next.tools, definition.tools) && { tools: next.tools }),
    };
    const all: SettingsValue = { ...agents.value };
    if (Object.keys(kept).length === 0) delete all[agent];
    else all[agent] = kept;
    return runtime.save(all);
  };

  return (
    <div>
      {failed !== undefined && (
        <div className="mb-4">
          <ErrorNote error={failed} title="Not saved" />
        </div>
      )}
      <SettingsHeading>Routing</SettingsHeading>
      <SettingsRow label="Default agent" description="Answers every message no other rule routed. Its default is the config's defaultAgent." htmlFor="settings-default-agent">
        <SelectControl
          id="settings-default-agent"
          label="Default agent"
          value={defaultAgent}
          disabled={router.saving}
          options={agentNames.map((name) => ({ value: name, label: assistantName(name) }))}
          onChange={(name) => saving(router.save(storedOf({ defaultAgent: name }, routing.defaults)))}
        />
      </SettingsRow>
      {agentNames.length > 1 && (
        <SettingsRow label="Agent to change" description="The agent whose prompt, model and tools are below." htmlFor="settings-agent">
          <SelectControl id="settings-agent" label="Agent to change" value={agent} options={agentNames.map((name) => ({ value: name, label: assistantName(name) }))} onChange={setEditing} />
        </SettingsRow>
      )}

      {agents === undefined ? (
        runtime.error !== undefined ? (
          <div className="mt-6">
            <ErrorNote error={runtime.error} title="The agents' settings cannot be read" />
          </div>
        ) : (
          <p className="mt-6 text-[13px] text-ink-3">Loading</p>
        )
      ) : fields.systemPrompt === undefined ? (
        <p className="mt-6 text-[13px] text-ink-3">{`The runtime does not offer ${assistantName(agent)}'s settings.`}</p>
      ) : (
        <>
          <SettingsHeading
            aside={
              Object.keys(override).length > 0 && (
                <Button size="sm" variant="quiet" disabled={runtime.saving} onClick={() => saving(saveOverride({}))}>
                  Use the definition
                </Button>
              )
            }
          >
            {assistantName(agent)}
          </SettingsHeading>
          <SettingsRow label="System prompt" description="What the agent is told before every conversation. Applies from its next run." stacked htmlFor="settings-system-prompt">
            <PromptEditor
              id="settings-system-prompt"
              label="System prompt"
              value={override.systemPrompt}
              fallback={definition.systemPrompt}
              saving={runtime.saving}
              onSave={(text) => saving(saveOverride({ ...override, systemPrompt: text }))}
              onReset={() => {
                saving(saveOverride({ ...override, systemPrompt: undefined }));
              }}
            />
          </SettingsRow>
          <SettingsRow label="Model" description="The model that answers, among those the installed providers have." htmlFor="settings-model">
            <SelectControl
              id="settings-model"
              label="Model"
              value={override.model ?? definition.model}
              disabled={runtime.saving}
              options={models.map((model) => ({ value: model, label: model === definition.model ? `${model} (the definition's)` : model }))}
              onChange={(model) => saving(saveOverride({ ...override, model }))}
            />
          </SettingsRow>
          {toolOptions.length > 0 && (
            <>
              <SettingsHeading>Tools</SettingsHeading>
              {toolOptions.map((tool) => (
                <SettingsRow key={tool} label={tool} description={tools.includes(tool) ? "The agent may call it." : "Off: the agent does not have it."}>
                  <Switch
                    checked={tools.includes(tool)}
                    label={tool}
                    onChange={(on) => saving(saveOverride({ ...override, tools: toolOptions.filter((each) => (each === tool ? on : tools.includes(each))) }))}
                  />
                </SettingsRow>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default defineSettings({
  id: "router-basic",
  title: "Agent",
  icon: User,
  group: "Agents",
  order: 0,
  requires: ["settings"],
  keywords: ["default agent", "system prompt", "prompt", "model", "tools", "routing"],
  component: AgentSettings,
});
