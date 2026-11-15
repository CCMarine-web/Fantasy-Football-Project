import Link from "next/link";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { FormChips } from "@/components/shared/form-chips";
import { cn } from "@/lib/utils";
import { managerPath } from "@/lib/slug";
import type { StandingsRow } from "@/types/view-models";

/** "Patrick McManus" → "McManus": the phone column's short name. */
export function shortManagerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

/**
 * The standings table, used by /standings and the Matchups hub.
 *
 * Phone layout: every column is reachable by scrolling INSIDE the table (the
 * page itself never scrolls sideways); the rank and team columns stay pinned on
 * the left, and the team cell shows the manager's last name so it fits. The old
 * table hid five columns behind breakpoints with no way to reach them.
 *
 * The playoff cut line sits under the last team in the field, labelled.
 */
export function StandingsTable({
  rows,
  caption,
  playoffTeams,
  formLabel,
}: {
  rows: StandingsRow[];
  caption?: string;
  /** Draw the cut line after this many teams. Omit for no line. */
  playoffTeams?: number;
  /** e.g. "Last 5 through Week 9". */
  formLabel?: string;
}) {
  const gamesPlayed = rows.some((r) => r.wins + r.losses + r.ties > 0);
  const hasOdds = rows.some((r) => r.odds);
  const pct = (v: number) => (v >= 99.95 ? "100%" : v > 0 && v < 0.5 ? "<1%" : `${v.toFixed(0)}%`);
  const showCut = gamesPlayed && playoffTeams != null && playoffTeams > 0 && playoffTeams < rows.length;
  const pinned = "sticky z-10 bg-card";
  const th = "px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase whitespace-nowrap";
  const td = "px-3 py-2 font-mono tabular-nums whitespace-nowrap";

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      {caption ? (
        <p className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">{caption}</p>
      ) : null}
      <div className="relative overflow-x-auto" role="region" aria-label="Standings table, scrolls sideways" tabIndex={0}>
        <table className={cn("w-full border-separate border-spacing-0 text-sm", hasOdds ? "min-w-[1040px]" : "min-w-[720px]")}>
          <thead>
            <tr className="text-left">
              <th scope="col" className={cn(th, pinned, "left-0 w-10")}>#</th>
              <th scope="col" className={cn(th, pinned, "left-10 border-r border-border/40 sm:border-r-0")}>Team</th>
              <th scope="col" className={cn(th, "text-center")}>W-L-T</th>
              {hasOdds ? (
                <>
                  <th scope="col" className={cn(th, "text-right")} title="Share of 10,000 simulated seasons that end in the playoffs">Playoff</th>
                  <th scope="col" className={cn(th, "text-right")} title="Simulated chance of a first-round bye">Bye</th>
                  <th scope="col" className={cn(th, "text-right")} title="Simulated chance of winning the title">Title</th>
                  <th scope="col" className={cn(th, "text-right")} title="Simulated chance of finishing last">Last</th>
                </>
              ) : null}
              <th scope="col" className={cn(th, "text-right")} title="Points for">PF</th>
              <th scope="col" className={cn(th, "text-right")} title="Points against">PA</th>
              <th scope="col" className={cn(th, "text-center")} title="Record if you played every team every week">All-Play</th>
              <th scope="col" className={cn(th, "text-right")} title="Wins expected from all-play rate">Exp. W</th>
              <th scope="col" className={cn(th, "text-right")} title="Luck in wins: actual wins minus wins expected from scoring">Luck</th>
              <th scope="col" className={cn(th, "text-right")}>{formLabel ?? "Form"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const rank = row.rank || (gamesPlayed ? index + 1 : null);
              const lastIn = showCut && rank === playoffTeams;
              const border = lastIn ? "border-b-2 border-b-primary/70" : "border-b border-border/40";
              return (
                <tr key={row.fantasyTeamId} className="group">
                  <td className={cn(td, pinned, border, "left-0 w-10 text-muted-foreground")}>{rank ?? "—"}</td>
                  <td className={cn("px-3 py-2", pinned, border, "left-10 max-w-[9.5rem] border-r border-r-border/40 sm:max-w-none sm:border-r-0")}>
                    <Link
                      href={managerPath(row.managerName)}
                      className="flex items-center gap-3 hover:text-primary"
                      title={`${row.teamName} — ${row.managerName}`}
                    >
                      <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="hidden h-8 w-8 shrink-0 sm:flex" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm leading-snug font-semibold sm:hidden">
                          {shortManagerName(row.managerName)}
                        </span>
                        <span className="hidden text-sm leading-snug font-semibold break-words sm:block">{row.teamName}</span>
                        <span className="block truncate text-xs text-muted-foreground sm:whitespace-normal">
                          <span className="sm:hidden">{row.teamName}</span>
                          <span className="hidden sm:inline">{row.managerName}</span>
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className={cn(td, border, "text-center")}>
                    {row.wins}-{row.losses}
                    {row.ties ? `-${row.ties}` : ""}
                    {row.tiebreak ? (
                      <span className="ml-1 cursor-help text-[10px] text-muted-foreground" title={`Placed below the team above on ${row.tiebreak.toLowerCase()}`}>
                        TB
                      </span>
                    ) : null}
                  </td>
                  {hasOdds ? (
                    <>
                      <td className={cn(td, border, "text-right font-semibold")}>
                        {row.odds?.clinched ? (
                          <span className="rounded bg-field/20 px-1 text-field" title="Clinched a playoff spot">x</span>
                        ) : row.odds?.eliminated ? (
                          <span className="rounded bg-destructive/20 px-1 text-destructive" title="Eliminated from playoff contention">e</span>
                        ) : null}{" "}
                        {row.odds ? pct(row.odds.playoffPct) : "—"}
                      </td>
                      <td className={cn(td, border, "text-right text-muted-foreground")}>{row.odds ? pct(row.odds.byePct) : "—"}</td>
                      <td className={cn(td, border, "text-right text-muted-foreground")}>{row.odds ? pct(row.odds.titlePct) : "—"}</td>
                      <td className={cn(td, border, "text-right text-muted-foreground")}>{row.odds ? pct(row.odds.lastPct) : "—"}</td>
                    </>
                  ) : null}
                  <td className={cn(td, border, "text-right")}>{row.pointsFor.toFixed(1)}</td>
                  <td className={cn(td, border, "text-right text-muted-foreground")}>{row.pointsAgainst.toFixed(1)}</td>
                  <td className={cn(td, border, "text-center")}>{row.allPlayRecord ?? "—"}</td>
                  <td className={cn(td, border, "text-right")}>{row.expectedWins?.toFixed(1) ?? "—"}</td>
                  <td
                    className={cn(
                      td,
                      border,
                      "text-right",
                      (row.scheduleLuck ?? 0) > 0 && "text-field",
                      (row.scheduleLuck ?? 0) < 0 && "text-destructive",
                    )}
                  >
                    {row.scheduleLuck != null ? (row.scheduleLuck > 0 ? "+" : "") + row.scheduleLuck.toFixed(1) : "—"}
                  </td>
                  <td className={cn("px-3 py-2", border)}>
                    <div className="flex justify-end">
                      {row.recentForm && row.recentForm.length > 0 ? (
                        <FormChips form={row.recentForm} label={formLabel ?? "Form"} showLabel={false} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
        {showCut ? (
          <span className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-6 bg-primary/70" aria-hidden />
            Playoff line: top {playoffTeams} make the postseason
          </span>
        ) : (
          <span />
        )}
        <span className="sm:hidden">Swipe the table for more columns →</span>
        <span className="hidden sm:inline">
          Order: win %, then points for. TB = placed by tiebreaker.{hasOdds ? " Odds: 10,000 simulated seasons; x = clinched, e = eliminated." : ""}
        </span>
      </div>
    </div>
  );
}
