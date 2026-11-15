import { prisma } from "@/lib/db";
import { positionLabel } from "@/lib/format";
import { matchupTexts } from "@/server/text/page-texts";
import type { RenderedText } from "@/server/text/read";
import {
  chooseFeaturedMatchup,
  type FeaturedCandidate,
  type FeaturedFactor,
} from "@/server/stats/featured-matchup";
import { loadVerifiedGames } from "./verified-games";
import { seriesFromRows } from "./head-to-head-repository";
import { describeSeries, type SeriesSummary } from "@/server/stats/head-to-head";
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
  /**
   * Regular-season results ENTERING this week, oldest first — the same five
   * games the standings table's form column shows, with the week and opponent
   * for the chip's tooltip.
   */
  recentForm: FormChip[];
  /** Highest-scoring starters this week, or the best of the roster beforehand. */
  keyPlayers: { name: string; position: string; detail: string }[];
}

export interface FormChip {
  result: "W" | "L" | "T";
  week: number;
  opponentName: string;
  score: number;
  opponentScore: number;
}

/** How many form chips every surface shows. */
export const FORM_LENGTH = 5;

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
  /**
   * Head-to-head series — the site's one definition (stats/head-to-head.ts),
   * every final game counted, this week's included once it is final.
   */
  series: {
    games: number;
    teamAWins: number;
    teamBWins: number;
    ties: number;
    /** "Anthony Cibilich leads 8-6" / "Series tied 7-7". */
    text: string;
    /** Championship-bracket meetings, phrased the same way; null when none. */
    playoffText: string | null;
    averageMargin: number | null;
    lastMeeting: { seasonYear: number; week: number; winnerName: string | null } | null;
  };
  /** Set when the commissioner's list names this pair. */
  rivalry: { id: string; isOfficial: boolean; label: string } | null;
  /** Saved commentary, and which kind it is. Null when none has been written. */
  commentary: { kind: "PREVIEW" | "RECAP"; text: RenderedText } | null;
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

  /**
   * The form strip shown on the card: this season's regular-season games
   * ENTERING this week, the last five, oldest first — the same window and order
   * as the standings table, labelled as such on the card.
   */
  const displayFormFor = (managerId: string | null): FormChip[] => {
    if (!managerId) return [];
    return (gamesByManager.get(managerId) ?? [])
      .filter((g) => !g.isPlayoff && g.year === seasonYear && g.week < week)
      .sort((a, b) => a.week - b.week)
      .slice(-FORM_LENGTH)
      .map((g) => ({
        result: resultOf(g.score, g.opponentScore),
        week: g.week,
        opponentName: g.opponentManagerName,
        score: g.score,
        opponentScore: g.opponentScore,
      }));
  };

  const seriesOf = (aId: string | null, bId: string | null): SeriesSummary | null =>
    aId && bId ? seriesFromRows(verified, aId, bId) : null;

  const candidates: FeaturedCandidate[] = playable.map((m) => {
    const [a, b] = m.teams;
    const managerAId = a.fantasyTeam.manager?.id ?? null;
    const managerBId = b.fantasyTeam.manager?.id ?? null;
    const rivalry =
      managerAId && managerBId ? rivalryOf.get(rivalryKey(managerAId, managerBId)) : undefined;

    // The same series the card prints — one definition, one count.
    const series = seriesOf(managerAId, managerBId);

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
      headToHeadGames: series?.games ?? 0,
      headToHeadAverageMargin: series?.averageMargin ?? null,
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
      recentForm: displayFormFor(managerId),
      keyPlayers: keyPlayers.get(side.fantasyTeamId) ?? [],
    };
  };

  // The all-time series — the same summary "Why this game" was scored on.
  const series = seriesOf(managerAId, managerBId);
  const teamAWins = series?.aWins ?? 0;
  const teamBWins = series?.bWins ?? 0;
  const ties = series?.ties ?? 0;
  const last = series?.lastMeeting ?? null;

  const rivalryRow =
    managerAId && managerBId ? rivalryOf.get(rivalryKey(managerAId, managerBId)) : undefined;

  const teamA = toTeam(a, managerAId);
  const teamB = toTeam(b, managerBId);

  /*
   * Commentary: the facts-first preview or recap (server/text), shown only
   * while it was written from these exact facts — otherwise its templated
   * fallback, so the card can never contradict itself.
   */
  const kind: "PREVIEW" | "RECAP" = isFinal ? "RECAP" : "PREVIEW";
  const written = await matchupTexts(chosen.id);
  const commentaryText = kind === "RECAP" ? written.recap : written.preview;

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
      games: series?.games ?? 0,
      teamAWins,
      teamBWins,
      ties,
      text: series ? describeSeries(series, teamA.managerName, teamB.managerName) : "First meeting",
      playoffText:
        series && series.playoff.games > 0
          ? describeSeries(series.playoff, teamA.managerName, teamB.managerName)
          : null,
      averageMargin: series?.averageMargin ?? null,
      lastMeeting: last
        ? {
            seasonYear: last.season,
            week: last.week,
            winnerName: last.winner === "A" ? teamA.managerName : last.winner === "B" ? teamB.managerName : null,
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
    commentary: commentaryText ? { kind, text: commentaryText } : null,
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
