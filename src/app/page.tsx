import Link from "next/link";
import { Trophy, Newspaper, TrendingUp, ArrowRightLeft, Quote as QuoteIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { MatchupCard } from "@/components/shared/matchup-card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { getHomepageData } from "@/server/repositories/homepage-repository";

export default async function HomePage() {
  const data = await getHomepageData();

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState
          icon={Trophy}
          title="Welcome to The Gridiron Gazette"
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
    defendingChampionship,
    recentTransactions,
    latestArticle,
    featuredMatchup,
    historicalFact,
  } = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="flex flex-col gap-6 border-b border-border/60 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.3em] text-primary uppercase">
            {season.year} Season · Week {currentWeek}
          </p>
          <h1 className="mt-2 font-heading text-4xl font-semibold tracking-wide uppercase sm:text-5xl">
            The Gridiron Gazette
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            The official record of the Gridiron Mayhem Fantasy Football League — scores, standings,
            history, and the occasional roast.
          </p>
        </div>
        {defendingChampionship ? (
          <Card className="w-full max-w-xs shrink-0 border-gold/40 bg-gold/5">
            <CardContent className="flex items-center gap-3">
              <Trophy className="h-8 w-8 text-gold" />
              <div>
                <p className="text-xs tracking-wide text-muted-foreground uppercase">
                  Defending Champion
                </p>
                <p className="font-heading text-lg font-semibold">
                  {defendingChampionship.championManager.displayName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {defendingChampionship.championFantasyTeam.teamName}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-8 lg:col-span-2">
          {featuredMatchup ? (
            <section>
              <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
                Featured Matchup
              </h2>
              <MatchupCard data={featuredMatchup} className="border-primary/40" />
            </section>
          ) : null}

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

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-primary" />
              <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                Weekly Headline
              </h2>
            </div>
            {latestArticle ? (
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
            ) : (
              <EmptyState title="No articles published yet" />
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Standings</h2>
              <Link href="/standings" className="text-sm text-primary hover:underline">
                Full table
              </Link>
            </div>
            <Card>
              <CardContent className="space-y-3">
                {standings.slice(0, 5).map((row, i) => (
                  <div key={row.fantasyTeamId} className="flex items-center gap-3">
                    <span className="w-4 font-mono text-sm text-muted-foreground">{i + 1}</span>
                    <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-7 w-7" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.teamName}</p>
                    </div>
                    <span className="font-mono text-sm text-muted-foreground">
                      {row.wins}-{row.losses}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                Power Rankings
              </h2>
            </div>
            <Card>
              <CardContent className="space-y-2">
                {standings.slice(0, 5).map((row, i) => (
                  <div key={row.fantasyTeamId} className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {i + 1}. {row.teamName}
                    </span>
                    <Badge variant="outline" className="font-mono">
                      {row.pointsFor.toFixed(0)} pts
                    </Badge>
                  </div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">
                  Full AI-generated power rankings commentary coming soon.
                </p>
              </CardContent>
            </Card>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-primary" />
              <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
                Recent Transactions
              </h2>
            </div>
            <Card>
              <CardContent className="space-y-3">
                {recentTransactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transactions yet.</p>
                ) : (
                  recentTransactions.map((tx) => (
                    <div key={tx.id} className="text-sm">
                      <Badge variant="outline" className="mb-1 text-[10px] uppercase">
                        {tx.type.replace("_", " ")}
                      </Badge>
                      <p className="text-muted-foreground">
                        {tx.assets
                          .map((a) => `${a.direction === "ADD" ? "+" : "−"}${a.player?.firstName ?? ""} ${a.player?.lastName ?? ""}`)
                          .join(", ")}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>

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
