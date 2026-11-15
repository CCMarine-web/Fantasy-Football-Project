import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StandingsTable } from "@/components/standings/standings-table";
import { ChartFrame } from "@/components/charts/chart-frame";
import { LabeledScatter, SimpleBars } from "@/components/charts/charts";
import { getStandingsView } from "@/server/repositories/standings-repository";
import { listSeasons } from "@/server/repositories/season-repository";
import { teamColorMap } from "@/lib/chart-theme";
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
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader art="header-standings" freshness eyebrow="League" title="Standings" />
        <div className="mt-8">
          <EmptyState icon={BarChart3} title="No active season yet" description="Once a season is created and synced, standings will appear here." />
        </div>
      </div>
    );
  }

  const view = await getStandingsView(season.id);
  const colors = teamColorMap(view.rows.map((r) => r.managerId));
  const short = (name: string) => (name.length > 14 ? `${name.slice(0, 13)}…` : name);
  const played = view.hasPlayedGames && view.rows.length > 0;
  const games = (r: (typeof view.rows)[number]) => Math.max(1, r.wins + r.losses + r.ties);
  const avgPf = played ? view.rows.reduce((s, r) => s + r.pointsFor / games(r), 0) / view.rows.length : 0;
  const avgPa = played ? view.rows.reduce((s, r) => s + r.pointsAgainst / games(r), 0) / view.rows.length : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
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
              "inline-flex min-h-9 items-center rounded-full border px-3 text-sm",
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
                label: short(r.teamName),
                color: colors.get(r.managerId) ?? "var(--primary)",
                detail: `${r.managerName} · ${r.wins}-${r.losses}`,
              }))}
              xLabel="Points for / game"
              yLabel="Points against / game"
              quadrants={{ x: avgPf, y: avgPa }}
              quadrantLabels={["Bad + unlucky", "Good + unlucky", "Bad + lucky", "Good + lucky"]}
            />
          </ChartFrame>
          <ChartFrame
            title="Actual vs. expected wins"
            caption="Expected wins come from how many teams each score would have beaten that week."
            summary="Bars compare each team's actual wins with the wins its weekly scores would be expected to produce."
            table={{ headers: ["Team", "Wins", "Expected"], rows: view.rows.map((r) => [r.teamName, r.wins, r.expectedWins?.toFixed(1) ?? "—"]) }}
            height="h-80"
          >
            <SimpleBars
              horizontal
              data={view.rows.map((r) => ({ label: short(r.teamName), value: r.wins, value2: r.expectedWins ?? 0, color: colors.get(r.managerId) }))}
              valueLabel="Wins"
              value2Label="Expected wins"
              valueFormat="fixed1"
            />
          </ChartFrame>
        </div>
      ) : null}
    </div>
  );
}
