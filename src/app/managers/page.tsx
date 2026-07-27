import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { Badge } from "@/components/ui/badge";
import { getStatsCoverage, listManagerRows } from "@/server/repositories/manager-repository";
import { Trophy, Users, ChevronRight, Info } from "lucide-react";
import { BRAND } from "@/lib/branding";

export const metadata = { title: "Managers" };

export default async function ManagersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const tab: "active" | "retired" = status === "retired" ? "retired" : "active";

  const [all, coverage] = await Promise.all([listManagerRows(), getStatsCoverage()]);
  const active = all.filter((m) => m.isActive);
  const retired = all.filter((m) => !m.isActive);
  const managers = tab === "retired" ? retired : active;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The League"
        title="Managers"
        description={`Every manager who has ever fielded a team in ${BRAND.longName}.`}
      />

      {coverage.eras.length > 0 ? (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Career stats cover every season on record:{" "}
            {coverage.eras.map((era, index) => (
              <span key={era.key}>
                {index > 0 ? (index === coverage.eras.length - 1 ? " and " : ", ") : ""}
                <strong className="text-foreground">{era.label}</strong> {era.years}
              </span>
            ))}
            .
          </p>
        </div>
      ) : null}

      {/* Active / Retired tabs. Retired managers are those no longer in the
          league — they keep their full history and are never merged into an
          active manager. */}
      <div className="mt-6 inline-flex rounded-lg border border-border/60 bg-card/40 p-1">
        <Link
          href="/managers"
          aria-current={tab === "active" ? "page" : undefined}
          className={
            tab === "active"
              ? "rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
              : "rounded-md px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          Active <span className="tabular-nums opacity-70">({active.length})</span>
        </Link>
        <Link
          href="/managers?status=retired"
          aria-current={tab === "retired" ? "page" : undefined}
          className={
            tab === "retired"
              ? "rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
              : "rounded-md px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          Retired <span className="tabular-nums opacity-70">({retired.length})</span>
        </Link>
      </div>

      <div className="mt-6">
        {managers.length === 0 ? (
          tab === "retired" ? (
            <EmptyState
              icon={Users}
              title="No retired managers"
              description="Managers who leave the league are listed here with their full history intact, never merged into anyone else. Every manager in the ESPN era still plays today, so there are none yet."
            />
          ) : (
            <EmptyState icon={Users} title="No managers yet" description="Managers will appear here once the league is synced or seeded." />
          )
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
                      {/* The profiles are now several paragraphs. The list shows
                          the opening one so ten managers still fit on a screen;
                          the full piece lives on the manager's own page. */}
                      <p className="text-sm text-foreground/80">
                        {m.performanceSummary.split(/\n\s*\n/)[0]}
                      </p>
                      <span className="mt-1 inline-block text-xs font-medium text-primary">
                        Read the full profile →
                      </span>
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
