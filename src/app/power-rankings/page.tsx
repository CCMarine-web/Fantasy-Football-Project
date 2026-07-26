import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { POSTSEASON_LABELS } from "@/server/stats/season-power-rankings";
import { Trophy, TrendingUp } from "lucide-react";

export const metadata = { title: "Power Rankings" };

function FactorBar({ label, weight, value, raw }: { label: string; weight: number; value: number; raw: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-[13px] text-muted-foreground">
        {label} <span className="text-muted-foreground/60">{Math.round(weight * 100)}%</span>
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
        {raw}
      </span>
    </div>
  );
}

const PODIUM: Record<string, string> = {
  CHAMPION: "bg-gold text-gold-foreground",
  RUNNER_UP: "bg-secondary text-secondary-foreground",
  THIRD: "bg-secondary text-secondary-foreground",
};

export default async function PowerRankingsPage() {
  const data = await getPowerRankings();

  if (!data || data.rows.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="The Rat Trap" title="Power Rankings" />
        <div className="mt-8">
          <EmptyState
            icon={TrendingUp}
            title="No completed season to rank yet"
            description={
              data?.pendingSeasonYear
                ? `The ${data.pendingSeasonYear} season is still in progress. Final power rankings are published once a season is complete.`
                : "Final power rankings are published once a season has been played out."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${data.seasonYear} Season · Final`}
        title="Power Rankings"
        description={`How every team rated across the ${data.seasonYear} season — the most recently completed year. Built from settled results over ${data.weeksCounted} regular-season weeks plus the postseason; nothing here is a projection. This is a composite rating, not the final standings, so a team that got hot in the playoffs can still rate below a stronger regular season.`}
      />

      {/* Methodology — stated up front so the ranking is reproducible. */}
      <Card className="mt-6 border-border/60 bg-card/40">
        <CardContent>
          <h2 className="font-heading text-base font-semibold">How the score is built</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each factor is scored 0-100 relative to the other teams that season, then blended with the
            weights below. The season&apos;s best team on a factor scores 100 and the worst scores 0, so
            these are within-season comparisons.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.methodology.map((m) => (
              <div key={m.key} className="flex gap-2">
                <dt className="shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">
                  {Math.round(m.weight * 100)}%
                </dt>
                <dd className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{m.label}</span> — {m.description}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="mt-6 space-y-3">
        {data.rows.map((row) => (
          <Card key={row.fantasyTeamId}>
            <CardContent className="flex flex-col gap-4 sm:flex-row">
              {/* Rank */}
              <div className="flex shrink-0 flex-row items-center gap-3 sm:w-16 sm:flex-col sm:items-center sm:gap-1">
                <span className="font-heading text-3xl font-semibold tabular-nums">{row.rank}</span>
                {row.postseason === "CHAMPION" ? (
                  <Trophy className="h-4 w-4 text-gold" aria-label="Champion" />
                ) : null}
              </div>

              {/* Team */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-9 w-9" />
                  <div className="min-w-0">
                    {row.managerId ? (
                      <Link
                        href={`/managers/${row.managerId}`}
                        className="block truncate font-heading text-lg font-semibold hover:text-primary"
                      >
                        {row.teamName}
                      </Link>
                    ) : (
                      <span className="block truncate font-heading text-lg font-semibold">{row.teamName}</span>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {row.managerName} · {row.record} · {row.pointsFor.toLocaleString()} PF
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className={PODIUM[row.postseason] ?? ""} variant={PODIUM[row.postseason] ? undefined : "outline"}>
                    {POSTSEASON_LABELS[row.postseason]}
                  </Badge>
                  <Badge variant="outline">
                    All-play {row.allPlayWins}-{row.allPlayLosses}
                    {row.allPlayTies ? `-${row.allPlayTies}` : ""}
                  </Badge>
                </div>
                {row.blurb ? <p className="mt-2 text-sm text-foreground/90">{row.blurb}</p> : null}
              </div>

              {/* Score + factor breakdown */}
              <div className="shrink-0 sm:w-80">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs tracking-wide text-muted-foreground uppercase">Power Score</span>
                  <span className="font-heading text-2xl font-semibold tabular-nums text-primary">
                    {row.score.toFixed(1)}
                  </span>
                </div>
                <div className="space-y-1">
                  {row.factors.map((f) => (
                    <FactorBar key={f.key} label={f.label} weight={f.weight} value={f.value} raw={f.raw} />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
