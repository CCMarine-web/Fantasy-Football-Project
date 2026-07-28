import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { ArrowDown, ArrowUp, Info, Minus, TrendingUp } from "lucide-react";

export const metadata = { title: "Power Rankings" };

function FactorBar({ label, weight, value, raw }: { label: string; weight: number; value: number; raw: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[13px] text-muted-foreground">
        {label} <span className="text-muted-foreground/60">{Math.round(weight * 100)}%</span>
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="w-28 shrink-0 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
        {raw}
      </span>
    </div>
  );
}

function Movement({ rank, previousRank }: { rank: number; previousRank: number | null }) {
  if (previousRank == null) return null;
  const delta = previousRank - rank;
  if (delta === 0) {
    return (
      <span className="flex items-center gap-0.5 text-[13px] text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden /> <span className="sr-only">No change</span>
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span className={`flex items-center gap-0.5 text-[13px] ${up ? "text-field" : "text-destructive"}`}>
      {up ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
      {Math.abs(delta)}
      <span className="sr-only">{up ? "places up" : "places down"}</span>
    </span>
  );
}

export default async function PowerRankingsPage() {
  const data = await getPowerRankings();

  if (!data || data.rows.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="The Rat Trap" title="Power Rankings" />
        <div className="mt-8">
          <EmptyState
            icon={TrendingUp}
            title="Nothing to rank yet"
            description="Power rankings appear once the league has teams for a season. They update every week during the season."
          />
        </div>
      </div>
    );
  }

  /*
   * Three states, three different things being ranked. The page names which
   * one it is showing rather than calling everything "Power Rankings" —
   * ranking managers on history and ranking freshly drafted rosters are not
   * the same claim, and neither is a live weekly rating.
   */
  const isInSeason = data.mode === "IN_SEASON";
  const isBaseline = data.mode === "MANAGER_BASELINE";
  const title = isInSeason
    ? "Power Rankings"
    : isBaseline
      ? "Manager Baseline Rankings"
      : "Preseason Power Rankings";
  const updatedLabel = isInSeason
    ? `Updated through Week ${data.throughWeek}`
    : isBaseline
      ? `${data.seasonYear} preseason — before the draft`
      : `${data.seasonYear} preseason — after the draft, before Week 1`;
  const description = isInSeason
    ? `A measure of how good each team is right now, rebuilt every week from ${data.weeksCounted} week${data.weeksCounted === 1 ? "" : "s"} of results. Wins and losses are not a scoring category — this rates team quality, not luck.`
    : isBaseline
      ? "The draft has not happened, so there is no roster to rank. This ranks the managers on what they have done in previous seasons, with schedule luck removed. It becomes Preseason Power Rankings as soon as the draft board is in."
      : "The draft is done and no week has been played, so this ranks the rosters that were just assembled — draft capital, what the drafted players have actually produced, bench cover and positional balance. It switches to live rankings once Week 1 is final.";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader eyebrow={`${data.seasonYear} Season`} title={title} description={description} />

      {/* Which of the three states this is, stated prominently. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge className="bg-primary text-primary-foreground">{updatedLabel}</Badge>
        {isInSeason ? <Badge variant="outline">Regular-season games only</Badge> : null}
        {isBaseline ? <Badge variant="outline">Not a projection of this year&rsquo;s teams</Badge> : null}
      </div>

      {/* Methodology — stated up front so the ranking is reproducible. */}
      <Card className="mt-6 border-border/60 bg-card/40">
        <CardContent>
          <h2 className="font-heading text-base font-semibold">How the score is built</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each factor is scored 0-100 relative to the rest of the league, then blended with the
            weights below.{" "}
            {isInSeason
              ? "Recent weeks carry more weight than early ones, but every week still counts."
              : "The model swaps to live results the moment Week 1 is final."}{" "}
            Win-loss record, championships and playoff finishes are deliberately{" "}
            <strong className="text-foreground">not</strong> inputs — they describe what happened to a
            team, not how good it is.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            A category with no data behind it is dropped and the remaining weights are rescaled to
            add up to 100%, rather than being scored zero or quietly treated as league-average. The
            percentages below are the ones actually used.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.weights.map((m) => (
              <div key={m.key} className="flex gap-2">
                <dt className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">
                  {Math.round(m.weight * 100)}%
                </dt>
                <dd className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{m.label}</span> — {m.description}
                </dd>
              </div>
            ))}
          </dl>
          {data.notes.map((note) => (
            <p key={note} className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              {note}
            </p>
          ))}
        </CardContent>
      </Card>

      <div className="mt-6 space-y-3">
        {data.rows.map((row) => (
          <Card key={row.fantasyTeamId}>
            <CardContent className="flex flex-col gap-4 lg:flex-row">
              {/* Rank */}
              <div className="flex shrink-0 flex-row items-center gap-3 lg:w-16 lg:flex-col lg:items-center lg:gap-1">
                <span className="font-heading text-3xl font-semibold tabular-nums">{row.rank}</span>
                <Movement rank={row.rank} previousRank={row.previousRank} />
              </div>

              {/* Team */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-9 w-9 shrink-0" />
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
                    <p className="truncate text-xs text-muted-foreground">{row.managerName}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {row.weightedPointsPerGame != null ? (
                    <Badge variant="outline" className="font-mono">
                      {row.weightedPointsPerGame.toFixed(1)} pts/gm
                    </Badge>
                  ) : null}
                  {isInSeason ? (
                    <>
                      <Badge variant="outline">
                        All-play {row.allPlayWins}-{row.allPlayLosses}
                        {row.allPlayTies ? `-${row.allPlayTies}` : ""}
                      </Badge>
                      {/* Record is context, never an input to the score. */}
                      <Badge variant="secondary" title="Actual record — shown for context, not used in the rating">
                        {row.record}
                      </Badge>
                      {row.luck != null && Math.abs(row.luck) >= 1 ? (
                        <Badge
                          variant="outline"
                          className={row.luck > 0 ? "text-field" : "text-destructive"}
                          title="Actual wins minus expected wins"
                        >
                          {row.luck > 0 ? "+" : ""}
                          {row.luck.toFixed(1)} vs expected
                        </Badge>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {row.blurb ? <p className="mt-2 text-sm text-foreground/90">{row.blurb}</p> : null}
              </div>

              {/* Score + factor breakdown */}
              <div className="shrink-0 lg:w-96">
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
