/**
 * The Settings dialog's sections: the dashboard's own (`General`, kept in this browser) and one per
 * installed component that brings one. Each folder of `src/settings/` is one, found when the dashboard
 * is built (nothing is loaded at run time), as views are (`views.ts`). Its `index.tsx` default-exports
 * `defineSettings({ … })`:
 *
 *   export default defineSettings({
 *     id: "router-basic",                 // the folder's name: the component's
 *     title: "Agent",
 *     icon: User,
 *     group: "Agents",                    // the left column's heading (default "Components")
 *     requires: ["settings"],             // shown only when these capabilities are installed
 *     keywords: ["prompt", "model"],      // what the search box finds it by, besides its title
 *     component: AgentSettings,
 *   });
 *
 * A component installs its folder here (`pikit add`, component.json's `settings`). Its values are the
 * component's settings (settings-store's routes, `/admin/api/settings/:component`): `useSettings`
 * reads one component's, with its schema, and saves it whole. A simple section renders from the schema
 * alone (`SchemaSettings`, `components/pikit/settings.tsx`); a custom one places its own controls.
 */

import { type ComponentType, useCallback, useEffect, useState } from "react";
import { type ApiApp, api } from "./api.ts";

export interface SettingsSectionDefinition {
  /** The folder's name: the component's. */
  id: string;
  title: string;
  icon?: ComponentType<{ className?: string; width?: number; height?: number; strokeWidth?: number }>;
  /** The heading it is listed under (default `Components`); the dashboard's own come first. */
  group?: string;
  /** Its place in its group, lowest first (default 100). */
  order?: number;
  /** Capabilities that must be provided in the App for it to show. */
  requires?: string[];
  /** Words the search box finds it by, besides its title. */
  keywords?: string[];
  component: ComponentType;
}

export function defineSettings(section: SettingsSectionDefinition): SettingsSectionDefinition {
  return section;
}

/** The groups listed first, in this order; any other after them, by name. */
const GROUPS = ["Dashboard", "Agents", "Components"];

const found = import.meta.glob<{ default: SettingsSectionDefinition }>("../settings/*/index.tsx", { eager: true });

/** Every section of `src/settings/`, by group, then order, then title. */
export const settingsSections: SettingsSectionDefinition[] = Object.entries(found)
  .map(([file, module]) => {
    const section = module.default;
    const folder = file.split("/").at(-2);
    if (section?.id !== folder) throw new Error(`src/settings/${folder}/index.tsx must default-export defineSettings({ id: "${folder}", … })`);
    return section;
  })
  .sort(bySectionOrder);

export function groupOf(section: SettingsSectionDefinition): string {
  return section.group ?? "Components";
}

export function bySectionOrder(a: SettingsSectionDefinition, b: SettingsSectionDefinition): number {
  const rank = (group: string) => (GROUPS.includes(group) ? GROUPS.indexOf(group) : GROUPS.length);
  return (
    rank(groupOf(a)) - rank(groupOf(b)) ||
    groupOf(a).localeCompare(groupOf(b)) ||
    (a.order ?? 100) - (b.order ?? 100) ||
    a.title.localeCompare(b.title)
  );
}

/** The sections whose capabilities `app` provides. */
export function visibleSettings(app: ApiApp): SettingsSectionDefinition[] {
  const provided = (name: string) => (app.capabilities[name]?.providers.length ?? 0) > 0;
  return settingsSections.filter((section) => (section.requires ?? []).every(provided));
}

/** A JSON Schema, as the routes answer it (TypeBox's). */
export type JsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  format?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  [keyword: string]: unknown;
};

export type SettingsValue = Record<string, unknown>;

/** One component's settings, as settings-store's routes answer them. */
export interface ApiSettingsSection {
  component: string;
  schema: JsonSchema;
  defaults: SettingsValue;
  value: SettingsValue;
}

/** One component's settings, and saving them whole (`PUT`): the answer replaces what is shown. */
export interface ComponentSettings {
  section: ApiSettingsSection | undefined;
  error: Error | undefined;
  /** Saves `value` as the component's whole value; rejects with the API's refusal. */
  save(value: SettingsValue): Promise<void>;
  saving: boolean;
}

/** `component`'s settings (`GET /admin/api/settings/:component`). */
export function useSettings(component: string): ComponentSettings {
  const [section, setSection] = useState<ApiSettingsSection>();
  const [error, setError] = useState<Error>();
  const [saving, setSaving] = useState(false);
  const path = `/settings/${encodeURIComponent(component)}`;

  useEffect(() => {
    let live = true;
    api<ApiSettingsSection>(path).then(
      (read) => live && (setSection(read), setError(undefined)),
      (thrown: unknown) => live && setError(thrown instanceof Error ? thrown : new Error(String(thrown))),
    );
    return () => {
      live = false;
    };
  }, [path]);

  const save = useCallback(
    async (value: SettingsValue) => {
      setSaving(true);
      try {
        const saved = await api<ApiSettingsSection>(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
        setSection(saved);
        setError(undefined);
      } finally {
        setSaving(false);
      }
    },
    [path],
  );

  return { section, error, save, saving };
}

/** The choices a schema offers: an `enum`, or an `anyOf` of `const`s (TypeBox's `Union` of `Literal`s); `undefined` when it offers none. */
export function choicesOf(schema: JsonSchema | undefined): string[] | undefined {
  if (schema === undefined) return undefined;
  if (Array.isArray(schema.enum)) return schema.enum.filter((each): each is string => typeof each === "string");
  if (Array.isArray(schema.anyOf) && schema.anyOf.every((each) => typeof each.const === "string")) return schema.anyOf.map((each) => each.const as string);
  return undefined;
}
