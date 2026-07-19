import { prisma } from "@/lib/db";
import { getCurrentSeason } from "@/server/repositories/season-repository";
import { getMatchupsForWeek } from "@/server/repositories/matchup-repository";
import { getStandingsForSeason } from "@/server/repositories/standings-repository";

export async function getHomepageData() {
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
