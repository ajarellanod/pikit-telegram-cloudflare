/**
 * The Settings dialog, opened from the sidebar's foot: a large modal with a search box and the
 * sections, grouped, on the left, and the chosen section's rows on the right. The first section is the
 * dashboard's own, General (its theme, its sounds: this browser's, `localStorage`, nothing of the
 * service's); then one per installed component that brings one (`src/settings/<component>/`,
 * `lib/settings.ts`), shown when the App provides what it requires. A change applies to the next run.
 * A section may open another (`useOpenSettingsSection`); the shell opens one by its id (`section`: the
 * page's `?settings=<id>`).
 */

import { Computer, HalfMoon, Search, Settings, SunLight, Xmark } from "iconoir-react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { Switch } from "@/components/bui/Switch";
import { Segmented, SettingsHeading, SettingsRow } from "@/components/pikit/settings";
import type { ApiApp } from "@/lib/api";
import { groupOf, type SettingsSectionDefinition, SettingsNavigation, visibleSettings } from "@/lib/settings";
import { setSounds, useSounds } from "@/lib/sounds";
import { setTheme, type Theme, useTheme } from "@/lib/theme";

function GeneralSettings() {
  const theme = useTheme();
  const sounds = useSounds();
  return (
    <div>
      <SettingsHeading>Appearance</SettingsHeading>
      <SettingsRow label="Theme" description="Light, dark, or as the system is. This browser's only.">
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "The system's theme", icon: Computer },
            { value: "light", label: "Light mode", icon: SunLight },
            { value: "dark", label: "Dark mode", icon: HalfMoon },
          ]}
        />
      </SettingsRow>
      <SettingsRow label="Interaction sounds" description="A quiet cue on each click.">
        <Switch checked={sounds} label="Interaction sounds" onChange={setSounds} />
      </SettingsRow>
    </div>
  );
}

/** The dashboard's own section: first, kept in this browser. */
const GENERAL: SettingsSectionDefinition = { id: "general", title: "General", icon: Settings, group: "Dashboard", order: 0, keywords: ["theme", "dark", "light", "sounds", "appearance"], component: GeneralSettings };

function matches(section: SettingsSectionDefinition, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [section.title, section.id, groupOf(section), ...(section.keywords ?? [])].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

export function SettingsDialog({ app, open, onOpenChange, section }: { app: ApiApp; open: boolean; onOpenChange: (open: boolean) => void; section?: string }) {
  const all = useMemo(() => [GENERAL, ...visibleSettings(app)], [app]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(GENERAL.id);
  // Opened at a section by its id: chosen whenever the dialog opens with one.
  useEffect(() => {
    if (!open || section === undefined) return;
    setQuery("");
    setChosen(section);
  }, [open, section]);
  const shown = all.filter((section) => matches(section, query));
  const current = shown.find((section) => section.id === chosen) ?? shown[0];
  const groups = [...new Set(shown.map(groupOf))];
  const Section = current?.component;
  /** A section's link to another: shown whatever the search. */
  const openSection = (id: string) => {
    setQuery("");
    setChosen(id);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]" style={{ animation: "fade-in 150ms ease-out both" }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(760px,calc(100dvh-2rem))] w-[min(1040px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-window bg-page text-ink shadow-overlay outline-none sm:flex-row"
          style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both" }}
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <nav aria-label="Settings sections" className="flex max-h-56 shrink-0 flex-col gap-1 overflow-y-auto border-b border-line bg-canvas p-3 sm:max-h-none sm:w-64 sm:border-r sm:border-b-0">
            <div className="flex h-9 items-center gap-2 rounded-control bg-surface px-2.5 shadow-btn focus-within:shadow-[0_0_0_1px_var(--line-strong),0_0_0_3px_var(--accent-tint)]">
              <Search width={15} height={15} strokeWidth={2} className="shrink-0 text-ink-3" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search the settings"
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            {groups.map((group) => (
              <div key={group} className="mt-3 flex flex-col gap-px">
                <div className="px-2.5 pb-1 text-[12.5px] font-medium text-ink-3">{group}</div>
                {shown
                  .filter((section) => groupOf(section) === group)
                  .map((section) => {
                    const Icon = section.icon;
                    const active = section.id === current?.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => setChosen(section.id)}
                        className={`flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[14px] transition-colors duration-100 ${active ? "bg-hover-2 font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"}`}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center">{Icon !== undefined && <Icon width={17} height={17} strokeWidth={1.8} />}</span>
                        <span className="min-w-0 flex-1 truncate">{section.title}</span>
                      </button>
                    );
                  })}
              </div>
            ))}
            {shown.length === 0 && <p className="px-2.5 pt-3 text-[13px] text-ink-3">No settings match.</p>}
          </nav>
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <Dialog.Close
              aria-label="Close the settings"
              className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
            >
              <Xmark width={18} height={18} strokeWidth={2} />
            </Dialog.Close>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-12 pb-10 sm:px-10">
              {current !== undefined && Section !== undefined && (
                <>
                  <h2 className="mb-6 text-[19px] font-semibold text-ink">{current.title}</h2>
                  <SettingsNavigation.Provider value={openSection}>
                    <Section key={current.id} />
                  </SettingsNavigation.Provider>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
