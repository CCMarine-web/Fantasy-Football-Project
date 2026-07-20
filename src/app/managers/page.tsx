import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { Badge } from "@/components/ui/badge";
import { listManagerRows } from "@/server/repositories/manager-repository";
import { Trophy, Users, ChevronRight, Info } from "lucide-react";
import { BRAND } from "@/lib/branding";

export const metadata = { title: "Managers" };

export default async function ManagersPage() {
  const managers = await listManagerRows();
  const historyIncomplete = managers.some((m) => !m.statsComplete);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The League"
        title="Managers"
        description={`Every manager who has ever fielded a team in ${BRAND.longName}.`}
      />

      {historyIncomplete ? (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Career stats currently cover the seasons loaded from Sleeper (2023–present). Earlier
            seasons back to the league&apos;s founding are not yet imported, so records shown here are
            partial.
          </p>
        </div>
      ) : null}

      <div className="mt-8">
        {managers.length === 0 ? (
          <EmptyState icon={Users} title="No managers yet" description="Managers will appear here once the league is synced or seeded." />
        ) : (
          <div className="space-y-3">
            {managers.map((m) => (
              <Link key={m.managerId} href={`/managers/${m.managerId}`} className="block">
                <Card className="transition-colors hover:border-primary/60">
                  <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    {/* Identity */}
                    <div className="flex items-center gap-4 sm:w-64 sm:shrink-0">
                      <TeamAvatar name={m.displayName} imageUrl={m.photoUrl} className="h-14 w-14 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate font-heading text-lg font-semibold">{m.displayName}</p>
                        <p className="truncate text-sm text-muted-foreground">{m.currentTeamName}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.yearsActive} · {m.seasonsPlayed} {m.seasonsPlayed === 1 ? "season" : "seasons"}
                        </p>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <Badge variant="secondary" title="Career record">
                        {m.careerWins}-{m.careerLosses}
                        {m.careerTies ? `-${m.careerTies}` : ""}
                      </Badge>
                      <Badge variant="outline" title="Win %" className="font-mono">
                        {(m.winningPercentage * 100).toFixed(0)}%
                      </Badge>
                      {m.championships > 0 ? (
                        <Badge className="gap-1 bg-gold text-gold-foreground">
                          <Trophy className="h-3 w-3" />
                          {m.championships}&times;
                        </Badge>
                      ) : null}
                      {m.finalsAppearances > 0 ? (
                        <Badge variant="outline">{m.finalsAppearances} finals</Badge>
                      ) : null}
                      {m.bestFinish ? (
                        <Badge variant="outline" title="Best finish">
                          Best: {m.bestFinish === 1 ? "🏆 1st" : `#${m.bestFinish}`}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" title="Current season" className="font-mono">
                        {m.currentWins}-{m.currentLosses}
                        {m.currentTies ? `-${m.currentTies}` : ""} now
                      </Badge>
                    </div>

                    <ChevronRight className="hidden h-5 w-5 shrink-0 text-muted-foreground sm:block" />
                  </CardContent>

                  {m.performanceSummary ? (
                    <CardContent className="border-t border-border/40 pt-3">
                      <p className="text-sm text-foreground/80">{m.performanceSummary}</p>
                    </CardContent>
                  ) : null}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
