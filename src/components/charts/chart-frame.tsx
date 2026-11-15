import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Every chart sits in one of these: a visible title, an optional caption, a
 * text summary for screen readers, and — when a data table is supplied — a
 * visible "Show the numbers" disclosure. That table is the tap equivalent of
 * every hover tooltip, so nothing on a chart is hover-only.
 *
 * The plot area is not role="img": some charts carry their own controls (tap a
 * team to highlight it), and an image role would hide them.
 */
export function ChartFrame({
  title,
  caption,
  summary,
  table,
  children,
  className,
  height = "h-72",
}: {
  title: string;
  caption?: ReactNode;
  /** One or two sentences describing what the chart shows, for screen readers. */
  summary: string;
  /** Optional data table: header row + rows. */
  table?: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
  height?: string;
}) {
  return (
    <figure className={cn("rounded-xl border border-border bg-card p-3 sm:p-4", className)}>
      <figcaption className="mb-2">
        <span className="block font-heading text-sm font-semibold tracking-wide uppercase">{title}</span>
        {caption ? <span className="mt-0.5 block text-xs text-muted-foreground">{caption}</span> : null}
        <span className="sr-only">{summary}</span>
      </figcaption>
      <div className={cn("w-full", height)}>{children}</div>
      {table ? (
        <details className="mt-2 text-xs">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground">
            Show the numbers
          </summary>
          <div className="relative max-h-80 overflow-auto rounded-md border border-border" role="region" aria-label={`${title}: data table`} tabIndex={0}>
            <table className="w-full border-separate border-spacing-0">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  {table.headers.map((h) => (
                    <th key={h} scope="col" className="sticky top-0 border-b border-border bg-card px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={cn("border-b border-border/60 px-2 py-1.5 whitespace-nowrap", typeof c === "number" && "text-right font-mono tabular-nums")}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}
