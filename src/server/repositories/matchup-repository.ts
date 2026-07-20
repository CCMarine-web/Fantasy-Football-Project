import { prisma } from "@/lib/db";
import type { Matchup, MatchupTeam, FantasyTeam, Manager } from "@/generated/prisma/client";
import type { MatchupCardData, MatchupCardTeam } from "@/types/view-models";

type MatchupTeamWithTeam = MatchupTeam & {
  fantasyTeam: FantasyTeam & { manager: Manager };
};

type MatchupWithTeams = Matchup & { teams: MatchupTeamWithTeam[] };

function toCardTeam(mt: MatchupTeamWithTeam): MatchupCardTeam {
  return {
    fantasyTeamId: mt.fantasyTeamId,
    teamName: mt.fantasyTeam.teamName,
    managerName: mt.fantasyTeam.manager.displayName,
    avatarUrl: mt.fantasyTeam.manager.photoUrl ?? mt.fantasyTeam.manager.avatarUrl,
    record: `${mt.fantasyTeam.wins}-${mt.fantasyTeam.losses}${mt.fantasyTeam.ties ? `-${mt.fantasyTeam.ties}` : ""}`,
    score: mt.score,
    projectedScore: mt.projectedScore,
    isWinner: mt.isWinner,
  };
}

export function toMatchupCardData(matchup: MatchupWithTeams, seasonYear: number): MatchupCardData | null {
  if (matchup.teams.length < 2) return null;
  const [a, b] = matchup.teams;
  return {
    matchupId: matchup.id,
    season: seasonYear,
    week: matchup.week,
    status: matchup.status,
    isPlayoff: matchup.isPlayoff,
    roundName: matchup.roundName,
    teams: [toCardTeam(a), toCardTeam(b)],
  };
}

const matchupInclude = {
  teams: {
    include: { fantasyTeam: { include: { manager: true } } },
  },
} as const;

export async function getMatchupsForWeek(seasonId: string, week: number, seasonYear: number) {
  const matchups = await prisma.matchup.findMany({
    where: { seasonId, week },
    include: matchupInclude,
    orderBy: { id: "asc" },
  });
  return matchups
    .map((m) => toMatchupCardData(m, seasonYear))
    .filter((m): m is MatchupCardData => m !== null);
}

export async function getMatchupById(matchupId: string) {
  return prisma.matchup.findUnique({
    where: { id: matchupId },
    include: {
      ...matchupInclude,
      season: true,
    },
  });
}

export async function getRosterForTeamWeek(fantasyTeamId: string, week: number) {
  const roster = await prisma.roster.findUnique({
    where: { fantasyTeamId_week: { fantasyTeamId, week } },
    include: {
      playerScores: {
        include: { player: true },
        orderBy: [{ isStarter: "desc" }, { points: "desc" }],
      },
    },
  });
  return roster;
}

export async function getHeadToHeadMatchups(seasonId: string, managerAId: string, managerBId: string) {
  return prisma.matchup.findMany({
    where: {
      seasonId,
      teams: { some: { fantasyTeam: { managerId: managerAId } } },
      AND: [{ teams: { some: { fantasyTeam: { managerId: managerBId } } } }],
    },
    include: matchupInclude,
  });
}
