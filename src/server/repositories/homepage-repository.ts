import { prisma, isDatabaseUnavailableError } from "@/lib/db";
import { getCurrentSeason } from "@/server/repositories/season-repository";
import { getMatchupsForWeek } from "@/server/repositories/matchup-repository";
import { getStandingsForSeason } from "@/server/repositories/standings-repository";

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

  const latestMatchup = await prisma.matchup.findFirst({
    where: { seasonId: season.id },
    orderBy: { week: "desc" },
  });
  const currentWeek = latestMatchup?.week ?? 1;

  const [currentWeekMatchups, upcomingMatchups, standings, defendingChampionship, recentTransactions, latestArticle, randomQuote] =
    await Promise.all([
      getMatchupsForWeek(season.id, currentWeek, season.year),
      getMatchupsForWeek(season.id, currentWeek + 1, season.year),
      getStandingsForSeason(season.id),
      prisma.championship.findFirst({
        where: { season: { year: season.year - 1 } },
        include: { championFantasyTeam: true, championManager: true },
      }),
      prisma.transaction.findMany({
        where: { seasonId: season.id },
        include: { assets: { include: { player: true, fantasyTeam: true } } },
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

  return {
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
  };
}
