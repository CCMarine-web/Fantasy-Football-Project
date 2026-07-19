import { prisma } from "@/lib/db";

export async function getLeagueScoringTrend(): Promise<{ season: number; averageScore: number }[]> {
  const seasons = await prisma.season.findMany({ orderBy: { year: "asc" } });
  const results = await Promise.all(
    seasons.map(async (season) => {
      const agg = await prisma.matchupTeam.aggregate({
        where: { matchup: { seasonId: season.id }, score: { not: null } },
        _avg: { score: true },
      });
      return { season: season.year, averageScore: agg._avg.score ?? 0 };
    }),
  );
  return results;
}

export async function listSeasonsWithChampions() {
  return prisma.season.findMany({
    orderBy: { year: "desc" },
    include: {
      championship: {
        include: {
          championFantasyTeam: true,
          championManager: true,
          runnerUpFantasyTeam: { include: { manager: true } },
        },
      },
    },
  });
}

export async function getSeasonHistory(year: number) {
  const season = await prisma.season.findFirst({
    where: { year },
    include: {
      championship: {
        include: {
          championFantasyTeam: { include: { manager: true } },
          runnerUpFantasyTeam: { include: { manager: true } },
          thirdPlaceFantasyTeam: { include: { manager: true } },
        },
      },
      fantasyTeams: {
        include: { manager: true },
        orderBy: { regularSeasonRank: "asc" },
      },
      drafts: {
        include: {
          picks: { include: { player: true, manager: true }, orderBy: { pickNumber: "asc" } },
        },
      },
    },
  });
  if (!season) return null;

  const standingSnapshots = await prisma.standingSnapshot.findMany({
    where: { seasonId: season.id },
    orderBy: [{ week: "asc" }, { rank: "asc" }],
  });

  const playoffMatchups = await prisma.matchup.findMany({
    where: { seasonId: season.id, isPlayoff: true },
    include: {
      teams: { include: { fantasyTeam: { include: { manager: true } } } },
    },
    orderBy: [{ playoffRound: "asc" }],
  });

  const highestScore = await prisma.weeklyPlayerScore.findFirst({
    where: { roster: { fantasyTeam: { seasonId: season.id } } },
    include: { player: true, roster: { include: { fantasyTeam: { include: { manager: true } } } } },
    orderBy: { points: "desc" },
  });

  const notableTrades = await prisma.trade.findMany({
    where: { isNotable: true, transaction: { seasonId: season.id } },
    include: {
      transaction: {
        include: { assets: { include: { player: true, fantasyTeam: { include: { manager: true } } } } },
      },
    },
  });

  return { season, standingSnapshots, playoffMatchups, highestScore, notableTrades };
}
