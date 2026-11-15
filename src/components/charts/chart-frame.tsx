import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Every chart sits in one of these: a visible title, an optional caption, and a
 * text alternative for screen readers (the `summary`, plus an optional data
 * table rendered visually hidden).
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
  /** Optional accessible data table: header row + rows. */
  table?: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
  height?: string;
}) {
  return (
    <figure className={cn("rounded-lg border border-border/60 bg-card/60 p-3 sm:p-4", className)}>
      <figcaption className="mb-2">
        <span className="block font-heading text-sm font-semibold tracking-wide uppercase">{title}</span>
        {caption ? <span className="mt-0.5 block text-xs text-muted-foreground">{caption}</span> : null}
      </figcaption>
      <div className={cn("w-full", height)} role="img" aria-label={`${title}. ${summary}`}>
        {children}
      </div>
      {table ? (
        <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              {table.headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </figure>
  );
}
