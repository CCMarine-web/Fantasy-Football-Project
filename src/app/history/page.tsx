import Link from "next/link";
import { pageMetadata } from "@/lib/indexing";
import { renderAtRequestIfNoDatabase } from "@/server/build-guard";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { LeagueScoringTrendChart, type ScoringAnnotation } from "@/components/charts/league-scoring-trend-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { SeasonIndexCardView } from "@/components/history/season-index-card";
import { DISCLOSURE_SUMMARY_CLASS, DisclosureChevron } from "@/components/shared/disclosure";
import {
  getLeagueScoringTrend,
  listSeasonIndex,
  listSeasonsWithChampions,
  listApprovedHistorySections,
  listSeasonPreviews,
} from "@/server/repositories/history-repository";
import { History as HistoryIcon, ScrollText } from "lucide-react";

/**
 * Pre-rendered (ISR). The data changes when the pipeline runs, and the pipeline
 * revalidates every page when it does; the hour is only a safety net.
 */
export const revalidate = 3600;

export const metadata = pageMetadata("/history", {
  title: "League History",
  description:
    "Every season of the Rat Trap Fantasy Football League since 2017: champions, runners-up, top seeds, last places and the league's scoring trend.",
});

/**
 * Changes that moved the scoring line, each from the commissioner's own
 * season recaps (2018: "transition to a decimal point scoring system";
 * 2019: "the league transitioned to a PPR format"; 2023: "transitioned to a
 * new platform, Sleeper"). The 2017 season had 8 teams; every season since
 * has had 10. The numbers in the 2019 note are read off the data at render.
 */
function scoringAnnotations(trend: { season: number; averageScore: number }[]): ScoringAnnotation[] {
  const avg = (y: number) => trend.find((t) => t.season === y)?.averageScore;
  const pre = avg(2018);
  const ppr = avg(2019);
  const out: ScoringAnnotation[] = [
    {
      season: 2018,
      label: "Decimals",
      side: "left",
      detail: "2018: decimal scoring arrives (goodbye, ties) and the league grows from 8 teams to 10.",
    },
    {
      season: 2019,
      label: "PPR",
      side: "right",
      detail:
        pre != null && ppr != null
          ? `2019: the league goes PPR. The average score jumps ${(ppr - pre).toFixed(1)} points a team (${pre.toFixed(1)} → ${ppr.toFixed(1)}).`
          : "2019: the league goes PPR.",
    },
    {
      season: 2023,
      label: "Sleeper",
      side: "right",
      detail: "2023: the league moves from ESPN to Sleeper. A platform change, not a scoring one.",
    },
  ];
  return out.filter((a) => trend.some((t) => t.season === a.season));
}


export default async function HistoryPage() {
  // Pre-rendered when the build can reach the database; otherwise rendered per request.
  await renderAtRequestIfNoDatabase();
  const [seasons, index, trend, narrative, articles] = await Promise.all([
    listSeasonsWithChampions(),
    listSeasonIndex(),
    getLeagueScoringTrend(),
    listApprovedHistorySections(),
    listSeasonPreviews(),
  ]);
  const annotations = scoringAnnotations(trend);
  const current = trend.find((t) => t.inProgress);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader art="header-history" freshness
        eyebrow="The Archive"
        title="League History"
        description="Every season, every champion, every finals matchup since founding."
      />

      {/* The season index comes first; the long retrospectives follow, collapsed. */}
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Season Index</h2>
          {index.length === 0 ? (
            <EmptyState icon={HistoryIcon} title="No seasons recorded yet" />
          ) : (
            <div className="space-y-3">
              {index.map((season) => (
                <SeasonIndexCardView key={season.id} season={season} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
            League Scoring Trend
          </h2>
          {trend.length === 0 ? (
            <EmptyState title="No scoring data yet" />
          ) : (
            <ChartFrame
              title="Average weekly score by season"
              caption={
                <>
                  Verified scores only. Dashed lines mark rule and platform changes: {annotations.map((a) => a.detail).join(" ")}
                  {current ? ` The hollow ${current.season} point is a season in progress.` : ""}
                </>
              }
              summary={`League-average weekly score per team from ${trend[0].season} to ${trend[trend.length - 1].season}. ${annotations.map((a) => a.detail).join(" ")}`}
              table={{
                headers: ["Season", "Avg. weekly score", "Note"],
                rows: trend.map((t) => [
                  `${t.season}${t.inProgress ? " (in progress)" : ""}`,
                  t.averageScore.toFixed(1),
                  annotations.find((a) => a.season === t.season)?.detail ?? "",
                ]),
              }}
            >
              <LeagueScoringTrendChart data={trend} annotations={annotations} />
            </ChartFrame>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="uppercase">Champions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {seasons
                .filter((s) => s.championship)
                .map((s) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <TeamAvatar
                      name={s.championship!.championManager.displayName}
                      imageUrl={s.championship!.championManager.avatarUrl}
                      className="h-8 w-8"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {s.championship!.championManager.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.year}</p>
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {articles.length > 0 ? (
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
              Season Retrospectives
            </h2>
          </div>
          <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
            The league&apos;s story season by season, built from the commissioner&apos;s own recaps and
            the verified record. Where a narrative detail and the numbers disagree, the season pages
            above are the record of truth. These are openings only — each season&apos;s full
            retrospective is on its own page.
          </p>
          {/* Collapsed by default: nine openings of prose made this the longest
              page on the site, and pushed the season index off the first
              screens. Each is still in the HTML, one tap away. */}
          <div className="space-y-2">
            {articles.map((article) => (
              <details key={article.id} className="group rounded-xl border border-border/60 bg-card">
                {/* The year lives here once. The article title deliberately
                    does not repeat it — the two together used to render as
                    "2023 2023 Season". */}
                <summary className={DISCLOSURE_SUMMARY_CLASS}>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2 font-heading text-base font-semibold">
                    <span className="font-mono text-primary">{article.year}</span>
                    <span className="uppercase">{article.title}</span>
                  </span>
                  <DisclosureChevron />
                </summary>
                <div className="px-3 pt-1 pb-4">
                  {/*
                   * 150-250 words, cut from the full article on a paragraph or
                   * sentence boundary. The index used to print all nine
                   * retrospectives in full — several thousand words, most of it
                   * restating the standings and champion shown in the season
                   * index. The complete recap is one click away.
                   */}
                  <div className="max-w-3xl space-y-4">
                    {article.preview.map((paragraph, i) => (
                      <p key={i} className="text-sm leading-relaxed text-foreground/90">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <Link
                    href={`/history/${article.year}`}
                    className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    {article.isTruncated
                      ? `Read the full ${article.year} retrospective, standings, playoffs and draft →`
                      : `${article.year} standings, playoffs and draft →`}
                  </Link>
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : narrative.length > 0 ? (
        // Fallback while the articles have not been generated yet: show the
        // commissioner's raw text rather than nothing at all.
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
              From the Commissioner
            </h2>
          </div>
          <div className="space-y-2">
            {narrative.map((s) => (
              <details key={s.id} className="group rounded-xl border border-border/60 bg-card">
                <summary className={DISCLOSURE_SUMMARY_CLASS}>
                  <span className="min-w-0 flex-1 font-heading text-base font-semibold uppercase">{s.title}</span>
                  <DisclosureChevron />
                </summary>
                <div className="px-3 pt-1 pb-4">
                  <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{s.body}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
