import { prisma } from "@/lib/db";
import {
  averageFinish,
  careerSummary,
  championships,
  finalsAppearances,
  finishesBySeason,
  playoffAppearances,
} from "@/server/stats";
import type { GameResult, SeasonFinish } from "@/server/stats/types";
import type { ManagerSummary } from "@/types/view-models";

// `opponentId` is the opponent MANAGER's id (not fantasy team id), so career-vs-career
// head-to-head lookups can filter directly by manager without an extra team->manager join.
export async function buildManagerGameLog(managerId: string): Promise<GameResult[]> {
  const matchupTeams = await prisma.matchupTeam.findMany({
    where: { fantasyTeam: { managerId }, score: { not: null } },
    include: {
      matchup: { include: { teams: { include: { fantasyTeam: true } }, season: true } },
    },
  });

  const games: GameResult[] = [];
  for (const mt of matchupTeams) {
    const opponent = mt.matchup.teams.find((t) => t.id !== mt.id);
    if (!opponent || mt.score == null || opponent.score == null) continue;
    const result: GameResult["result"] = mt.isWinner === true ? "W" : mt.isWinner === false ? "L" : "T";
    games.push({
      week: mt.matchup.week,
      season: mt.matchup.season.year,
      isPlayoff: mt.matchup.isPlayoff,
      pointsFor: mt.score,
      pointsAgainst: opponent.score,
      opponentId: opponent.fantasyTeam.managerId,
      result,
    });
  }
  return games;
}

const buildGameLog = buildManagerGameLog;

export async function getHeadToHeadGameLog(managerId: string, opponentManagerId: string): Promise<GameResult[]> {
  const games = await buildManagerGameLog(managerId);
  return games.filter((g) => g.opponentId === opponentManagerId);
}

async function buildSeasonFinishes(managerId: string): Promise<SeasonFinish[]> {
  const teams = await prisma.fantasyTeam.findMany({
    where: { managerId, season: { status: "COMPLETE" } },
    include: { season: true, championshipsWon: true, championshipsRunnerUp: true },
  });

  return teams.map((team) => ({
    season: team.season.year,
    regularSeasonRank: team.regularSeasonRank ?? 0,
    finalRank: team.finalRank ?? team.regularSeasonRank ?? 0,
    madePlayoffs: team.madePlayoffs,
    isChampion: team.isChampion,
    isRunnerUp: team.championshipsRunnerUp.length > 0,
  }));
}

export async function listManagerSummaries(): Promise<ManagerSummary[]> {
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    include: {
      fantasyTeams: {
        orderBy: { season: { year: "desc" } },
        take: 1,
      },
    },
    orderBy: { displayName: "asc" },
  });

  const summaries: ManagerSummary[] = [];
  for (const manager of managers) {
    const games = await buildGameLog(manager.id);
    const summary = careerSummary(games);
    const champs = await prisma.championship.count({ where: { championManagerId: manager.id } });
    const finals = await prisma.championship.count({
      where: {
        OR: [{ championManagerId: manager.id }, { runnerUpFantasyTeam: { managerId: manager.id } }],
      },
    });

    summaries.push({
      managerId: manager.id,
      displayName: manager.displayName,
      avatarUrl: manager.avatarUrl,
      currentTeamName: manager.fantasyTeams[0]?.teamName ?? "—",
      championships: champs,
      finalsAppearances: finals,
      careerWins: summary.record.wins,
      careerLosses: summary.record.losses,
      careerTies: summary.record.ties,
      winningPercentage: Number(summary.winningPercentage.toFixed(3)),
    });
  }
  return summaries;
}

export async function getManagerProfile(managerId: string) {
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    include: {
      fantasyTeams: { include: { season: true }, orderBy: { season: { year: "desc" } } },
      teamNameHistory: { orderBy: { startDate: "asc" } },
      rivalriesAsA: { include: { managerB: true } },
      rivalriesAsB: { include: { managerA: true } },
    },
  });
  if (!manager) return null;

  const games = await buildGameLog(managerId);
  const finishes = await buildSeasonFinishes(managerId);
  const summary = careerSummary(games);

  return {
    manager,
    games,
    stats: {
      ...summary,
      playoffAppearances: playoffAppearances(finishes),
      championships: championships(finishes),
      finalsAppearances: finalsAppearances(finishes),
      averageFinish: Number(averageFinish(finishes).toFixed(2)),
      finishes: finishesBySeason(finishes),
    },
    rivalries: [
      ...manager.rivalriesAsA.map((r) => ({ rivalry: r, opponent: r.managerB })),
      ...manager.rivalriesAsB.map((r) => ({ rivalry: r, opponent: r.managerA })),
    ],
  };
}
