/**
 * What the App is made of (`APP_DESCRIPTION`, SPEC K13): its components in start order, who provides
 * each capability, its pipelines' stages, and its config, each searchable. The config holds no
 * secret: a component reads its secrets through `secrets` and its config names them at most, and the
 * API redacts a value that looks like one.
 */

import { BoxIso, Code, Cube, DataTransferBoth, KeyframesCouple, Puzzle } from "iconoir-react";
import { useState } from "react";
import CodeBlock from "@/components/bui/CodeBlock";
import EmptyState from "@/components/bui/EmptyState";
import { FilterChips } from "@/components/bui/FilterTable";
import { Page, PageLoading, Section } from "@/components/bui/Page";
import RecordsTable, { type RecordColumn, RecordMark, RecordName, RecordTag, TagList, tagHue } from "@/components/bui/RecordsTable";
import SearchField from "@/components/bui/SearchField";
import { ErrorNote } from "@/components/pikit/error-note";
import { type ApiApp, useApi } from "@/lib/api";
import { defineView } from "@/lib/views";

type Part = "components" | "capabilities" | "pipelines" | "config";
type Component = ApiApp["components"][number];
type Capability = { name: string } & ApiApp["capabilities"][string];

/** A capability's tag, coloured by its family (`agent.`, `storage.`, …): the same everywhere. */
const capabilityTag = (name: string) => (
  <RecordTag base={tagHue(name.split(".")[0] ?? name)} title={name}>
    {name}
  </RecordTag>
);

function CompositionPage() {
  const { data: app, error } = useApi<ApiApp>("/app");
  const [part, setPart] = useState<Part>("components");
  const [query, setQuery] = useState("");

  if (error !== undefined) {
    return (
      <Page eyebrow="Composition">
        <ErrorNote error={error} title="The composition cannot be read" />
      </Page>
    );
  }
  if (app === undefined) return <PageLoading eyebrow="Composition" />;

  const needle = query.trim().toLowerCase();
  const matches = (...texts: string[]) => needle === "" || texts.some((text) => text.toLowerCase().includes(needle));

  // Start order is the API's; the row number says it.
  const components = app.components.filter((component) => matches(component.name, ...component.provides, ...component.requires, ...component.optional));
  const capabilities: Capability[] = Object.entries(app.capabilities)
    .map(([name, capability]) => ({ name, ...capability }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((capability) => matches(capability.name, ...capability.providers, ...Object.keys(capability.keys ?? {})));
  const pipelines = Object.entries(app.pipelines).filter(([name, stages]) => matches(name, JSON.stringify(stages)));
  const config = Object.fromEntries(Object.entries(app.config).filter(([name]) => matches(name)));

  const nothingFound = <EmptyState title="No results found" hint="Adjust your search to try again." />;

  const componentColumns: RecordColumn<Component>[] = [
    {
      key: "name",
      label: "Component",
      icon: <Cube />,
      width: 250,
      cell: (component) => (
        <>
          <RecordMark name={component.name} />
          <RecordName>{component.name}</RecordName>
          {component.version !== undefined && <span className="ml-1.5 shrink-0 font-mono text-[11.5px] text-ink-3">{component.version}</span>}
        </>
      ),
    },
    { key: "provides", label: "Provides", icon: <Puzzle />, width: 260, cell: (component) => <TagList tags={component.provides} render={capabilityTag} /> },
    { key: "requires", label: "Requires", icon: <DataTransferBoth />, width: 260, cell: (component) => <TagList tags={component.requires} render={capabilityTag} /> },
    { key: "optional", label: "Uses if installed", icon: <KeyframesCouple />, width: 240, cell: (component) => <TagList tags={component.optional} render={capabilityTag} /> },
  ];

  const capabilityColumns: RecordColumn<Capability>[] = [
    { key: "name", label: "Capability", icon: <Puzzle />, width: 240, sort: (a, b) => a.name.localeCompare(b.name), title: (capability) => capability.name, cell: (capability) => capabilityTag(capability.name) },
    {
      key: "providers",
      label: "Providers",
      icon: <Cube />,
      width: 260,
      sort: (a, b) => a.providers.length - b.providers.length,
      cell: (capability) => <TagList tags={capability.providers} render={(name) => <RecordTag title={name}>{name}</RecordTag>} empty="none" />,
    },
    {
      key: "selected",
      label: "Selected / keys",
      icon: <KeyframesCouple />,
      width: 320,
      cell: (capability) => {
        const keys = Object.entries(capability.keys ?? {}).map(([key, provider]) => `${key} → ${provider}`);
        if (keys.length > 0) return <TagList tags={keys} render={(entry) => <RecordTag title={entry}>{entry}</RecordTag>} />;
        return capability.selected === undefined ? <span className="records-muted">—</span> : <RecordTag title={capability.selected}>{capability.selected}</RecordTag>;
      },
    },
  ];

  return (
    <Page
      eyebrow="Composition"
      title={`${app.components.length} components, ${app.target} target`}
      description="What this App runs: its components in start order, who provides each capability, its pipelines and its config. A config value that looks like a secret is never sent here."
    >
      <Section
        title={part === "components" ? "Components" : part === "capabilities" ? "Capabilities" : part === "pipelines" ? "Pipelines" : "Config"}
        tools={
          <>
            <FilterChips
              label="Show"
              value={part}
              onChange={setPart}
              filters={[
                { key: "components", label: "Components", count: components.length },
                { key: "capabilities", label: "Capabilities", count: capabilities.length },
                { key: "pipelines", label: "Pipelines", count: pipelines.length },
                { key: "config", label: "Config", count: Object.keys(config).length },
              ]}
            />
            <SearchField value={query} onChange={setQuery} placeholder="Search components, capabilities" label="Search the composition" className="w-64" />
          </>
        }
      >
        {part === "components" && (
          <RecordsTable label="The App's components, in start order" columns={componentColumns} rows={components} rowKey={(component) => component.name} maxHeight={640} empty={nothingFound} />
        )}

        {part === "capabilities" && (
          <RecordsTable label="The App's capabilities and their providers" columns={capabilityColumns} rows={capabilities} rowKey={(capability) => capability.name} maxHeight={640} empty={nothingFound} />
        )}

        {part === "pipelines" &&
          (pipelines.length === 0 ? (
            <div className="rounded-card bg-surface shadow-card">
              {needle === "" ? <EmptyState icon={<Code />} title="No pipeline has a stage" /> : nothingFound}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {pipelines.map(([name, stages]) => (
                <CodeBlock key={name} filename={name} meta={`${stages.length} ${stages.length === 1 ? "stage" : "stages"}`} code={JSON.stringify(stages, null, 2)} />
              ))}
            </div>
          ))}

        {part === "config" &&
          (Object.keys(config).length === 0 && needle !== "" ? (
            <div className="rounded-card bg-surface shadow-card">{nothingFound}</div>
          ) : (
            <CodeBlock filename="config.json" meta={needle === "" ? "redacted by the API" : `the components matching “${query.trim()}”`} code={JSON.stringify(config, null, 2)} />
          ))}
      </Section>
    </Page>
  );
}

export default defineView({
  id: "composition",
  title: "Composition",
  icon: BoxIso,
  order: 90,
  pages: [{ path: "/composition", component: CompositionPage, fill: true }],
});
