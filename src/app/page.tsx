import Link from "next/link";
import {
  Trophy,
  Newspaper,
  TrendingUp,
  ArrowRightLeft,
  CalendarDays,
  Quote as QuoteIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { MatchupCard } from "@/components/shared/matchup-card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { ChampionshipBeltFeature } from "@/components/championship/championship-belt-feature";
import { getHomepageData } from "@/server/repositories/homepage-repository";
import { getLastSeasonNarrative } from "@/server/repositories/season-narrative-repository";
import { getCurrentChampion } from "@/server/repositories/championship-belt-repository";
import { getPowerRankingsPreview } from "@/server/repositories/power-rankings-repository";
import { BRAND } from "@/lib/branding";
import { LEAGUE_CONFIG } from "@/lib/league-config";
import { DraftCountdown } from "@/components/home/draft-countdown";
import { initialRemaining } from "@/lib/countdown";
import { OffseasonPanel } from "@/components/home/offseason-panel";
import { getSeasonPhase } from "@/server/repositories/season-phase";
import { getOffseasonData } from "@/server/repositories/offseason-repository";

const TRANSACTION_LABEL: Record<string, string> = {
  WAIVER: "Waiver claim",
  FREE_AGENT: "Free-agent pickup",
  TRADE: "Trade",
  COMMISSIONER: "Commissioner action",
};

export default async function HomePage() {
  const [data, seasonNarrative, champion, powerPreview] = await Promise.all([
    getHomepageData(),
    getLastSeasonNarrative(),
    getCurrentChampion(),
    // Same computation as /power-rankings, just truncated, so the preview can
    // never disagree with the page it links to.
    getPowerRankingsPreview(5),
  ]);

  // Where the season actually is. The page used to announce "Week 1" in July
  // because it read the highest scheduled week rather than a played one.
  const phase = data ? await getSeasonPhase(data.season.id, data.season.year) : null;
  const offseason =
    data && phase && phase.phase !== "IN_SEASON"
      ? await getOffseasonData(data.season.id, data.season.year)
      : null;

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState
          icon={Trophy}
          title={`Welcome to ${BRAND.name}`}
          description="No active season is configured yet. Seed the database or configure a Sleeper league from the admin dashboard to bring this homepage to life."
        />
        <div className="mt-6 flex justify-center">
          <Button render={<Link href="/admin" />} nativeButton={false}>
            Go to Admin
          </Button>
        </div>
      </div>
    );
  }

  const {
    season,
    currentWeek,
    currentWeekMatchups,
    upcomingMatchups,
    standings,
    recentTransactions,
    latestArticle,
    featuredMatchup,
    historicalFact,
  } = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* 1 — League title + current week + draft countdown */}
      <section className="flex flex-col gap-6 border-b border-border/60 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.3em] text-primary uppercase">
            {/* "Week N" only once a week has actually been played. */}
            {phase?.phase === "IN_SEASON"
              ? `${season.year} Season · ${phase.label}`
              : (phase?.label ?? `${season.year} Season`)}
          </p>
          <h1 className="mt-2 font-heading text-4xl font-semibold tracking-wide uppercase sm:text-5xl">
            {BRAND.name}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            The official record of {BRAND.longName} — scores, standings, history, and the occasional
            roast.
          </p>
        </div>
        {LEAGUE_CONFIG.showDraftCountdown ? (
          <div className="w-full shrink-0 lg:max-w-xs">
            <DraftCountdown
              isoDate={LEAGUE_CONFIG.draftDate}
              timeZone={LEAGUE_CONFIG.draftTimeZone}
              initial={phase ? initialRemaining(LEAGUE_CONFIG.draftDate, phase.nowMs) : null}
            />
          </div>
        ) : null}
      </section>

      {/* Straight to the one-stop weekly view, now called Matchups. */}
      <div className="mt-6">
        <Button render={<Link href="/matchups" />} nativeButton={false}>
          <CalendarDays className="h-4 w-4" />
          {phase?.phase === "IN_SEASON"
            ? `This week in the league — ${phase.label}`
            : "Matchups"}
        </Button>
      </div>

      {/*
       * 2 — Championship Belt.
       *
       * The ONE champion feature on this page. The champion used to be
       * announced three times over: here, again in a "Season in Review" card,
       * and a third time inside the offseason panel's "Defending Champion"
       * section. The belt carries the reign counter, the title run and the
       * victory speech, so it is the one that stays; the season-review card
       * below now leads on the season's story rather than restating the winner,
       * and the offseason panel's duplicate has been removed.
       */}
      {champion ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-gold" />
            <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
              The Championship Belt
            </h2>
          </div>
          {/* No `summary` here on purpose: the season's prose belongs to the
              "How <year> Went" panel below, and passing it here printed the
              same paragraph twice within one screen. */}
          <ChampionshipBeltFeature champion={champion} nowMs={phase?.nowMs ?? undefined} />
        </section>
      ) : null}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-8 lg:col-span-2">
          {/* 3 — Current matchups */}
          {/* A "featured matchup" with no scores and no form behind it is just
              two names, so it waits until the season starts. */}
          {featuredMatchup && phase?.phase === "IN_SEASON" ? (
            <section>
              <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
                Featured Matchup
              </h2>
              <MatchupCard data={featuredMatchup} className="border-primary/40" />
            </section>
          ) : null}

          {/*
           * Before the season starts there are no matchups worth showing, and
           * an empty "Week 1 Matchups" grid told a visitor nothing. What the
           * offseason actually has is a draft to look forward to and a season
           * just finished to look back on, so that is what fills the space.
           */}
          {phase?.phase === "IN_SEASON" ? (
            <>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                    Week {currentWeek} Matchups
                  </h2>
                  <Link href="/matchups" className="text-sm text-primary hover:underline">
                    View all
                  </Link>
                </div>
                {currentWeekMatchups.length === 0 ? (
                  <EmptyState title="No matchups yet" description="Check back once this week is scheduled." />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {currentWeekMatchups.map((m) => (
                      <MatchupCard key={m.matchupId} data={m} />
                    ))}
                  </div>
                )}
              </section>

              {upcomingMatchups.length > 0 ? (
                <section>
                  <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
                    Up Next — Week {currentWeek + 1}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {upcomingMatchups.map((m) => (
                      <MatchupCard key={m.matchupId} data={m} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <OffseasonPanel phase={phase} narrative={seasonNarrative} data={offseason} />
          )}

          {/*
           * 6 — The week's headline, ONLY when there is one.
           *
           * This used to render "No articles published yet" every day of the
           * offseason: a heading, a bordered box and an apology, occupying the
           * best space on the page to say nothing. A section with no content is
           * not shown at all.
           */}
          {latestArticle ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-primary" />
                <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                  Weekly Headline
                </h2>
              </div>
              <Card>
                <CardContent>
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">
                    Week {latestArticle.week} · {latestArticle.season.year}
                  </p>
                  <Link
                    href={`/news/${latestArticle.season.year}/${latestArticle.week}`}
                    className="mt-1 block font-heading text-xl font-semibold hover:text-primary"
                  >
                    {latestArticle.title}
                  </Link>
                  {latestArticle.sections[0] ? (
                    <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                      {latestArticle.sections[0].body}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          {/*
           * 4 — Standings, but only once they mean something. Ten teams at 0-0
           * were being numbered 1 to 10, which reads as a table and is not one:
           * the order was alphabetical by whatever the query returned. Before
           * kickoff the same teams are listed with no rank numbers and an
           * explicit note about the ordering.
           */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                {phase?.phase === "IN_SEASON" ? "Standings" : "The League"}
              </h2>
              <Link href="/standings" className="text-sm text-primary hover:underline">
                Full table
              </Link>
            </div>
            <Card>
              <CardContent className="space-y-3">
                {phase?.phase !== "IN_SEASON" ? (
                  <p className="text-xs text-muted-foreground">
                    Nobody has played a game, so there is nothing to rank yet. Listed alphabetically.
                  </p>
                ) : null}
                {(phase?.phase === "IN_SEASON"
                  ? standings.slice(0, 5)
                  : [...standings].sort((a, b) => a.managerName.localeCompare(b.managerName)).slice(0, 5)
                ).map((row, i) => (
                  <div key={row.fantasyTeamId} className="flex items-center gap-3">
                    {phase?.phase === "IN_SEASON" ? (
                      <span className="w-4 font-mono text-sm text-muted-foreground">{i + 1}</span>
                    ) : null}
                    <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-7 w-7" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.teamName}</p>
                      {phase?.phase !== "IN_SEASON" ? (
                        <p className="truncate text-xs text-muted-foreground">{row.managerName}</p>
                      ) : null}
                    </div>
                    {phase?.phase === "IN_SEASON" ? (
                      <span className="font-mono text-sm text-muted-foreground">
                        {row.wins}-{row.losses}
                      </span>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          {/* 5 — Power rankings */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                {powerPreview?.mode === "MANAGER_BASELINE"
                  ? "Manager Baseline"
                  : powerPreview?.mode === "PRESEASON"
                    ? "Preseason Power Rankings"
                    : "Power Rankings"}
              </h2>
            </div>
            <Card>
              <CardContent className="space-y-2">
                {powerPreview && powerPreview.rows.length > 0 ? (
                  <>
                    {/* Must read identically to the page it links to. */}
                    <p className="text-xs text-muted-foreground">
                      {powerPreview.mode === "IN_SEASON"
                        ? `Updated through Week ${powerPreview.throughWeek}`
                        : powerPreview.mode === "MANAGER_BASELINE"
                          ? "Manager baseline — before the draft"
                          : "Preseason — after the draft, before Week 1"}
                    </p>
                    {powerPreview.rows.map((row) => (
                      <div key={row.fantasyTeamId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate font-medium">
                          {row.rank}. {row.teamName}
                        </span>
                        <Badge variant="outline" className="shrink-0 font-mono" title="Power score">
                          {row.score.toFixed(1)}
                        </Badge>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Power rankings appear once the season has teams.</p>
                )}
                <Link href="/power-rankings" className="inline-block pt-2 text-xs text-primary hover:underline">
                  Full power rankings →
                </Link>
              </CardContent>
            </Card>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-primary" />
                <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                  Recent Transactions
                </h2>
              </div>
              <Link href="/transactions" className="text-sm text-primary hover:underline">
                The wire
              </Link>
            </div>
            <Card>
              <CardContent className="space-y-3">
                {recentTransactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {phase?.phase === "IN_SEASON"
                      ? "No transactions yet this season."
                      : "The wire is quiet until the season starts."}
                  </p>
                ) : (
                  recentTransactions.map((tx) => (
                    <div key={tx.id} className="text-sm">
                      {/* A readable label, not the database enum. */}
                      <Badge variant="outline" className="mb-1 text-[12px]">
                        {TRANSACTION_LABEL[tx.type]}
                      </Badge>
                      <p className="text-muted-foreground">
                        {tx.assets
                          .filter((a) => a.player)
                          .map(
                            (a) =>
                              `${a.direction === "ADD" ? "+" : "−"}${a.player!.firstName} ${a.player!.lastName}`,
                          )
                          .join(", ") || "no players recorded"}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>

          {/* 7 — Historical content */}
          {historicalFact ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <QuoteIcon className="h-4 w-4 text-primary" />
                <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                  From the Archives
                </h2>
              </div>
              <Card className="border-gold/30 bg-gold/5">
                <CardContent>
                  <p className="text-sm italic">&ldquo;{historicalFact.text}&rdquo;</p>
                  {historicalFact.manager ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      — {historicalFact.manager.displayName}
                      {historicalFact.context ? `, ${historicalFact.context}` : ""}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
