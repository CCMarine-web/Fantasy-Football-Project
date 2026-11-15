import Link from "next/link";
import { heatColor } from "@/lib/chart-theme";
import type { ActivityGridView } from "@/server/repositories/transaction-repository";
import type { MoveType } from "@/server/stats/transaction-activity";

const TYPE_LABEL: Record<MoveType, string> = {
  WAIVER: "waiver",
  FREE_AGENT: "free agent",
  TRADE: "trade",
  COMMISSIONER: "commissioner",
};

/**
 * Managers by weeks for one season: each cell the number of completed moves
 * that manager made that week, darker for busier. Hover for the split by type.
 */
export function ActivityGrid({ activity, seasonYear }: { activity: ActivityGridView; seasonYear: number }) {
  const { weeks, managers, cells, max } = activity;
  const totals = new Map(
    managers.map((m) => [m.id, weeks.reduce((sum, w) => sum + (cells[`${m.id}|${w}`]?.total ?? 0), 0)]),
  );

  return (
    <figure className="rounded-lg border border-border/60 bg-card/60 p-3 sm:p-4">
      <figcaption className="mb-2">
        <span className="block font-heading text-sm font-semibold tracking-wide uppercase">
          Wire activity, {seasonYear}
        </span>
        <span className="block text-xs text-muted-foreground">
          Completed moves per manager per week (adds, drops, claims and trades; a trade counts for both sides). Darker
          blue is a manager refreshing the app at 3 a.m. Each cell is the week’s total; hover for the split by type, or see every move in the archive below.
        </span>
      </figcaption>
      <div className="relative overflow-x-auto" role="region" aria-label="Wire activity grid, scrolls sideways" tabIndex={0}>
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card pr-2 text-left font-medium text-muted-foreground">
                Week
              </th>
              {weeks.map((w) => (
                <th key={w} scope="col" className="w-7 text-center font-medium tabular-nums text-muted-foreground">
                  {w}
                </th>
              ))}
              <th scope="col" className="px-1 text-right font-medium text-muted-foreground">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.id}>
                <th scope="row" className="sticky left-0 z-10 bg-card pr-2 text-left font-medium whitespace-nowrap">
                  <Link href={`/managers/${m.id}`} className="hover:text-primary">
                    {m.name}
                  </Link>
                </th>
                {weeks.map((w) => {
                  const cell = cells[`${m.id}|${w}`];
                  if (!cell) {
                    return (
                      <td key={w} className="h-7 w-7 rounded bg-muted/20 text-center">
                        <span className="sr-only">week {w}: no moves</span>
                      </td>
                    );
                  }
                  const breakdown = (Object.keys(TYPE_LABEL) as MoveType[])
                    .filter((t) => cell.byType[t])
                    .map((t) => `${cell.byType[t]} ${TYPE_LABEL[t]}`)
                    .join(", ");
                  const label = `${m.name}, week ${w}: ${cell.total} move${cell.total === 1 ? "" : "s"} (${breakdown})`;
                  return (
                    <td
                      key={w}
                      className="h-7 w-7 rounded text-center font-mono tabular-nums"
                      style={{ background: heatColor(50 + (50 * cell.total) / Math.max(1, max)) }}
                      title={label}
                    >
                      <span aria-hidden>{cell.total}</span>
                      <span className="sr-only">{label}</span>
                    </td>
                  );
                })}
                <td className="px-1 text-right font-mono tabular-nums text-muted-foreground">{totals.get(m.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
