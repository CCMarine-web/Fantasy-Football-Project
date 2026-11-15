import Link from "next/link";
import { Trophy } from "lucide-react";
import { heatColor } from "@/lib/chart-theme";
import { managerPath } from "@/lib/slug";
import type { ComparisonRow, FinishCell } from "@/server/repositories/manager-comparison";

/** Rows = managers, columns = seasons; cells coloured by final finish. */
export function FinishGrid({ rows, seasons, grid }: { rows: ComparisonRow[]; seasons: number[]; grid: Record<string, FinishCell[]> }) {
  return (
    <figure className="rounded-lg border border-border/60 bg-card/60 p-3 sm:p-4">
      <figcaption className="mb-2">
        <span className="block font-heading text-sm font-semibold tracking-wide uppercase">League finish by season</span>
        <span className="block text-xs text-muted-foreground">
          Final finish each season (blue = top, orange = bottom). <Trophy className="inline h-3 w-3 align-[-2px]" aria-hidden /> champion · ▼ regular-season last place · ● season in progress.
        </span>
      </figcaption>
      <div className="relative overflow-x-auto" role="region" aria-label="Finish grid, scrolls sideways" tabIndex={0}>
        <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-1 text-left font-medium text-muted-foreground">Manager</th>
              {seasons.map((y) => (
                <th key={y} scope="col" className="px-1 text-center font-medium text-muted-foreground">
                  {String(y).slice(2)}
                  <span className="sr-only">{y}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.managerId}>
                <th scope="row" className="sticky left-0 z-10 bg-card px-1 text-left font-medium whitespace-nowrap">
                  <Link href={managerPath(r.name)} className="hover:text-primary">
                    {r.name}
                  </Link>
                </th>
                {(grid[r.managerId] ?? []).map((c) => {
                  const score = c.finalRank != null ? ((c.teams - c.finalRank) / Math.max(1, c.teams - 1)) * 100 : null;
                  return (
                    <td
                      key={c.year}
                      className="h-8 min-w-9 rounded text-center font-mono tabular-nums"
                      style={{ background: c.current ? "transparent" : heatColor(score) }}
                      title={`${c.year}: ${c.current ? `in progress (${c.record})` : c.finalRank ? `finished ${c.finalRank} of ${c.teams} (${c.record})` : "did not play"}${c.champion ? " — champion" : ""}${c.lastPlace ? " — last place" : ""}`}
                    >
                      {c.champion ? <Trophy className="mx-auto h-3.5 w-3.5 text-[#F0E442]" aria-label="champion" /> : c.current ? "●" : (c.finalRank ?? "")}
                      {c.lastPlace ? <span className="text-[9px]" aria-label="last place">▼</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
