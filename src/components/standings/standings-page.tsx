import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StandingsTable } from "@/components/standings/standings-table";
import { ChartFrame } from "@/components/charts/chart-frame";
import { LabeledScatter } from "@/components/charts/charts";
import { DivergingBars, HighlightLines } from "@/components/charts/team-charts";
import { getSeasonLuckWins } from "@/server/repositories/luck-repository";
import { getOddsHistory } from "@/server/repositories/odds-history-repository";
import { lastName } from "@/lib/chart-ticks";
import { formatLuckWins } from "@/server/stats/luck-wins";
import { getStandingsView } from "@/server/repositories/standings-repository";
import { listSeasons } from "@/server/repositories/season-repository";
import { cn } from "@/lib/utils";
import type { Season } from "@/generated/prisma/client";
import { BarChart3 } from "lucide-react";

/**
 * Standings for any season — the current one at /standings, past ones at
 * /standings/[season]. Both are pre-rendered (ISR).
 */
export async function StandingsPageView({ season }: { season: Season | null }) {
  const seasons = (await listSeasons()).filter((s) => s.status !== "UPCOMING").sort((a, b) => b.year - a.year);

  if (!season) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader art="header-standings" freshness eyebrow="League" title="Standings" />
        <div className="mt-8">
          <EmptyState icon={BarChart3} title="No active season yet" description="Once a season is created and synced, standings will appear here." />
        </div>
      </div>
    );
  }

  const [view, luck, oddsHistory] = await Promise.all([
    getStandingsView(season.id),
    getSeasonLuckWins(season.year),
    season.status === "IN_PROGRESS" ? getOddsHistory(season.year) : Promise.resolve([]),
  ]);
  // Charts label teams by manager surname — short, unique here, never cut mid-word.
  const nameOf = (r: (typeof view.rows)[number]) => lastName(r.managerName);
  const ledger = view.rows
    .map((r) => ({ r, l: luck.get(r.managerId) }))
    .filter((x) => x.l && x.l.tone !== "insufficient")
    .map(({ r, l }) => ({
      label: nameOf(r),
      value: Number(l!.luckWins.toFixed(1)),
      detail: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}, ${l!.expected.toFixed(1)} expected · ${l!.label}`,
    }));
  // Playoff odds by week: one row per week, one key per team.
  const oddsWeeks = [...new Set(oddsHistory.map((o) => o.week))].sort((a, b) => a - b);
  const oddsData = oddsWeeks.map((w) => {
    const row: Record<string, number | string | null> = { week: w };
    for (const o of oddsHistory.filter((x) => x.week === w)) row[o.fantasyTeamId] = Math.round(o.playoffPct * 10) / 10;
    return row;
  });
  const top6 = view.rows.slice(0, view.playoffTeams).map((r) => r.fantasyTeamId);
  const played = view.hasPlayedGames && view.rows.length > 0;
  const games = (r: (typeof view.rows)[number]) => Math.max(1, r.wins + r.losses + r.ties);
  const avgPf = played ? view.rows.reduce((s, r) => s + r.pointsFor / games(r), 0) / view.rows.length : 0;
  const avgPa = played ? view.rows.reduce((s, r) => s + r.pointsAgainst / games(r), 0) / view.rows.length : 0;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        art="header-standings"
        freshness
        eyebrow={`${season.year} Season`}
        title="Standings"
        description={
          view.hasPlayedGames
            ? "Record, points, all-play, expected wins, schedule luck — and, while the season is on, playoff odds."
            : "No game has been played this season, so there is nothing to rank yet."
        }
      />

      {/* Season picker */}
      <nav aria-label="Season" className="mt-4 flex flex-wrap gap-1.5">
        {seasons.map((s) => (
          <Link
            key={s.year}
            href={s.isCurrent ? "/standings" : `/standings/${s.year}`}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-4 text-sm",
              s.year === season.year ? "border-primary bg-primary/15 font-semibold text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
            aria-current={s.year === season.year ? "page" : undefined}
          >
            {s.year}
          </Link>
        ))}
      </nav>

      {!view.hasPlayedGames ? (
        <p className="mt-4 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">These are not rankings.</strong> {view.orderingLabel}.
        </p>
      ) : null}

      <div className="mt-6">
        {view.rows.length > 0 ? (
          <StandingsTable
            rows={view.rows}
            caption={view.orderingLabel}
            playoffTeams={view.playoffTeams}
            formLabel={view.throughWeek ? `Last 5 through Week ${view.throughWeek}` : "Form"}
          />
        ) : (
          <EmptyState icon={BarChart3} title="No teams on record yet" description="Standings will populate once the season's rosters are synced." />
        )}
      </div>

      {played ? (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          {ledger.length > 0 ? (
            <ChartFrame
              title="Luck ledger"
              caption="Wins above or below what each team's weekly scores would have earned against the whole league. Right of zero: the record flatters them."
              summary={`Luck in wins for ${ledger.length} teams. Luckiest: ${[...ledger].sort((x, y) => y.value - x.value)[0].label} (${formatLuckWins([...ledger].sort((x, y) => y.value - x.value)[0].value)}).`}
              table={{ headers: ["Team", "Luck (wins)", "Record and expected"], rows: ledger.map((d) => [d.label, d.value.toFixed(1), d.detail]) }}
              height="h-auto"
            >
              <DivergingBars data={ledger} valueLabel="Wins above expected" unit=" wins" />
            </ChartFrame>
          ) : null}
          <ChartFrame
            title="Points for vs. points against"
            caption="Per game. Dashed lines are the league averages."
            summary="Each team's points scored per game against points allowed per game, split into four quadrants at the league averages."
            table={{ headers: ["Team", "PF/game", "PA/game"], rows: view.rows.map((r) => [r.teamName, (r.pointsFor / games(r)).toFixed(1), (r.pointsAgainst / games(r)).toFixed(1)]) }}
            height="h-80"
          >
            <LabeledScatter
              points={view.rows.map((r) => ({
                x: r.pointsFor / games(r),
                y: r.pointsAgainst / games(r),
                label: nameOf(r),
                // Teams are identified by label; one accent for every dot.
                color: "var(--primary)",
                detail: `${r.teamName} · ${r.wins}-${r.losses}`,
              }))}
              xLabel="Points for / game"
              yLabel="Points against / game"
              quadrants={{ x: avgPf, y: avgPa }}
              quadrantLabels={["Bad + unlucky", "Good + unlucky", "Bad + lucky", "Good + lucky"]}
            />
          </ChartFrame>
          {oddsData.length > 1 ? (
            <ChartFrame
              className="lg:col-span-2"
              title="Playoff odds by week"
              caption={`Each team's chance of a top-${view.playoffTeams} finish after every week, from the same 10,000-season simulation as the table. The current top ${view.playoffTeams} are drawn bright; tap a team to follow it.`}
              summary={`Playoff odds for every team after weeks ${oddsWeeks[0]} to ${oddsWeeks.at(-1)}.`}
              table={{
                headers: ["Team", ...oddsWeeks.map((w) => `Week ${w}`)],
                rows: view.rows.map((r) => [r.teamName, ...oddsWeeks.map((w) => {
                  const o = oddsHistory.find((x) => x.week === w && x.fantasyTeamId === r.fantasyTeamId);
                  return o ? `${o.playoffPct.toFixed(0)}%` : "—";
                })]),
              }}
              height="h-auto"
            >
              <div>
                <HighlightLines
                  data={oddsData}
                  xKey="week"
                  xLabel="After week"
                  yLabel="Playoff odds"
                  yDomain={[0, 100]}
                  yTicks={[0, 25, 50, 75, 100]}
                  yFormat="pct"
                  series={view.rows.map((r) => ({ key: r.fantasyTeamId, label: nameOf(r) }))}
                  defaultEmphasis={top6}
                />
              </div>
            </ChartFrame>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
