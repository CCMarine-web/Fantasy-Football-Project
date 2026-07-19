import { prisma } from "@/lib/db";
import { expectedWins, scheduleLuck, seasonAllPlayTotals, weeklyAllPlay } from "@/server/stats";
import type { WeeklyScore } from "@/server/stats/types";
import type { StandingsRow } from "@/types/view-models";

export async function getStandingsForSeason(seasonId: string): Promise<StandingsRow[]> {
  const teams = await prisma.fantasyTeam.findMany({
    where: { seasonId },
    include: { manager: true },
  });

  const regularSeasonMatchupTeams = await prisma.matchupTeam.findMany({
    where: { matchup: { seasonId, isPlayoff: false }, score: { not: null } },
    include: { matchup: { select: { week: true } } },
  });

  const weeks = new Map<number, WeeklyScore[]>();
  for (const mt of regularSeasonMatchupTeams) {
    const week = mt.matchup.week;
    const list = weeks.get(week) ?? [];
    list.push({ teamId: mt.fantasyTeamId, points: mt.score ?? 0 });
    weeks.set(week, list);
  }

  const allPlayByTeam = new Map<string, ReturnType<typeof weeklyAllPlay>>();
  for (const [week, scores] of weeks) {
    const records = weeklyAllPlay(scores, week, 0);
    for (const record of records) {
      const list = allPlayByTeam.get(record.teamId) ?? [];
      list.push(record);
      allPlayByTeam.set(record.teamId, list);
    }
  }

  const recentFormByTeam = new Map<string, ("W" | "L" | "T")[]>();
  for (const team of teams) {
    const games = regularSeasonMatchupTeams
      .filter((mt) => mt.fantasyTeamId === team.id)
      .sort((a, b) => b.matchup.week - a.matchup.week)
      .slice(0, 5)
      .map((mt): "W" | "L" | "T" => (mt.isWinner === true ? "W" : mt.isWinner === false ? "L" : "T"));
    recentFormByTeam.set(team.id, games.reverse());
  }

  const rows: StandingsRow[] = teams.map((team) => {
    const records = allPlayByTeam.get(team.id) ?? [];
    const totals = seasonAllPlayTotals(records);
    const expected = expectedWins(records);
    const luck = scheduleLuck(team.wins, records);
    const allPlayTotal = totals[0];

    return {
      fantasyTeamId: team.id,
      managerId: team.managerId,
      rank: team.regularSeasonRank ?? 0,
      teamName: team.teamName,
      managerName: team.manager.displayName,
      avatarUrl: team.manager.avatarUrl,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      allPlayRecord: allPlayTotal
        ? `${allPlayTotal.wins}-${allPlayTotal.losses}${allPlayTotal.ties ? `-${allPlayTotal.ties}` : ""}`
        : undefined,
      expectedWins: Number(expected.toFixed(1)),
      scheduleLuck: Number(luck.toFixed(1)),
      playoffProbability: null,
      recentForm: recentFormByTeam.get(team.id) ?? [],
    };
  });

  return rows.sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pointsFor - a.pointsFor;
  });
}
