import { prisma, isDatabaseUnavailableError } from "@/lib/db";
import { getCurrentSeason } from "@/server/repositories/season-repository";
import { getMatchupsForWeek } from "@/server/repositories/matchup-repository";
import { getStandingsForSeason } from "@/server/repositories/standings-repository";
import { getLeagueClock, withClockStatus } from "@/server/league-clock";
import { draftDateFor } from "@/lib/draft-date";
import type { HeroData } from "@/components/home/home-hero";
import type { MatchupCardData } from "@/types/view-models";
import { withLiveScores } from "@/server/live-scores";

/**
 * Returns homepage data, or `null` when there's nothing to show yet — either
 * no season has been configured, OR the database is unreachable/unconfigured
 * (common on a fresh deploy before DATABASE_URL is set and migrations/sync
 * have run). Both cases render the homepage's welcome/empty state as a clean
 * 200 rather than a 500. Genuine query bugs still throw and hit error.tsx.
 */
export async function getHomepageData() {
  try {
    return await loadHomepageData();
  } catch (err) {
    if (isDatabaseUnavailableError(err)) {
      return null;
    }
    throw err;
  }
}

async function loadHomepageData() {
  const season = await getCurrentSeason();
  if (!season) {
    return null;
  }

  /*
   * Which weeks to show comes from the league clock (server/league-clock.ts),
   * the one definition of "what week is it" — not from the database alone,
   * which only learns a week has started when the next sync runs. Results are
   * the last week with stored final scores; the slate is the week being played
   * or next to be played.
   */
  const clock = await getLeagueClock();
  const currentWeek = clock?.lastStoredWeek ?? 1;
  const slateWeek = clock?.currentWeek ?? null;

  const [currentWeekMatchups, upcomingMatchups, standings, defendingChampionship, recentTransactions, latestArticle, randomQuote] =
    await Promise.all([
      getMatchupsForWeek(season.id, currentWeek, season.year),
      slateWeek != null && slateWeek !== clock?.lastStoredWeek
        ? getMatchupsForWeek(season.id, slateWeek, season.year)
        : Promise.resolve([]),
      getStandingsForSeason(season.id),
      prisma.championship.findFirst({
        where: { season: { year: season.year - 1 } },
        include: { championFantasyTeam: true, championManager: true },
      }),
      // Completed moves only — a failed waiver claim is not a transaction
      // anyone made, and the sidebar has no room to explain that.
      prisma.transaction.findMany({
        where: { seasonId: season.id, status: "COMPLETE" },
        include: { assets: { include: { player: true, fantasyTeam: { include: { manager: { select: { displayName: true } } } } } } },
        orderBy: { processedAt: "desc" },
        take: 5,
      }),
      prisma.article.findFirst({
        where: { seasonId: season.id, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        include: { season: true, sections: { orderBy: { order: "asc" }, take: 1 } },
      }),
      prisma.historicalQuote.findMany({
        where: { approvalStatus: "APPROVED" },
        include: { manager: true },
      }),
    ]);

  const featuredMatchup =
    [...currentWeekMatchups].sort((a, b) => {
      const aGap = Math.abs((a.teams[0].projectedScore ?? a.teams[0].score ?? 0) - (a.teams[1].projectedScore ?? a.teams[1].score ?? 0));
      const bGap = Math.abs((b.teams[0].projectedScore ?? b.teams[0].score ?? 0) - (b.teams[1].projectedScore ?? b.teams[1].score ?? 0));
      return aGap - bGap;
    })[0] ?? null;

  const historicalFact =
    randomQuote.length > 0 ? randomQuote[Math.floor(randomQuote.length / 2)] : null;

  /*
   * The phase-driven hero: the focus week's games (the live slate, or last
   * week's results), the championship bracket in the playoffs, the draft
   * board link on draft day.
   */
  let hero: HeroData | null = null;
  if (clock) {
    const [focusGames, bracketRows, draft] = await Promise.all([
      clock.focusWeek != null ? getMatchupsForWeek(season.id, clock.focusWeek, season.year) : Promise.resolve([] as MatchupCardData[]),
      clock.phase === "PLAYOFFS"
        ? prisma.matchup.findMany({
            where: { seasonId: season.id, isPlayoff: true, bracketType: "WINNERS" },
            select: { week: true },
            distinct: ["week"],
          })
        : Promise.resolve([] as { week: number }[]),
      prisma.draft.findFirst({ where: { seasonId: season.id }, select: { sleeperDraftId: true } }),
    ]);
    const bracketWeeks = await Promise.all(bracketRows.map((r) => getMatchupsForWeek(season.id, r.week, season.year)));
    hero = {
      clock,
      games: await withLiveScores(withClockStatus(focusGames, clock), clock),
      bracket: bracketWeeks.flat().filter((g) => g.isPlayoff),
      draft: {
        iso: draftDateFor(season.year),
        boardUrl: draft?.sleeperDraftId ? `https://sleeper.com/draft/nfl/${draft.sleeperDraftId}` : null,
      },
    };
  }

  return {
    season,
    hero,
    clock,
    slateWeek,
    currentWeek,
    currentWeekMatchups,
    upcomingMatchups: withClockStatus(upcomingMatchups, clock),
    standings,
    defendingChampionship,
    recentTransactions,
    latestArticle,
    featuredMatchup,
    historicalFact,
  };
}
