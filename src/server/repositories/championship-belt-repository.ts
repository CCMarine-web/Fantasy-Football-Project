import { prisma } from "@/lib/db";

export interface PlayoffGameResult {
  week: number;
  roundName: string | null;
  opponentName: string;
  championScore: number | null;
  opponentScore: number | null;
  result: "W" | "L" | "T" | null;
}

export interface CurrentChampion {
  seasonId: string;
  year: number;
  /** ISO string for the reign-start date the live "days as champion" counts from. */
  championSince: string;
  managerId: string;
  managerName: string;
  /** Uploaded photo if present, else the Sleeper avatar, else null. */
  photoUrl: string | null;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  regularSeasonRank: number | null;
  victorySpeech: string | null;
  playoffRun: PlayoffGameResult[];
}

export interface LineageEntry {
  seasonId: string;
  year: number;
  championManagerId: string;
  championName: string;
  championTeamName: string;
  runnerUpName: string | null;
}

/**
 * The reign-start date the "days as champion" counter counts up from. Titles
 * are decided in December, but the exact clinch date isn't stored, so we
 * anchor the reign to the start of the calendar year AFTER the title season
 * (`Jan 1, year+1` UTC). This is a deterministic, slightly-conservative choice
 * that reads naturally ("champion since the new year") and never lands before
 * the season actually ended.
 */
function reignStartIso(seasonYear: number): string {
  return new Date(Date.UTC(seasonYear + 1, 0, 1)).toISOString();
}

/**
 * The current champion: the Championship of the most recent COMPLETE season,
 * with the champion manager, their team, their season stat line, and their
 * playoff title run (every playoff game their team played that season).
 * Returns null when no completed season has a recorded champion yet.
 */
export async function getCurrentChampion(): Promise<CurrentChampion | null> {
  const champ = await prisma.championship.findFirst({
    where: { season: { status: "COMPLETE" } },
    orderBy: { season: { year: "desc" } },
    include: {
      season: { select: { id: true, year: true } },
      championManager: { select: { id: true, displayName: true, photoUrl: true, avatarUrl: true } },
      championFantasyTeam: {
        select: {
          id: true,
          teamName: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          regularSeasonRank: true,
        },
      },
    },
  });

  if (!champ) return null;

  const teamId = champ.championFantasyTeamId;

  // Every playoff game the champion's team played that season → their title run.
  const playoffMatchups = await prisma.matchup.findMany({
    where: {
      seasonId: champ.seasonId,
      isPlayoff: true,
      teams: { some: { fantasyTeamId: teamId } },
    },
    orderBy: { week: "asc" },
    select: {
      week: true,
      roundName: true,
      teams: {
        select: {
          fantasyTeamId: true,
          score: true,
          isWinner: true,
          fantasyTeam: { select: { teamName: true, manager: { select: { displayName: true } } } },
        },
      },
    },
  });

  const playoffRun: PlayoffGameResult[] = playoffMatchups.map((m) => {
    const mine = m.teams.find((t) => t.fantasyTeamId === teamId);
    const opp = m.teams.find((t) => t.fantasyTeamId !== teamId);
    const result: "W" | "L" | "T" | null =
      mine?.isWinner === true ? "W" : mine?.isWinner === false ? "L" : mine ? null : null;
    return {
      week: m.week,
      roundName: m.roundName,
      opponentName: opp?.fantasyTeam.manager.displayName ?? opp?.fantasyTeam.teamName ?? "—",
      championScore: mine?.score ?? null,
      opponentScore: opp?.score ?? null,
      result,
    };
  });

  return {
    seasonId: champ.seasonId,
    year: champ.season.year,
    championSince: reignStartIso(champ.season.year),
    managerId: champ.championManager.id,
    managerName: champ.championManager.displayName,
    photoUrl: champ.championManager.photoUrl ?? champ.championManager.avatarUrl ?? null,
    teamName: champ.championFantasyTeam.teamName,
    wins: champ.championFantasyTeam.wins,
    losses: champ.championFantasyTeam.losses,
    ties: champ.championFantasyTeam.ties,
    pointsFor: champ.championFantasyTeam.pointsFor,
    regularSeasonRank: champ.championFantasyTeam.regularSeasonRank,
    victorySpeech: champ.victorySpeech,
    playoffRun,
  };
}

/**
 * Full title history — every recorded Championship across seasons, newest
 * first, with the champion (name + id for linking), their team, and the
 * runner-up's name.
 */
export async function getChampionLineage(): Promise<LineageEntry[]> {
  const rows = await prisma.championship.findMany({
    orderBy: { season: { year: "desc" } },
    include: {
      season: { select: { id: true, year: true } },
      championManager: { select: { id: true, displayName: true } },
      championFantasyTeam: { select: { teamName: true } },
      runnerUpFantasyTeam: { select: { manager: { select: { displayName: true } } } },
    },
  });

  return rows.map((r) => ({
    seasonId: r.seasonId,
    year: r.season.year,
    championManagerId: r.championManager.id,
    championName: r.championManager.displayName,
    championTeamName: r.championFantasyTeam.teamName,
    runnerUpName: r.runnerUpFantasyTeam?.manager.displayName ?? null,
  }));
}

/** Admin update of a season's editable victory speech. */
export async function updateVictorySpeech(seasonId: string, text: string): Promise<void> {
  await prisma.championship.update({
    where: { seasonId },
    data: { victorySpeech: text.trim() || null },
  });
}
