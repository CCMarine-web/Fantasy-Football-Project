import Link from "next/link";
import { CalendarDays, Radio, Trophy, Swords } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { cn } from "@/lib/utils";
import type { LeagueClock } from "@/server/league-clock";
import type { MatchupCardData } from "@/types/view-models";

/**
 * The homepage hero, driven by the league clock's phase — never by a
 * hard-coded date. (The old hero said "DRAFT IS HERE" until someone edited it.)
 *
 *   PRE_DRAFT        the draft countdown (rendered in the masthead) + date
 *   DRAFT_DAY        a link to the live draft board
 *   REGULAR_SEASON   during a game week: this week's slate with projections;
 *                    from MNF final until the next kickoff: last week's results
 *   PLAYOFFS         the bracket
 *   COMPLETE /
 *   OFFSEASON        nothing here — the champion and the season recap below
 *                    carry the page
 */

export interface HeroData {
  clock: LeagueClock;
  /** The focus week's games (slate or results). */
  games: MatchupCardData[];
  /** Postseason games so far, championship bracket only. */
  bracket: MatchupCardData[];
  draft: { iso: string | null; boardUrl: string | null };
}

function GameRow({ game }: { game: MatchupCardData }) {
  const final = game.status === "FINAL";
  const [a, b] = game.teams;
  const value = (t: typeof a) => (final ? t.score : t.projectedScore);
  const favored = !final && a.projectedScore != null && b.projectedScore != null
    ? a.projectedScore >= b.projectedScore ? 0 : 1
    : null;
  const upset =
    final && a.projectedScore != null && b.projectedScore != null && a.score != null && b.score != null
      ? (a.projectedScore > b.projectedScore) !== (a.score > b.score)
      : false;
  return (
    <Link
      href={`/matchups/${game.season}/${game.week}/${game.matchupId}`}
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/40"
    >
      {[a, b].map((t, i) => (
        <div key={t.fantasyTeamId} className={cn("flex min-w-0 items-center gap-2", i === 1 && "order-3 flex-row-reverse text-right")}>
          <TeamAvatar name={t.managerName} imageUrl={t.avatarUrl} className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <p className={cn("truncate text-sm font-medium", final && t.isWinner && "text-primary")}>{t.teamName}</p>
            <p className="truncate text-xs text-muted-foreground">{t.record ?? t.managerName}</p>
          </div>
        </div>
      ))}
      <div className="order-2 text-center font-mono text-sm tabular-nums">
        <span className={cn(final && a.isWinner && "font-bold text-primary", favored === 0 && "font-semibold")}>
          {value(a)?.toFixed(1) ?? "—"}
        </span>
        <span className="mx-1 text-muted-foreground">–</span>
        <span className={cn(final && b.isWinner && "font-bold text-primary", favored === 1 && "font-semibold")}>
          {value(b)?.toFixed(1) ?? "—"}
        </span>
        {upset ? <span className="block text-[10px] font-semibold tracking-wide text-destructive uppercase">upset</span> : null}
      </div>
    </Link>
  );
}

export function HomeHero({ data }: { data: HeroData }) {
  const { clock, games, bracket, draft } = data;

  if (clock.phase === "DRAFT_DAY") {
    return (
      <Card className="border-primary/50">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              <Radio className="h-3.5 w-3.5" aria-hidden /> Draft day
            </p>
            <p className="mt-1 font-heading text-2xl font-semibold">The {clock.seasonYear} draft is today.</p>
          </div>
          {draft.boardUrl ? (
            <a href={draft.boardUrl} target="_blank" rel="noreferrer" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Open the live draft board →
            </a>
          ) : (
            <Link href="/drafts" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Draft board →
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  if (clock.phase === "PRE_DRAFT") {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 text-sm">
          <CalendarDays className="h-4 w-4 text-primary" aria-hidden />
          {draft.iso
            ? `The ${clock.seasonYear} draft: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(draft.iso))}.`
            : `The ${clock.seasonYear} draft date hasn't been set yet.`}
        </CardContent>
      </Card>
    );
  }

  if (clock.phase === "PLAYOFFS" && bracket.length > 0) {
    const rounds = new Map<string, MatchupCardData[]>();
    for (const g of bracket) {
      const key = g.roundName ?? `Week ${g.week}`;
      rounds.set(key, [...(rounds.get(key) ?? []), g]);
    }
    return (
      <section aria-labelledby="hero-bracket">
        <h2 id="hero-bracket" className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
          <Trophy className="h-4 w-4 text-primary" aria-hidden /> {clock.seasonYear} Playoff Bracket
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {[...rounds.entries()].map(([round, gamesInRound]) => (
            <Card key={round}>
              <CardContent className="space-y-1">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{round}</p>
                {gamesInRound.map((g) => (
                  <GameRow key={g.matchupId} game={g} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    );
  }

  if ((clock.phase === "REGULAR_SEASON" || clock.phase === "PLAYOFFS") && games.length > 0) {
    const slate = clock.focus === "SLATE";
    const live = slate && clock.currentWeekState === "IN_PROGRESS";
    const hasProjections = games.some((g) => g.teams.some((t) => t.projectedScore != null));
    return (
      <section aria-labelledby="hero-week">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="hero-week" className="flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
            {slate ? <Swords className="h-4 w-4 text-primary" aria-hidden /> : <Trophy className="h-4 w-4 text-primary" aria-hidden />}
            {slate ? `Week ${clock.focusWeek} ${live ? "— in progress" : "slate"}` : `Week ${clock.focusWeek} results`}
          </h2>
          <Link href={`/matchups?week=${clock.focusWeek}`} className="text-sm text-primary hover:underline">
            Every matchup →
          </Link>
        </div>
        <Card>
          <CardContent className="divide-y divide-border/50">
            {games.map((g) => (
              <GameRow key={g.matchupId} game={g} />
            ))}
          </CardContent>
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">
          {slate
            ? hasProjections
              ? "Projected points from Sleeper's projections, scored with this league's settings; the favourite is in bold."
              : live
                ? "Live scores appear here once the week is final."
                : "Projections are published after Wednesday waivers."
            : "Final scores. “Upset” means the projected favourite lost."}
        </p>
      </section>
    );
  }

  return null;
}

/** A compact list of one week's games, for the "other" week under the hero. */
export function WeekGamesList({ title, games, href }: { title: string; games: MatchupCardData[]; href: string }) {
  if (games.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">{title}</h2>
        <Link href={href} className="text-sm text-primary hover:underline">
          View all
        </Link>
      </div>
      <Card>
        <CardContent className="divide-y divide-border/50">
          {games.map((g) => (
            <GameRow key={g.matchupId} game={g} />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
