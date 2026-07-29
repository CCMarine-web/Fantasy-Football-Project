import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { MatchupCard } from "@/components/shared/matchup-card";
import { StandingsTable } from "@/components/standings/standings-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { MatchupOfTheWeek } from "@/components/matchups/matchup-of-the-week";
import { getWeeklyHub } from "@/server/repositories/weekly-hub-repository";
import type { TransactionView } from "@/server/repositories/transaction-repository";
import { AlertTriangle, CalendarDays, Flame, Newspaper, Snowflake, Swords, TrendingUp } from "lucide-react";

export const metadata = {
  title: "Matchups",
  description:
    "This week in the league: the Matchup of the Week, every other game, standings, power rankings, transactions, streaks and the latest news — on one page.",
};

/*
 * Fully server-rendered. The week picker is a search param, so the route is
 * dynamic and a route-segment `revalidate` would be inert; the expensive
 * derivations underneath (power rankings, career aggregates) are cached at the
 * data layer instead — see server/cache.ts. The page arrives complete rather
 * than as four loading skeletons, which is what it replaced.
 *
 * This page was /weekly and titled "Weekly League Hub". Nobody arriving at a
 * fantasy football site is looking for "Weekly", and the featured game is now
 * the first thing on it, so it is /matchups and called Matchups. The old route
 * 308s here — see next.config.ts.
 */

/** UTC, minute precision. A "last synced" line that drifts by timezone is worse than none. */
function formatSyncTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const OUTCOME_STYLE: Record<TransactionView["outcome"], string> = {
  SUCCESSFUL: "bg-field/15 text-field border-field/40",
  FAILED: "bg-muted text-muted-foreground border-border/60",
  PENDING: "bg-gold/15 text-gold border-gold/40",
  REVERSED: "bg-destructive/15 text-destructive border-destructive/40",
};

function SectionHeading({
  id,
  icon: Icon,
  children,
  action,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2
        id={id}
        className="flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase"
      >
        <Icon className="h-5 w-5" />
        {children}
      </h2>
      {action}
    </div>
  );
}

function TransactionRow({ tx }: { tx: TransactionView }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border/60 bg-card/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`border ${OUTCOME_STYLE[tx.outcome]}`}>{tx.kindLabel}</Badge>
        {tx.faabSpent != null && tx.faabSpent > 0 ? (
          <Badge variant="secondary">${tx.faabSpent} FAAB</Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {tx.week != null ? `Week ${tx.week}` : tx.seasonYear}
        </span>
      </div>
      <p className="text-sm text-foreground/90">{tx.summary}.</p>
    </li>
  );
}

export default async function MatchupsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;
  const requested = weekParam ? Number(weekParam) : undefined;
  const hub = await getWeeklyHub(Number.isFinite(requested) ? requested : undefined);

  if (!hub) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="The League" title="Matchups" />
        <div className="mt-8">
          <EmptyState
            icon={CalendarDays}
            title="No season on record yet"
            description="Once a season is created and synced, this page becomes the one-stop view of the current week."
          />
        </div>
      </div>
    );
  }

  const inSeason = hub.phase.phase === "IN_SEASON";
  const periodLabel = inSeason && hub.week != null ? `Week ${hub.week}` : hub.phase.label;
  // The featured game gets the card above; showing it again in the grid beneath
  // makes the page read as though there is one more fixture than there is.
  const otherMatchups = hub.matchups.filter((m) => m.matchupId !== hub.featured?.matchupId);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${hub.seasonYear} Season`}
        title="Matchups"
        description="Everything that matters this week — the featured game, every other matchup, standings, rankings, the wire and the news — on one page."
      />

      {/* ── Where the season actually is, and the week switcher ─────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge className="bg-primary text-primary-foreground">
          {inSeason && hub.week != null ? `Updated through Week ${hub.week}` : periodLabel}
        </Badge>
        {!inSeason ? (
          <span className="text-sm text-muted-foreground">
            {hub.phase.phase === "PRESEASON"
              ? "The draft has not happened yet, so there are no rosters, scores or standings to report."
              : "The draft is done but no week has been played, so there are no scores yet."}
          </span>
        ) : null}
      </div>

      {/*
        How current the data is, stated plainly. A page that silently serves
        week-4 numbers in week 6 gives the reader no way to tell, and every
        figure on it is wrong in the same direction.
      */}
      <p className="mt-2 text-xs text-muted-foreground">
        {hub.sync.lastSuccessAt
          ? `Last successful data sync: ${formatSyncTime(hub.sync.lastSuccessAt)}.`
          : "No automated data sync has completed yet."}
      </p>

      {hub.sync.isStale ? (
        <p
          role="status"
          className="mt-2 flex items-start gap-2 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span>
            <strong className="font-semibold">Data may be out of date.</strong>{" "}
            {hub.sync.staleReason}
            {hub.sync.lastFailure ? ` Last attempt: ${formatSyncTime(hub.sync.lastFailure.at)}.` : ""}
          </span>
        </p>
      ) : null}

      {hub.availableWeeks.length > 1 ? (
        <nav
          aria-label="Choose a week"
          className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-card/30 p-2"
        >
          <span className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Week
          </span>
          {hub.availableWeeks.map((w) => (
            <Link
              key={w}
              href={`/matchups?week=${w}`}
              aria-current={hub.week === w ? "page" : undefined}
              className={
                hub.week === w
                  ? "rounded-md bg-primary px-2.5 py-1 text-sm font-medium tabular-nums text-primary-foreground"
                  : "rounded-md px-2.5 py-1 text-sm tabular-nums text-muted-foreground hover:text-foreground"
              }
            >
              {w}
            </Link>
          ))}
        </nav>
      ) : null}

      {/* ── In-page jump links, so a phone does not have to scroll blind ── */}
      <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {[
          ...(hub.featured ? [["#featured", "Matchup of the Week"] as const] : []),
          ["#matchups", "All Matchups"] as const,
          ["#standings", "Standings"] as const,
          ["#power", "Power Rankings"] as const,
          ["#wire", "Transactions"] as const,
          ["#form", "Streaks & Records"] as const,
          ["#news", "News"] as const,
        ].map(([href, label]) => (
          <a key={href} href={href} className="text-primary hover:underline">
            {label}
          </a>
        ))}
      </nav>

      {/*
        ── The featured game, above everything else ──────────────────────
        Chosen by server/stats/featured-matchup.ts — a pure function over
        verified figures. The AI writes the preview or recap from those same
        figures and it is read from the cache; no model picks the game and no
        model supplies a number on the card.
      */}
      {hub.featured ? (
        <section id="featured" className="mt-8 scroll-mt-20">
          <MatchupOfTheWeek featured={hub.featured} />
        </section>
      ) : null}

      {/* ── Weekly headline ─────────────────────────────────────────────── */}
      {hub.headline ? (
        <Card className="mt-8 border-primary/40">
          <CardContent>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {periodLabel} headline
            </p>
            <h2 className="mt-1 font-heading text-2xl font-semibold">{hub.headline.title}</h2>
            {hub.headline.excerpt ? (
              <p className="mt-2 text-sm leading-relaxed text-foreground/90">
                {hub.headline.excerpt}
              </p>
            ) : null}
            <Link
              href={hub.headline.href}
              className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
            >
              Read the full issue →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/*
        ── Every other matchup ──────────────────────────────────────────
        The "every week's matchups" link that used to sit here pointed at
        /matchups, which is now this page — a link to itself. The week switcher
        above covers every week of the season, and past seasons live on the
        history pages, so it is gone rather than replaced.
      */}
      <section className="mt-10">
        <SectionHeading
          id="matchups"
          icon={Swords}
          action={
            <Link href="/history" className="text-sm text-primary hover:underline">
              Previous seasons →
            </Link>
          }
        >
          {hub.week != null
            ? `${hub.featured ? "The Rest of " : ""}Week ${hub.week}`
            : "Matchups"}
        </SectionHeading>
        {otherMatchups.length === 0 ? (
          <EmptyState
            icon={Swords}
            title={
              hub.featured
                ? "That was the only game this week"
                : "No matchups scheduled yet"
            }
            description={
              hub.featured
                ? undefined
                : "The schedule appears here once the season is synced."
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {otherMatchups.map((m) => (
              <MatchupCard key={m.matchupId} data={m} />
            ))}
          </div>
        )}

        {hub.awards.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {hub.awards.map((a) => (
              <div
                key={a.type}
                className="rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
              >
                <p className="text-xs tracking-wide text-muted-foreground uppercase">{a.label}</p>
                <Link
                  href={`/managers/${a.managerId}`}
                  className="font-medium hover:text-primary"
                >
                  {a.managerName}
                </Link>
                <p className="text-xs text-muted-foreground">{a.description}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Standings ───────────────────────────────────────────────────── */}
      <section className="mt-10">
        <SectionHeading
          id="standings"
          icon={TrendingUp}
          action={
            <Link href="/standings" className="text-sm text-primary hover:underline">
              Full standings →
            </Link>
          }
        >
          Standings
        </SectionHeading>
        {/* Before week 1 the order is stated rather than presented as a
            ranking — see standings-repository. */}
        {hub.standings.length > 0 ? (
          <StandingsTable rows={hub.standings} caption={hub.standingsOrderingLabel} />
        ) : (
          <EmptyState
            title="No teams on record yet"
            description="Standings populate once the season's rosters are synced."
          />
        )}
      </section>

      {/* ── Power rankings preview ──────────────────────────────────────── */}
      <section className="mt-10">
        <SectionHeading
          id="power"
          icon={TrendingUp}
          action={
            <Link href="/power-rankings" className="text-sm text-primary hover:underline">
              Full rankings and method →
            </Link>
          }
        >
          {hub.powerRankingsTitle}
        </SectionHeading>
        {hub.powerRankings.length === 0 ? (
          <EmptyState title="Nothing to rank yet" />
        ) : (
          <ol className="divide-y divide-border/60 rounded-lg border border-border/60">
            {hub.powerRankings.map((row) => (
              <li key={row.fantasyTeamId} className="flex items-center gap-3 px-3 py-2">
                <span className="w-6 shrink-0 font-heading text-lg font-semibold tabular-nums text-muted-foreground">
                  {row.rank}
                </span>
                <TeamAvatar
                  name={row.managerName}
                  imageUrl={row.avatarUrl}
                  className="h-8 w-8 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{row.teamName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.managerName}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-primary">
                  {row.score.toFixed(1)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── The wire ────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <SectionHeading
          id="wire"
          icon={Newspaper}
          action={
            <Link href="/transactions" className="text-sm text-primary hover:underline">
              Full transaction archive →
            </Link>
          }
        >
          Transactions
        </SectionHeading>

        {!hub.hasTransactionData ? (
          <p className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {inSeason
              ? `No transactions are on record for ${hub.seasonYear}. For the ESPN-era seasons that is missing data rather than a quiet year — the platform does not retain transaction history for archived seasons.`
              : `Nobody has made a move yet in ${hub.seasonYear}. The wire opens once rosters exist.`}
          </p>
        ) : hub.successfulTransactions.length === 0 && hub.failedClaims.length === 0 ? (
          <EmptyState title="No moves this week" />
        ) : (
          <>
            {hub.successfulTransactions.length > 0 ? (
              <ul className="space-y-2">
                {hub.successfulTransactions.slice(0, 20).map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No completed moves this week.</p>
            )}

            {/*
             * Failed claims are collapsed by default. Seven managers bidding on
             * one player is seven rows of noise if they all render as moves, but
             * hiding them entirely loses the most interesting thing about a
             * waiver run — who else wanted him.
             */}
            {hub.failedClaims.length > 0 ? (
              <details className="mt-3 rounded-md border border-border/60 bg-card/20 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">
                  {hub.failedClaims.length} failed waiver claim
                  {hub.failedClaims.length === 1 ? "" : "s"} — show
                </summary>
                <ul className="mt-2 space-y-2">
                  {hub.failedClaims.slice(0, 40).map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>

      {/* ── Streaks and season marks ────────────────────────────────────── */}
      <section className="mt-10">
        <SectionHeading
          id="form"
          icon={Flame}
          action={
            <Link href="/records" className="text-sm text-primary hover:underline">
              All-time records →
            </Link>
          }
        >
          Streaks &amp; Season Marks
        </SectionHeading>

        {hub.streaks.length === 0 && hub.seasonNotables.length === 0 ? (
          <EmptyState title="Nothing on record for this season yet" />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs tracking-wide text-muted-foreground uppercase">
                Current streaks
              </h3>
              {hub.streaks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody is on a run of three or more.</p>
              ) : (
                <ul className="space-y-1.5">
                  {hub.streaks.map((s) => (
                    <li
                      key={s.managerId}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
                    >
                      <Link href={`/managers/${s.managerId}`} className="hover:text-primary">
                        {s.managerName}
                      </Link>
                      <span
                        className={`flex items-center gap-1.5 font-mono font-semibold ${s.kind === "WIN" ? "text-field" : "text-destructive"}`}
                      >
                        {s.kind === "WIN" ? (
                          <Flame className="h-4 w-4" aria-hidden />
                        ) : (
                          <Snowflake className="h-4 w-4" aria-hidden />
                        )}
                        {s.length} {s.kind === "WIN" ? "W" : "L"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs tracking-wide text-muted-foreground uppercase">
                {hub.seasonYear} marks
              </h3>
              {hub.seasonNotables.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scores on record yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {hub.seasonNotables.map((n) => (
                    <li
                      key={n.label}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-muted-foreground">
                          {n.label}
                        </span>
                        <span className="block truncate font-medium">{n.managerName}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono font-semibold tabular-nums">{n.value}</span>
                        <span className="block text-xs text-muted-foreground">{n.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Recent news ─────────────────────────────────────────────────── */}
      <section className="mt-10">
        <SectionHeading
          id="news"
          icon={Newspaper}
          action={
            <Link href="/news" className="text-sm text-primary hover:underline">
              News archive →
            </Link>
          }
        >
          League News
        </SectionHeading>
        {hub.recentNews.length === 0 ? (
          <EmptyState icon={Newspaper} title="Nothing published yet" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {hub.recentNews.map((n) => (
              <Link key={n.id} href={n.href} className="block">
                <Card className="transition-colors hover:border-primary/60">
                  <CardContent>
                    <span className="text-xs text-muted-foreground">
                      {n.seasonYear}
                      {n.week ? ` · Week ${n.week}` : ""}
                    </span>
                    <p className="mt-1 font-heading text-lg font-semibold">{n.title}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Where to go deeper ──────────────────────────────────────────── */}
      <section className="mt-10 rounded-lg border border-border/60 bg-card/20 p-4">
        <h2 className="mb-2 font-heading text-sm font-semibold tracking-wide uppercase">
          Go deeper
        </h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {[
            ["/history", "Season history"],
            ["/records", "Record book"],
            ["/hall-of-shame", "Hall of Shame"],
            ["/rivalries", "Rivalries"],
            ["/championship-belt", "Championship history"],
            ["/trade-tribunal", "Trade Tribunal"],
            ["/draft-report-cards", "Draft report cards"],
            ["/managers", "Managers"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="text-primary hover:underline">
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
