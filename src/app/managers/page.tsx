import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { Badge } from "@/components/ui/badge";
import { getStatsCoverage, listManagerRows } from "@/server/repositories/manager-repository";
import { getCareerLuck } from "@/server/repositories/luck-repository";
import { LuckScoreBadge } from "@/components/managers/luck-score";
import { LUCK_BANDS, LUCK_CLOSE_GAME_MARGIN, LUCK_WEIGHTS } from "@/server/stats/luck";
import { LAST_PLACE_METHODOLOGY } from "@/server/stats/last-place";
import { Trophy, Users, ChevronRight, Info } from "lucide-react";
import { BRAND } from "@/lib/branding";

export const metadata = { title: "Managers" };

/*
 * Server-rendered. The active/retired tab is a search param, which makes the
 * route dynamic, so the caching that matters happens at the data layer:
 * listManagerRows() and getCareerLuck() are both cached (server/cache.ts).
 * Re-deriving ten managers' whole careers per visitor bought nothing but a
 * loading skeleton.
 */

export default async function ManagersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const tab: "active" | "retired" = status === "retired" ? "retired" : "active";

  const [all, coverage, luckByManager] = await Promise.all([
    listManagerRows(),
    getStatsCoverage(),
    getCareerLuck(),
  ]);
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

      {/*
       * What each record on this page counts. Postseason records used to be
       * presented as one "career record", so a manager who went 2-0 in a
       * consolation bracket read as having won two playoff games. Consolation
       * results are no longer shown at all: they decide nothing and the site
       * does not keep a public record of them.
       */}
      <details className="mt-4 rounded-md border border-border/60 bg-card/30 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">
          How records and the Luck Score are defined
        </summary>
        <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
          <div>
            <dt className="inline font-medium text-foreground">Regular season (reg.) — </dt>
            <dd className="inline">
              the scheduled weeks before the postseason. Nothing else is counted, so this is the
              record that appears in the season-by-season tables and in the written profiles.
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Playoffs — </dt>
            <dd className="inline">
              championship-bracket games only: the games that decide the title. A manager with no
              playoff berths has no playoff record, not an 0-0 one.
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Last place — </dt>
            <dd className="inline">
              seasons finished bottom of the <strong>regular-season</strong> standings.{" "}
              {LAST_PLACE_METHODOLOGY}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-foreground">Luck Score — </dt>
            <dd className="inline">
              0 to 100 with 50 neutral, measuring how much the schedule helped rather than how good
              a manager is. Wins against all-play expectation{" "}
              {(LUCK_WEIGHTS.winsVsExpected * 100).toFixed(0)}%, opponent scoring{" "}
              {(LUCK_WEIGHTS.opponentScoring * 100).toFixed(0)}%, record in games under{" "}
              {LUCK_CLOSE_GAME_MARGIN} points {(LUCK_WEIGHTS.closeGames * 100).toFixed(0)}%, schedule
              strength {(LUCK_WEIGHTS.scheduleStrength * 100).toFixed(0)}%, championship-bracket draw{" "}
              {(LUCK_WEIGHTS.postseasonDraw * 100).toFixed(0)}%. Consolation games are never an
              input. Computed from recorded scores; a manager with too few games shows &ldquo;not
              enough games&rdquo; rather than &ldquo;neutral&rdquo;. Labels:{" "}
              {LUCK_BANDS.map((b) => `${b.min === b.max ? b.min : `${b.min}–${b.max}`} ${b.label}`).join(", ")}.
              Full breakdown is on each manager&rsquo;s page.
            </dd>
          </div>
        </dl>
      </details>

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

                    {/* Stats. Every record here is labelled with the games it
                        covers — a career record and a championship-bracket
                        record are two different facts. Consolation games are
                        not counted or shown. */}
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <Badge variant="secondary" title="Career regular-season record">
                        {m.careerWins}-{m.careerLosses}
                        {m.careerTies ? `-${m.careerTies}` : ""} reg.
                      </Badge>
                      <Badge variant="outline" title="Regular-season win %" className="font-mono">
                        {(m.winningPercentage * 100).toFixed(0)}%
                      </Badge>
                      {m.playoffWins + m.playoffLosses > 0 ? (
                        <Badge
                          variant="outline"
                          title="Championship-bracket record — the games that decide the title"
                          className="font-mono"
                        >
                          {m.playoffWins}-{m.playoffLosses} playoffs
                        </Badge>
                      ) : null}
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
                      {m.lastPlaceFinishes > 0 ? (
                        <Badge
                          variant="outline"
                          title={`Finished last in the regular-season standings in ${m.lastPlaceYears.join(", ")}. ${LAST_PLACE_METHODOLOGY}`}
                          className="text-destructive"
                        >
                          {m.lastPlaceFinishes}× last
                        </Badge>
                      ) : null}
                      {/* A 0-0 "now" record in the preseason is not information;
                          it reads as though everyone has played and drawn. */}
                      {m.currentWins + m.currentLosses + m.currentTies > 0 ? (
                        <Badge
                          variant="outline"
                          title="Current season, regular season"
                          className="font-mono"
                        >
                          {m.currentWins}-{m.currentLosses}
                          {m.currentTies ? `-${m.currentTies}` : ""} now
                        </Badge>
                      ) : null}
                      {luckByManager.get(m.managerId) ? (
                        <LuckScoreBadge luck={luckByManager.get(m.managerId)!} />
                      ) : null}
                    </div>

                    <ChevronRight className="hidden h-5 w-5 shrink-0 text-muted-foreground sm:block" />
                  </CardContent>

                  {m.summaryCard ? (
                    <CardContent className="border-t border-border/40 pt-3">
                      {/* The full profiles run 450-650 words. This card carries
                          120-180 of them — derived from the same text, never
                          written separately, so the two can never disagree. See
                          cardSummary() in the manager repository. */}
                      {m.summaryCard.split(/\n\s*\n/).map((paragraph, i) => (
                        <p key={i} className={i === 0 ? "text-sm text-foreground/80" : "mt-2 text-sm text-foreground/80"}>
                          {paragraph}
                        </p>
                      ))}
                      <span className="mt-2 inline-block text-xs font-medium text-primary">
                        View full profile →
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
