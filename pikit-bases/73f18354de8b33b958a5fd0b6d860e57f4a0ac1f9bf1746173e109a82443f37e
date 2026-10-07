import { type CSSProperties, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";

/* ---------------------------------------------------------
 * RECORDS TABLE
 * Beautiful UI's records grid, fed by the app: columns with
 * a glyph each, sorted from their header, a numbered gutter,
 * a first column that stays while the grid scrolls both ways,
 * and a footer with the count. The rows and what each cell
 * shows are the caller's; nothing is invented.
 * --------------------------------------------------------- */

export type RecordColumn<T> = {
  key: string;
  label: string;
  /** a glyph before the label (iconoir) */
  icon?: ReactNode;
  /** px; the table fills its width beyond their sum, and scrolls under it */
  width: number;
  cell: (row: T) => ReactNode;
  /** sortable from its header */
  sort?: (a: T, b: T) => number;
  /** figures: right-aligned, tabular */
  end?: boolean;
  /** the cell's text is quiet */
  muted?: (row: T) => boolean;
  /** the cell's tooltip */
  title?: (row: T) => string | undefined;
};

function Arrow() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}

/** The record's initial in a small square, before its name. */
export function RecordMark({ name }: { name: string }) {
  return <span className="records-mark">{name.slice(0, 1).toUpperCase()}</span>;
}

/** A record's name, as the first column shows it. */
export function RecordName({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="records-name" title={title}>
      {children}
    </span>
  );
}

/* one mid-lightness base hue per tag; background, text and border are mixed from it */
const TAG_PALETTE = [
  "oklch(0.76 0.13 70)", // amber
  "oklch(0.77 0.16 122)", // lime
  "oklch(0.62 0.18 293)", // purple
  "oklch(0.71 0.16 48)", // orange
  "oklch(0.72 0.10 221)", // cyan
  "oklch(0.64 0.19 27)", // red
  "oklch(0.66 0.21 323)", // magenta
  "oklch(0.70 0.13 162)", // green
  "oklch(0.67 0.19 3)", // pink
  "oklch(0.80 0.15 101)", // yellow
];

/** A hue of the palette for `text`, always the same one: a name's tags share their colour wherever they show. */
export function tagHue(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length] as string;
}

/** A tag, its colours mixed from one hue (`base`, any CSS colour; quiet when absent). */
export function RecordTag({ children, base, title, mono = false }: { children: ReactNode; base?: string; title?: string; mono?: boolean }) {
  return (
    <span className={`records-tag ${mono ? "font-mono text-[12px]" : ""}`} title={title} style={base === undefined ? undefined : ({ "--tag-base": base } as CSSProperties)}>
      {children}
    </span>
  );
}

/** As many tags as fit the cell, then `+n`: the rest are in its tooltip. */
export function TagList({ tags, render, empty = "—" }: { tags: string[]; render: (tag: string) => ReactNode; empty?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const update = () => {
      const available = container.clientWidth;
      const widths = Array.from(measure.querySelectorAll<HTMLElement>("[data-tag-measure]"), (tag) => tag.offsetWidth);
      const moreWidth = measure.querySelector<HTMLElement>("[data-more-measure]")?.offsetWidth ?? 0;
      let used = 0;
      let count = 0;
      for (let index = 0; index < widths.length; index += 1) {
        const nextUsed = used + (count > 0 ? 4 : 0) + (widths[index] ?? 0);
        const hiddenAfter = tags.length - (index + 1);
        if (nextUsed + (hiddenAfter > 0 ? 4 + moreWidth : 0) > available) break;
        used = nextUsed;
        count += 1;
      }
      setVisibleCount(count);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tags]);

  if (tags.length === 0) return <span className="records-muted">{empty}</span>;
  const hiddenCount = tags.length - visibleCount;

  return (
    <div ref={containerRef} className="records-tags" title={tags.join(", ")}>
      <div ref={measureRef} className="records-tags-measure" aria-hidden>
        {tags.map((tag) => (
          <span key={tag} data-tag-measure>
            {render(tag)}
          </span>
        ))}
        <span data-more-measure className="records-more-tag">
          +{tags.length}
        </span>
      </div>
      {tags.slice(0, visibleCount).map((tag) => (
        <span key={tag} className="inline-flex">
          {render(tag)}
        </span>
      ))}
      {hiddenCount > 0 && <span className="records-more-tag">+{hiddenCount}</span>}
    </div>
  );
}

export default function RecordsTable<T>({
  label,
  columns,
  rows,
  rowKey,
  empty,
  initialSort,
  maxHeight = 520,
  className = "",
}: {
  /** what the table holds, for assistive technology */
  label: string;
  columns: RecordColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** shown under the header when there are no rows */
  empty: ReactNode;
  initialSort?: { key: string; dir: 1 | -1 };
  /** px before the grid scrolls under its sticky header */
  maxHeight?: number;
  className?: string;
}) {
  const [sort, setSort] = useState(initialSort);

  const sorted = useMemo(() => {
    const by = columns.find((column) => column.key === sort?.key)?.sort;
    if (by === undefined || sort === undefined) return rows;
    return [...rows].sort((a, b) => by(a, b) * sort.dir);
  }, [columns, rows, sort]);

  const toggle = (key: string) => setSort((current) => (current?.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const width = columns.reduce((sum, column) => sum + column.width, 0);

  return (
    <div className={`records-shell ${className}`}>
      <div className="records-scroll" tabIndex={0} role="region" aria-label={label} style={{ maxHeight }}>
        <table className="records-table" style={{ minWidth: width }}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column, index) => {
                const content = (
                  <>
                    {column.icon !== undefined && <span className="records-header-icon">{column.icon}</span>}
                    <span className="truncate">{column.label}</span>
                    {column.sort !== undefined && (
                      <span className={`records-sort ${sort?.key === column.key ? "is-visible" : ""}`} style={{ transform: sort?.key === column.key && sort.dir === -1 ? "rotate(180deg)" : undefined }}>
                        <Arrow />
                      </span>
                    )}
                  </>
                );
                return (
                  <th
                    key={column.key}
                    className={index === 0 ? "records-sticky-cell" : undefined}
                    aria-sort={sort?.key === column.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  >
                    {column.sort === undefined ? (
                      <div className="records-header-button">{content}</div>
                    ) : (
                      <button type="button" className="records-header-button" onClick={() => toggle(column.key)} aria-label={`Sort by ${column.label}`}>
                        {content}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {/* data cells stay silent: a sound per row is too much when scanning */}
          <tbody data-sound-silent>
            {sorted.map((row, index) => (
              <tr key={rowKey(row)} className="records-row">
                {columns.map((column, at) => {
                  const classes = `records-cell ${at === 0 ? "records-sticky-cell" : ""} ${column.end === true ? "is-end" : ""} ${column.muted?.(row) === true ? "records-muted" : ""}`;
                  return (
                    <td key={column.key} className={classes} title={column.title?.(row)}>
                      {at === 0 ? (
                        <div className="records-first">
                          <span className="records-rownum">{index + 1}</span>
                          {column.cell(row)}
                        </div>
                      ) : (
                        column.cell(row)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="records-cell records-sticky-cell">
                  <span className="inline-flex h-[35px] items-center text-ink-2">
                    <span className="records-count">{rows.length}</span> count
                  </span>
                </td>
                {columns.slice(1).map((column) => (
                  <td key={column.key} className="records-cell" />
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length === 0 && empty}
    </div>
  );
}
