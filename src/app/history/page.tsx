import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { LeagueScoringTrendChart } from "@/components/charts/league-scoring-trend-chart";
import { getLeagueScoringTrend, listSeasonsWithChampions } from "@/server/repositories/history-repository";
import { History as HistoryIcon, Trophy } from "lucide-react";

export const metadata = { title: "League History" };

export default async function HistoryPage() {
  const [seasons, trend] = await Promise.all([listSeasonsWithChampions(), getLeagueScoringTrend()]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Archive"
        title="League History"
        description="Every season, every champion, every finals matchup since founding."
      />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Season Index</h2>
          {seasons.length === 0 ? (
            <EmptyState icon={HistoryIcon} title="No seasons recorded yet" />
          ) : (
            <div className="space-y-3">
              {seasons.map((season) => (
                <Link key={season.id} href={`/history/${season.year}`}>
                  <Card className="transition-colors hover:border-primary/60">
                    <CardContent className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-heading text-xl font-semibold">{season.year}</p>
                        <Badge variant="outline" className="mt-1 text-[10px] uppercase">
                          {season.status.replace("_", " ")}
                        </Badge>
                      </div>
                      {season.championship ? (
                        <div className="flex items-center gap-2 text-right">
                          <div>
                            <p className="text-xs tracking-wide text-muted-foreground uppercase">
                              Champion
                            </p>
                            <p className="font-medium">{season.championship.championManager.displayName}</p>
                          </div>
                          <Trophy className="h-5 w-5 text-gold" />
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">In progress</span>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
            League Scoring Trend
          </h2>
          <Card>
            <CardContent>
              {trend.length === 0 ? (
                <EmptyState title="No scoring data yet" />
              ) : (
                <LeagueScoringTrendChart data={trend} />
              )}
            </CardContent>
          </Card>

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
    </div>
  );
}
