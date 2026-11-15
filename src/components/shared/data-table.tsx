"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE table (Nov 2026 redesign): one component for data tables site-wide.
 *
 *   - sticky first column(s), so the team stays in view while scrolling
 *   - numbers right-aligned in mono tabular numerals
 *   - 44px rows (a comfortable tap target)
 *   - sortable headers with visible state (arrow + aria-sort)
 *   - optional "More columns" toggle for secondary columns
 *
 * Columns are defined in client code (cells are render functions), so a page
 * wraps this in its own small client component and passes plain rows.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Tooltip / longer explanation for the header. */
  title?: string;
  align?: "left" | "right" | "center";
  /** Numeric cell: mono, tabular, right-aligned unless `align` says otherwise. */
  numeric?: boolean;
  /** Pinned to the left edge (first columns only). Width in rem for the offset. */
  sticky?: { left: number; width: number };
  /** Hidden until "More columns" is on. */
  extra?: boolean;
  /** Sort key; omit to make the column unsortable. Nulls sort last. */
  sortValue?: (row: T) => number | string | null | undefined;
  /** Initial direction when first sorted (numbers usually high-first). */
  firstDirection?: "asc" | "desc";
  cell: (row: T, index: number) => ReactNode;
  className?: string;
}

type Sort = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  caption,
  footer,
  rowClassName,
  minWidth = 640,
  moreLabel = "More columns",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Accessible name of the scroll region and table. */
  label: string;
  caption?: ReactNode;
  footer?: ReactNode;
  /** Extra classes per row; `sorted` is false while in the default order. */
  rowClassName?: (row: T, index: number, sorted: boolean) => string | undefined;
  /** Table min-width in px with every column shown. */
  minWidth?: number;
  moreLabel?: string;
}) {
  const [sort, setSort] = useState<Sort>(null);
  const [showExtra, setShowExtra] = useState(false);
  const hasExtra = columns.some((c) => c.extra);
  const visible = columns.filter((c) => !c.extra || showExtra);

  const ordered = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.sortValue!(a);
      const y = col.sortValue!(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * factor;
    });
  })();

  const toggle = (c: Column<T>) => {
    const first = c.firstDirection ?? "desc";
    setSort((s) => {
      if (!s || s.key !== c.key) return { key: c.key, dir: first };
      if (s.dir === first) return { key: c.key, dir: first === "desc" ? "asc" : "desc" };
      return null; // third click: back to the default order
    });
  };

  const alignOf = (c: Column<T>) => c.align ?? (c.numeric ? "right" : "left");
  const alignClass = (c: Column<T>) => (alignOf(c) === "right" ? "text-right" : alignOf(c) === "center" ? "text-center" : "text-left");
  const stickyStyle = (c: Column<T>) => (c.sticky ? { left: `${c.sticky.left}rem`, minWidth: `${c.sticky.width}rem` } : undefined);
  const lastSticky = [...visible].reverse().find((c) => c.sticky)?.key;

  return (
    <div className="rounded-xl border border-border bg-card">
      {caption || hasExtra ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span>{caption}</span>
          {hasExtra ? (
            <button
              type="button"
              onClick={() => setShowExtra((v) => !v)}
              aria-pressed={showExtra}
              className="min-h-11 rounded-md px-2 font-medium text-primary hover:underline"
            >
              {showExtra ? "Fewer columns" : moreLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="relative overflow-x-auto" role="region" aria-label={`${label}, scrolls sideways`} tabIndex={0}>
        <table
          className="w-full border-separate border-spacing-0 text-sm"
          style={{ minWidth: showExtra ? minWidth : Math.min(minWidth, 560) }}
          aria-label={label}
        >
          <thead>
            <tr>
              {visible.map((c) => {
                const active = sort?.key === c.key ? sort.dir : null;
                const base = cn(
                  "h-11 border-b border-border px-3 text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase",
                  alignClass(c),
                  c.sticky && "sticky z-20 bg-card",
                  c.key === lastSticky && "border-r border-r-border",
                );
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={base}
                    style={stickyStyle(c)}
                    title={c.title}
                    aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : c.sortValue ? "none" : undefined}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(c)}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-1 uppercase hover:text-foreground",
                          active && "text-primary",
                          alignOf(c) === "right" && "flex-row-reverse",
                        )}
                      >
                        {c.header}
                        {active === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : active === "desc" ? (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordered.map((row, i) => (
              <tr key={rowKey(row)} className={cn("group h-11", rowClassName?.(row, i, sort != null))}>
                {visible.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "border-b border-border/60 px-3 py-1.5 whitespace-nowrap group-last:border-b-0",
                      "[tr.cut-line_&]:border-b-2 [tr.cut-line_&]:border-b-primary/70",
                      alignClass(c),
                      c.numeric && "font-mono tabular-nums",
                      c.sticky && "sticky z-10 bg-card group-hover:bg-muted",
                      c.key === lastSticky && "border-r border-r-border",
                      "group-hover:bg-muted/60",
                      c.className,
                    )}
                    style={stickyStyle(c)}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer ? <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
