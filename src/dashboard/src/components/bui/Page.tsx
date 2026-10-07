import type { ReactNode } from "react";
import { LoaderGrid } from "./LoadingState";

/* ---------------------------------------------------------
 * PAGE
 * An operator's page in the harness's voice: the view's name
 * quiet above what it says now (the home's two-tone heading),
 * a line of context, then its sections, each a small title
 * with its filters and a table or a panel. It fills the pane
 * and scrolls itself (a view's page with `fill: true`).
 * --------------------------------------------------------- */

export function Page({ eyebrow, title, aside, description, children }: { eyebrow: string; title?: ReactNode; aside?: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-10 pb-16 sm:px-8 lg:px-12" style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}>
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h1 className="min-w-0 text-[26px] leading-tight font-normal tracking-[-0.02em] text-ink">
            <span className="block text-ink-3">{eyebrow}</span>
            {title !== undefined && <span className="block">{title}</span>}
          </h1>
          {aside !== undefined && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
        </header>
        {description !== undefined && <div className="mt-3 max-w-[720px] text-[13.5px] leading-relaxed text-ink-2">{description}</div>}
        <div className="mt-8 flex flex-col gap-10">{children}</div>
      </div>
    </div>
  );
}

/** One part of a page: its title (and a figure), what filters it on the right, then its body. */
export function Section({ title, meta, tools, children }: { title: string; meta?: ReactNode; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
          {title}
          {meta !== undefined && <span className="text-[12.5px] font-normal text-ink-3">{meta}</span>}
        </h2>
        {tools !== undefined && <div className="flex min-w-0 flex-wrap items-center gap-2">{tools}</div>}
      </div>
      {children}
    </section>
  );
}

/** A page still reading its data. */
export function PageLoading({ eyebrow }: { eyebrow: string }) {
  return (
    <Page eyebrow={eyebrow}>
      <div className="flex items-center gap-2.5 text-[13px] text-ink-3">
        <LoaderGrid /> Loading
      </div>
    </Page>
  );
}
