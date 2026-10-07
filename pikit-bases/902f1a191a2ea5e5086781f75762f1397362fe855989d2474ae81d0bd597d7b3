/**
 * Views: each folder of `src/views/` is one, found when the dashboard is built (nothing is loaded
 * at run time). Its `index.tsx` default-exports `defineView({ … })`:
 *
 *   export default defineView({
 *     id: "memory",                       // the folder's name; its pages live under /memory
 *     title: "Memory",
 *     icon: Brain,
 *     requires: ["memory"],               // shown only when these capabilities are installed
 *     pages: [{ path: "/memory", component: MemoryPage }],
 *   });
 *
 * A view whose `requires` are not all in the App's composition does not appear (SPEC §5). A component
 * that brings a view installs its folder here (`pikit add`, or `shadcn add @pikit/<view>`).
 */

import type { ComponentType } from "react";
import type { ApiApp } from "./api.ts";

export interface ViewPage {
  /** Relative to /admin, starting with the view's `/<id>`; `:name` is a parameter. */
  path: string;
  component: ComponentType<{ params: Record<string, string> }>;
  /** The page fills the main pane and scrolls itself (a chat); otherwise it is shown in a padded, scrolling column. */
  fill?: boolean;
}

export interface View {
  /** The folder's name. */
  id: string;
  title: string;
  icon?: ComponentType<{ className?: string }>;
  /** Capabilities that must be provided in the App for the view to show. */
  requires?: string[];
  /** Its place in the sidebar, lowest first (default 100). `conversations` is the chat, not a sidebar item. */
  order?: number;
  /** Its pages; the first one is the sidebar's link. */
  pages: ViewPage[];
}

export function defineView(view: View): View {
  for (const page of view.pages) {
    if (page.path !== `/${view.id}` && !page.path.startsWith(`/${view.id}/`)) {
      throw new Error(`view "${view.id}": page ${page.path} is not under /${view.id}`);
    }
  }
  return view;
}

const found = import.meta.glob<{ default: View }>("../views/*/index.tsx", { eager: true });

/** Every view of `src/views/`, in sidebar order. */
export const views: View[] = Object.entries(found)
  .map(([file, module]) => {
    const view = module.default;
    const folder = file.split("/").at(-2);
    if (view?.id !== folder) throw new Error(`src/views/${folder}/index.tsx must default-export defineView({ id: "${folder}", … })`);
    return view;
  })
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

/** The views whose capabilities `app` provides. */
export function visibleViews(app: ApiApp): View[] {
  const provided = (name: string) => (app.capabilities[name]?.providers.length ?? 0) > 0;
  return views.filter((view) => (view.requires ?? []).every(provided));
}
