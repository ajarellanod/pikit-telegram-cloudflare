---
name: pikit-view
description: Add a view to a pikit project's dashboard (src/dashboard/, a shadcn/ui project), with the admin API routes it reads, for the project alone or as part of a component others can `pikit add`. Also a section of its Settings dialog, for values an operator changes live. Use when the user wants to see, operate or set something of their pikit assistant in the dashboard.
---

# Add a view to the dashboard

The dashboard (SPEC §5) is a project's choice: `src/dashboard/` exists when the project has a UI
(`pikit ui on`). It is a shadcn/ui project of its own (Vite, React, Tailwind v4), served at
`/admin/` by the `admin-api` component, and it reads only the admin API (`/admin/api/*`), with the
operator's browser session (`src/lib/api.ts`). A view is a folder of `src/dashboard/src/views/`, found when the dashboard
is built, and shown only while the capabilities it declares are installed.

## 0. Know what is there

```sh
cat src/dashboard/README.md         # the dashboard's layout: views, primitives, lib
ls src/dashboard/src/views/          # the views it has (each folder is one)
pikit doctor                         # what the App provides: what a view may require
```

The base views are the references: `conversations` (a list, a live page over server-sent events,
actions) and `composition` (one read, tabs). Read `src/dashboard/src/lib/api.ts` (`api`, `post`,
`useApi`, `follow`), `activity.ts` (`usePolling`, `every`), `views.ts` (`defineView`) and
`router.tsx` (`Link`, `navigate`, `pagePath`).

**Add a view; do not edit a base one.** `pikit upgrade` merges the kit's changes into the base views
(`conversations`, `composition`, `delivery`) and the files of `src/lib/` and `src/components/`; every
file you edit is a file that can conflict. To show more about conversations, write a new view that
imports what the base views export (`Status`, `DashboardBadge`, `agentsOf` from
`@/views/conversations/list`, `useLive` from `@/views/conversations/live`, `MessageView`,
`ErrorNote`) rather than changing theirs. Edit a base file only for what a new view cannot do, keep
the change small, and say so to the user.

## 1. Decide where it lives

| The view is | It lives in | Its data comes from |
|---|---|---|
| The project's own | `src/dashboard/src/views/<id>/` | admin-api's routes, or a project component's routes (`src/extensions/`) |
| Part of a component others install | the component's `view/` folder (`"view": "view"` in `component.json`) | the component's own routes |

A component's view is copied by `pikit add` to `src/dashboard/src/views/<component name>/` when the
project has a UI (and by `pikit ui on` later), recorded as the component's files: `pikit upgrade`
merges it, `pikit remove` takes it away. Its `id` is the component's name.

## 2. The routes it reads

A view reads only `/admin/api/*`. New data means a new route, in the component that owns the data
(the pattern `health-registry` follows):

```ts
const auth = pikit.useOptional("admin.auth");
pikit.provideKeyed("http.route", "GET /admin/api/<component>/<what>", async (request, ctx) => {
  const verifier = auth.get();
  if (verifier === undefined || (await verifier.verify(request, ctx)) === undefined) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "www-authenticate": 'Bearer realm="pikit"' } });
  }
  return Response.json(/* JSON, typed in a file the view can copy */);
});
```

- Under `/admin/api/<component>/…`, so names never clash; answers JSON, errors as `{ error, message? }`.
- Every route asks `admin.auth` first, before reading anything; never a secret, a token or more
  message text than an operator needs.
- It reads contracts and feeds, never another component's internals (P4). Actions go through the
  contract that owns them.
- Test it with doubles, as `admin-api`'s tests do (a request in, the JSON out, `401` without an
  operator).

## 3. The view

```tsx
// view/index.tsx (a component's) or src/dashboard/src/views/<id>/index.tsx (the project's)
import { Activity } from "iconoir-react";
import { defineView } from "@/lib/views";
import { HealthPage } from "./health";

export default defineView({
  id: "health-registry",          // the folder's name; a component's view is named after the component
  title: "Health",
  icon: Activity,                 // iconoir icons (free): never a paid icon set
  requires: ["health"],           // capabilities that must be provided for it to show
  order: 20,
  pages: [{ path: "/health-registry", component: HealthPage }],
});
```

- Pages live under `/<id>`; `:name` segments are parameters (`/memory/:person`).
- Read with `useApi<T>("/<component>/<what>", everyMs?)`; act with `post(...)`; follow live data
  with `follow(path, onEvent, signal)` (server-sent events read with `fetch`, so the session and its
  header go too). Poll through `useApi` or `usePolling` (`@/lib/activity`), never a bare
  `setInterval`: they pause while the tab is hidden or the operator is away. On Cloudflare every read
  is a request of the day's budget, shared with the bot: poll with `every(ms)`, slower there.
- Put an id in a path with `pagePath(base, id)` or `encodeURIComponent` (ids may hold `:`, `.`, `@`,
  `/`); `match` decodes it.
- The page runs under a Content-Security-Policy (`default-src 'self'`): no inline script, nothing
  from another origin (fonts, images and styles come from the build).
- Build it from Beautiful UI's primitives in `src/components/bui/` (the dashboard's look). An
  operator's page is `Page` / `Section` (`bui/Page`, the page `fill: true`): the view's name over what
  it says now, then sections with `FilterChips` (a dot and a count each), a `RecordsTable` (columns
  with a glyph, sorting, a numbered gutter, a count; `RecordMark`, `RecordTag`, `TagList` in its
  cells), `StatePill` for a state in a cell, `EmptyState` when nothing shows, `SearchField`,
  `CodeBlock` for JSON; health-registry's and the base `delivery` and `composition` views are
  examples. Also `StatusPill`, `Chip`, `ValuePill`, `Button`, `ContextCards` (a card per
  source: title, figure, text, a chip that opens it), `ToolChips`, `LoadingState`. shadcn's in `src/components/ui/` (in the same
  colours), and the pieces in `src/components/pikit/` (`ErrorNote`, `MessageView`). Use the tokens'
  classes (`bg-surface`, `text-ink-2`, `shadow-card`, `rounded-card`), not raw colours. Need another primitive: `bunx shadcn@latest add <name>` in
  `src/dashboard/`. A component's view may use only primitives the base dashboard ships, or say in its
  README which ones to add.
- Import with `@/…`; relative imports only inside the view's own folder.

## 4. Check it

```sh
cd src/dashboard && bun run typecheck && bun run build    # the view compiles and is found
pikit dev                                                # then open /admin/ and sign in
bun run dev                                              # or hot reload on :5173 against the running app
```

For a component: `pikit registry validate <registry>` checks its `view/index.tsx` defines the view
under the component's name; in the pikit repository, `bun scripts/ui-registry.ts generate` publishes
it as the shadcn item `@pikit/<component>`.

Done means: the routes' tests pass (401 first), the dashboard builds, the view appears only while
its `requires` are provided, and nothing in it shows a secret.

## A section of the Settings dialog

When what the operator needs is to **change a value live** (a prompt, a limit, an option) rather than
to see something, it is a setting, not a view (features/settings.md): a section of the dashboard's
Settings dialog, with no route of your own.

1. **Config or setting, never both.** A value deployed with the project stays config; one an operator
   changes live is a setting, its default maybe from config. Never a secret.
2. **The component declares it** in its `start`, when `settings` is installed (settings-store, which
   comes with the dashboard), and reads it when used:
   ```ts
   const settings = pikit.useOptional("settings");
   // start:
   settings.get()?.declare("my-component", Type.Object({ tone: Type.Union([Type.Literal("brief"), Type.Literal("thorough")], { title: "Tone", description: "How long the answers are." }) }), { tone: config.tone });
   // when used (keep your config's value when it rejects):
   const { tone } = await settings.get()!.get<{ tone: string }>("my-component", ctx);
   ```
   settings-store serves it to the dashboard (`GET`/`PUT /admin/api/settings/my-component`, behind
   `admin.auth`) and validates every change against the schema.
3. **The section** is a folder: `src/dashboard/src/settings/<component>/index.tsx` for the project,
   or the component's `settings/` folder (`"settings": "settings"` in `component.json`), which `pikit
   add` installs there when the project has a UI. It default-exports `defineSettings` from
   `@/lib/settings`, under the component's name:
   ```tsx
   export default defineSettings({ id: "my-component", title: "My component", icon: Tools, group: "Components", requires: ["settings"], keywords: ["tone"], component: () => <SchemaSettings component="my-component" /> });
   ```
   `SchemaSettings` (`@/components/pikit/settings`) renders it from the schema (switch, segmented
   choice, select, text, prompt editor). A custom section places `SettingsHeading`, `SettingsRow` and
   the controls itself over `useSettings("<component>")` (its `section`: schema, defaults, value; its
   `save(value)`: the whole value; `storedOf` keeps what differs from the defaults). router-basic's
   `settings/index.tsx` (Agent) is the reference for a custom one.
4. **Check it** as a view: the dashboard builds, the section shows in Settings only while its
   `requires` are provided, a change shows in the next `get` (test it in the component with a
   `settings` double, or settings-store's conformance suite for a provider). `pikit registry validate`
   checks `settings/index.tsx` defines the section under the component's name.
