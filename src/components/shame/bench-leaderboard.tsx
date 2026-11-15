import { ManagerLink } from "@/components/shared/manager-link";
import type { BenchCareer, BenchWeek } from "@/server/repositories/hall-of-shame-repository";

/**
 * Points left on the bench: the ten worst single weeks and the career totals.
 * Both tables scroll sideways inside themselves on a phone rather than pushing
 * the page wider.
 */
export function BenchLeaderboard({ weeks, career }: { weeks: BenchWeek[]; career: BenchCareer[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold tracking-wide uppercase">Worst single weeks</h3>
        <div className="relative overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-2 py-2 text-left sm:px-3">#</th>
                <th className="px-2 py-2 text-left sm:px-3">Manager</th>
                <th className="px-2 py-2 text-left whitespace-nowrap sm:px-3">Week</th>
                <th className="px-2 py-2 text-right sm:px-3">Started</th>
                <th className="px-2 py-2 text-right sm:px-3">Best</th>
                <th className="px-2 py-2 text-right sm:px-3">Left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {weeks.map((w) => (
                <tr key={`${w.managerId}-${w.year}-${w.week}`}>
                  <td className="px-2 py-2 font-mono text-muted-foreground tabular-nums sm:px-3">
                    {w.tied ? `T-${w.rank}` : w.rank}
                  </td>
                  <td className="px-2 py-2 sm:px-3">
                    <ManagerLink managerId={w.managerId} name={w.managerName}>
                      {w.managerName}
                    </ManagerLink>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted-foreground sm:px-3">
                    Wk {w.week}, {w.year}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums sm:px-3">{w.started.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right font-mono text-muted-foreground tabular-nums sm:px-3">
                    {w.optimal.toFixed(1)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums sm:px-3">{w.left.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold tracking-wide uppercase">Career totals</h3>
        <div className="relative overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-2 py-2 text-left sm:px-3">Manager</th>
                <th className="px-2 py-2 text-right sm:px-3">Left</th>
                <th className="px-2 py-2 text-right sm:px-3">Games</th>
                <th className="px-2 py-2 text-right whitespace-nowrap sm:px-3">Per game</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {career.map((c) => (
                <tr key={c.managerId}>
                  <td className="px-2 py-2 sm:px-3">
                    <ManagerLink managerId={c.managerId} name={c.managerName}>
                      {c.managerName}
                    </ManagerLink>
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums sm:px-3">
                    {c.total.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-muted-foreground tabular-nums sm:px-3">{c.weeks}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums sm:px-3">{c.perWeek.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
