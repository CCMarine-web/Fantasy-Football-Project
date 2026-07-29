import { prisma } from "@/lib/db";
import { positionLabel } from "@/lib/format";
import { getBlurbs, hashInputs } from "@/server/ai/blurb-cache";
import {
  chooseFeaturedMatchup,
  type FeaturedCandidate,
  type FeaturedFactor,
} from "@/server/stats/featured-matchup";
import { loadVerifiedGames } from "./verified-games";
import { getPowerRankings } from "./power-rankings-repository";
import { getStandingsForSeason } from "./standings-repository";

/**
 * THE MATCHUP OF THE WEEK.
 *
 * ── Division of labour ────────────────────────────────────────────────────
 * This file gathers verified figures and hands them to
 * server/stats/featured-matchup.ts, which picks the game with a pure,
 * deterministic function. Nothing here asks a model anything, and the model is
 * never given a say in WHICH game is featured — only in how the chosen one is
 * described, from a packet assembled out of exactly these numbers.
 *
 * ── Preview or recap ──────────────────────────────────────────────────────
 * Which one is shown is decided by the game, not by the calendar: a matchup with
 * both scores in and a winner recorded gets the recap, anything else gets the
 * preview. Both are READ from AIBlurbCache — the page never generates. A missing
 * one renders the verified facts with no prose rather than a placeholder.
 */

export interface FeaturedTeam {
  fantasyTeamId: string;
  managerId: string | null;
  managerName: string;
  teamName: string;
  photoUrl: string | null;
  /** Regular-season record, or null before any game has been played. */
  record: string | null;
  score: number | null;
  projectedScore: number | null;
  isWinner: boolean | null;
  /** Power-ranking position and the number of teams ranked. */
  powerRank: number | null;
  /** Standings position, null before week 1. */
  standing: number | null;
  /** Last three results, most recent first. */
  recentForm: ("W" | "L" | "T")[];
  /** Highest-scoring starters this week, or the best of the roster beforehand. */
  keyPlayers: { name: string; position: string; detail: string }[];
}

export interface FeaturedMatchupView {
  matchupId: string;
  seasonYear: number;
  week: number;
  /** True once both scores are in — the card shows a recap rather than a preview. */
  isFinal: boolean;
  isPlayoff: boolean;
  roundName: string | null;
  teams: [FeaturedTeam, FeaturedTeam];
  teamsRanked: number;
  /** Head-to-head series, from verified games only. */
  series: {
    games: number;
    teamAWins: number;
    teamBWins: number;
    ties: number;
    averageMargin: number | null;
    lastMeeting: { seasonYear: number; week: number; winnerName: string | null } | null;
  };
  /** Set when the commissioner's list names this pair. */
  rivalry: { id: string; isOfficial: boolean; label: string } | null;
  /** Saved commentary, and which kind it is. Null when none has been written. */
  commentary: { kind: "PREVIEW" | "RECAP"; text: string; stale: boolean } | null;
  /** Why this game was chosen, in checkable terms. */
  why: FeaturedFactor[];
  href: string;
}

/** Result letter from one team's point of view. */
function resultOf(score: number, opponentScore: number): "W" | "L" | "T" {
  if (score > opponentScore) return "W";
  if (score < opponentScore) return "L";
  return "T";
}

/**
 * The featured game for one week.
 *
 * `week` is required: the caller already knows which week it is showing, and
 * deriving it twice is how a page ends up featuring a game from a different week
 * than the grid beneath it.
 */
export async function getFeaturedMatchup(
  seasonId: string,
  seasonYear: number,
  week: number,
): Promise<FeaturedMatchupView | null> {
  const matchups = await prisma.matchup.findMany({
    where: { seasonId, week },
    select: {
      id: true,
      week: true,
      status: true,
      isPlayoff: true,
      bracketType: true,
      roundName: true,
      teams: {
        select: {
          fantasyTeamId: true,
          score: true,
          projectedScore: true,
          isWinner: true,
          verifiedScore: true,
          fantasyTeam: {
            select: {
              id: true,
              teamName: true,
              wins: true,
              losses: true,
              ties: true,
              manager: {
                select: { id: true, displayName: true, photoUrl: true, avatarUrl: true },
              },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  // A matchup with fewer than two sides is a bye, not a game.
  const playable = matchups.filter((m) => m.teams.length === 2);
  if (playable.length === 0) return null;

  const [power, standings, verified, rivalries, totalWeeks, season] = await Promise.all([
    getPowerRankings(),
    getStandingsForSeason(seasonId),
    // Career-wide, because the head-to-head series is all-time, not this season.
    loadVerifiedGames(),
    prisma.rivalry.findMany({
      select: { id: true, managerAId: true, managerBId: true, isOfficial: true },
    }),
    prisma.matchup.findMany({
      where: { seasonId, isPlayoff: false },
      distinct: ["week"],
      select: { week: true },
    }),
    // The league's own postseason size, as synced from the platform — not a
    // constant, because it has not always been six.
    prisma.season.findUnique({ where: { id: seasonId }, select: { playoffTeams: true } }),
  ]);
  const playoffSpots = season?.playoffTeams ?? 6;

  const powerRankOf = new Map(
    (power?.rows ?? []).map((r) => [r.fantasyTeamId, r.rank] as const),
  );
  const standingOf = new Map(standings.map((s) => [s.fantasyTeamId, s.rank] as const));
  const rivalryKey = (a: string, b: string) => [a, b].sort().join("|");
  const rivalryOf = new Map(
    rivalries.map((r) => [rivalryKey(r.managerAId, r.managerBId), r] as const),
  );

  /*
   * Regular-season weeks left AFTER this one. Playoff weeks are excluded from
   * the count: "three weeks to play" means three chances to make the postseason,
   * not three including the semi-final.
   */
  const regularWeeks = totalWeeks.map((w) => w.week);
  const weeksRemaining = regularWeeks.filter((w) => w > week).length;

  // Per-manager verified game log, for form and the head-to-head series.
  const gamesByManager = new Map<string, typeof verified>();
  for (const row of verified) {
    const list = gamesByManager.get(row.managerId) ?? [];
    list.push(row);
    gamesByManager.set(row.managerId, list);
  }

  /** Last three verified regular-season results before this week, newest first. */
  const formFor = (managerId: string | null): ("W" | "L" | "T")[] => {
    if (!managerId) return [];
    return (gamesByManager.get(managerId) ?? [])
      .filter((g) => !g.isPlayoff && (g.year < seasonYear || (g.year === seasonYear && g.week < week)))
      .sort((a, b) => b.year - a.year || b.week - a.week)
      .slice(0, 3)
      .map((g) => resultOf(g.score, g.opponentScore));
  };

  const candidates: FeaturedCandidate[] = playable.map((m) => {
    const [a, b] = m.teams;
    const managerAId = a.fantasyTeam.manager?.id ?? null;
    const managerBId = b.fantasyTeam.manager?.id ?? null;
    const rivalry =
      managerAId && managerBId ? rivalryOf.get(rivalryKey(managerAId, managerBId)) : undefined;

    // Verified head-to-head meetings, championship bracket and regular season
    // alike but never consolation — the site does not count those anywhere.
    const meetings = (managerAId ? (gamesByManager.get(managerAId) ?? []) : []).filter(
      (g) => g.opponentManagerId === managerBId && g.bracket !== "CONSOLATION",
    );
    const averageMargin =
      meetings.length > 0
        ? meetings.reduce((sum, g) => sum + Math.abs(g.score - g.opponentScore), 0) / meetings.length
        : null;

    /*
     * Before kickoff the model weighs projections; afterwards it weighs the
     * actual scores, so the same weighting picks the best game to RECAP. Only
     * verified scores are used — a walkover is not a close game.
     */
    const bothFinal =
      a.score != null && b.score != null && a.verifiedScore && b.verifiedScore;

    return {
      matchupId: m.id,
      bracket: m.bracketType,
      isPlayoff: m.isPlayoff,
      projectedA: bothFinal ? a.score : a.projectedScore,
      projectedB: bothFinal ? b.score : b.projectedScore,
      powerRankA: powerRankOf.get(a.fantasyTeamId) ?? null,
      powerRankB: powerRankOf.get(b.fantasyTeamId) ?? null,
      teamsRanked: power?.rows.length ?? 0,
      winsA: a.fantasyTeam.wins,
      lossesA: a.fantasyTeam.losses,
      winsB: b.fantasyTeam.wins,
      lossesB: b.fantasyTeam.losses,
      standingA: standingOf.get(a.fantasyTeamId) ?? null,
      standingB: standingOf.get(b.fantasyTeamId) ?? null,
      playoffSpots,
      isOfficialRivalry: rivalry?.isOfficial ?? false,
      headToHeadGames: meetings.length,
      headToHeadAverageMargin: averageMargin,
      recentFormA: formFor(managerAId),
      recentFormB: formFor(managerBId),
      weeksRemaining,
    };
  });

  const choice = chooseFeaturedMatchup(candidates);
  if (!choice) return null;

  const chosen = playable.find((m) => m.id === choice.matchupId);
  if (!chosen) return null;

  const [a, b] = chosen.teams;
  const managerAId = a.fantasyTeam.manager?.id ?? null;
  const managerBId = b.fantasyTeam.manager?.id ?? null;
  const isFinal =
    a.score != null && b.score != null && (chosen.status === "FINAL" || a.isWinner != null);

  const keyPlayers = await loadKeyPlayers(
    [a.fantasyTeamId, b.fantasyTeamId],
    week,
    seasonYear,
    isFinal,
  );

  const toTeam = (
    side: (typeof chosen.teams)[number],
    managerId: string | null,
  ): FeaturedTeam => {
    const team = side.fantasyTeam;
    const played = team.wins + team.losses + team.ties > 0;
    return {
      fantasyTeamId: side.fantasyTeamId,
      managerId,
      managerName: team.manager?.displayName ?? "Unknown",
      teamName: team.teamName,
      photoUrl: team.manager?.photoUrl ?? team.manager?.avatarUrl ?? null,
      // A 0-0 record in the preseason is not information; it reads as though
      // everyone has played and drawn.
      record: played ? `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}` : null,
      score: side.score,
      projectedScore: side.projectedScore,
      isWinner: side.isWinner,
      powerRank: powerRankOf.get(side.fantasyTeamId) ?? null,
      standing: standingOf.get(side.fantasyTeamId) ?? null,
      recentForm: formFor(managerId),
      keyPlayers: keyPlayers.get(side.fantasyTeamId) ?? [],
    };
  };

  // The all-time series between these two, from verified non-consolation games.
  const meetings = (managerAId ? (gamesByManager.get(managerAId) ?? []) : [])
    .filter((g) => g.opponentManagerId === managerBId && g.bracket !== "CONSOLATION")
    // This week's game is not part of the history leading into it.
    .filter((g) => !(g.year === seasonYear && g.week === week))
    .sort((x, y) => y.year - x.year || y.week - x.week);

  const teamAWins = meetings.filter((g) => g.isWinner === true).length;
  const teamBWins = meetings.filter((g) => g.isWinner === false).length;
  const ties = meetings.length - teamAWins - teamBWins;
  const last = meetings[0];

  const rivalryRow =
    managerAId && managerBId ? rivalryOf.get(rivalryKey(managerAId, managerBId)) : undefined;

  const teamA = toTeam(a, managerAId);
  const teamB = toTeam(b, managerBId);

  /*
   * The commentary key. Preview and recap are stored separately, so a game that
   * has finished shows the recap while the preview written before kickoff stays
   * on record rather than being overwritten.
   */
  const kind: "PREVIEW" | "RECAP" = isFinal ? "RECAP" : "PREVIEW";
  const subjectKey = `${seasonYear}:${week}:${chosen.id}`;
  const inputHash = hashInputs({
    kind,
    scores: [teamA.score, teamB.score],
    projections: [teamA.projectedScore, teamB.projectedScore],
    records: [teamA.record, teamB.record],
    ranks: [teamA.powerRank, teamB.powerRank],
    series: [teamAWins, teamBWins, ties],
  });
  const blurbs = await getBlurbs(kind === "RECAP" ? "MATCHUP_RECAP" : "MATCHUP_PREVIEW", [
    { subjectKey, inputHash },
  ]);
  const saved = blurbs.get(subjectKey);

  return {
    matchupId: chosen.id,
    seasonYear,
    week,
    isFinal,
    isPlayoff: chosen.isPlayoff,
    roundName: chosen.roundName,
    teams: [teamA, teamB],
    teamsRanked: power?.rows.length ?? 0,
    series: {
      games: meetings.length,
      teamAWins,
      teamBWins,
      ties,
      averageMargin:
        meetings.length > 0
          ? meetings.reduce((sum, g) => sum + Math.abs(g.score - g.opponentScore), 0) /
            meetings.length
          : null,
      lastMeeting: last
        ? {
            seasonYear: last.year,
            week: last.week,
            winnerName:
              last.isWinner === true
                ? last.managerName
                : last.isWinner === false
                  ? last.opponentManagerName
                  : null,
          }
        : null,
    },
    rivalry: rivalryRow
      ? {
          id: rivalryRow.id,
          isOfficial: rivalryRow.isOfficial,
          label: rivalryRow.isOfficial ? "Official league rivalry" : "Recurring matchup",
        }
      : null,
    commentary: saved ? { kind, text: saved.text, stale: saved.stale } : null,
    why: choice.factors,
    href: `/matchups/${seasonYear}/${week}/${chosen.id}`,
  };
}

/**
 * Players worth naming on each side.
 *
 * After the game: the week's highest-scoring STARTERS, which is what a recap
 * would talk about. Before it: the rostered players with the best prior-season
 * points per game, because a projection for an individual player is not on
 * record and inventing one would be the whole thing this codebase avoids.
 *
 * Returns an empty list rather than a guess when neither is available — the
 * entire ESPN era stores roster membership without weekly points.
 */
async function loadKeyPlayers(
  fantasyTeamIds: string[],
  week: number,
  seasonYear: number,
  isFinal: boolean,
): Promise<Map<string, { name: string; position: string; detail: string }[]>> {
  const out = new Map<string, { name: string; position: string; detail: string }[]>();

  if (isFinal) {
    const rosters = await prisma.roster.findMany({
      where: { fantasyTeamId: { in: fantasyTeamIds }, week },
      select: {
        fantasyTeamId: true,
        playerScores: {
          where: { isStarter: true, points: { not: null } },
          orderBy: { points: "desc" },
          take: 3,
          select: {
            points: true,
            player: { select: { firstName: true, lastName: true, position: true } },
          },
        },
      },
    });
    for (const roster of rosters) {
      out.set(
        roster.fantasyTeamId,
        roster.playerScores.map((s) => ({
          name: `${s.player.firstName} ${s.player.lastName}`.trim(),
          position: positionLabel(s.player.position),
          detail: `${(s.points ?? 0).toFixed(1)} pts`,
        })),
      );
    }
    // Every side that produced a list is done; fall through for any that did not.
    if (fantasyTeamIds.every((id) => (out.get(id)?.length ?? 0) > 0)) return out;
  }

  // Pre-game (or no weekly scoring on record): rank the drafted squad by what
  // those players actually produced last season.
  const picks = await prisma.draftPick.findMany({
    where: { fantasyTeamId: { in: fantasyTeamIds } },
    select: {
      fantasyTeamId: true,
      playerId: true,
      player: { select: { firstName: true, lastName: true, position: true } },
    },
  });
  const playerIds = [...new Set(picks.map((p) => p.playerId).filter((id): id is string => !!id))];
  if (playerIds.length === 0) return out;

  const priorScores = await prisma.weeklyPlayerScore.groupBy({
    by: ["playerId"],
    where: {
      playerId: { in: playerIds },
      points: { not: null },
      roster: { fantasyTeam: { season: { year: seasonYear - 1 } } },
    },
    _sum: { points: true },
    _count: { _all: true },
  });
  const ppg = new Map(
    priorScores
      .filter((row) => row._count._all >= 3)
      .map((row) => [row.playerId, (row._sum.points ?? 0) / row._count._all] as const),
  );

  for (const teamId of fantasyTeamIds) {
    if ((out.get(teamId)?.length ?? 0) > 0) continue;
    const ranked = picks
      .filter((p) => p.fantasyTeamId === teamId && p.playerId && ppg.has(p.playerId))
      .map((p) => ({ pick: p, ppg: ppg.get(p.playerId as string) as number }))
      .sort((x, y) => y.ppg - x.ppg)
      .slice(0, 3);
    out.set(
      teamId,
      ranked.map(({ pick, ppg: rate }) => ({
        name: `${pick.player?.firstName ?? ""} ${pick.player?.lastName ?? ""}`.trim(),
        position: positionLabel(pick.player?.position),
        detail: `${rate.toFixed(1)} pts/gm in ${seasonYear - 1}`,
      })),
    );
  }
  return out;
}
