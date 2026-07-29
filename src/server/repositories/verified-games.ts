import { prisma } from "@/lib/db";
import type { BracketType, SeasonDataSource } from "@/generated/prisma/client";
import type { GameResult } from "@/server/stats/types";

/**
 * The one place the site decides which games count.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * A game counts when BOTH sides are a verified score. `verifiedScore` is false
 * for a score that is on record but is not the result of a real contest — an
 * abandoned team's run of zeros, an unplayed week, a score the platform never
 * reported (see scripts/import/audit-suspect-scores.ts). Filtering only one
 * side is worse than not filtering at all: it drops the abandoned team's 0.0
 * but keeps its opponent's 167.4, which then stands as the biggest blowout in
 * league history.
 *
 * Every statistic on the public site — records, rivalries, head-to-head,
 * points, margins, streaks, luck, power rankings, the Hall of Shame, and the
 * packets handed to the AI writer — is built from these rows. Repositories used
 * to each re-derive their own game log with their own idea of what counted,
 * which is how three of them disagreed about the same season.
 */

export interface VerifiedGameRow {
  seasonId: string;
  year: number;
  dataSource: SeasonDataSource;
  week: number;
  isPlayoff: boolean;
  bracket: BracketType | null;
  fantasyTeamId: string;
  managerId: string;
  managerName: string;
  score: number;
  isWinner: boolean | null;
  opponentTeamId: string;
  opponentManagerId: string;
  opponentManagerName: string;
  opponentScore: number;
}

/** One team's score in one week — includes byes and one-sided postseason rows. */
export interface VerifiedTeamWeek {
  year: number;
  week: number;
  isPlayoff: boolean;
  managerId: string;
  fantasyTeamId: string;
  points: number;
}

const SELECT = {
  fantasyTeamId: true,
  score: true,
  isWinner: true,
  fantasyTeam: {
    select: { managerId: true, manager: { select: { displayName: true } } },
  },
  matchup: {
    select: {
      seasonId: true,
      week: true,
      isPlayoff: true,
      bracketType: true,
      season: { select: { year: true, dataSource: true } },
      teams: {
        select: {
          fantasyTeamId: true,
          score: true,
          verifiedScore: true,
          fantasyTeam: {
            select: { managerId: true, manager: { select: { displayName: true } } },
          },
        },
      },
    },
  },
} as const;

interface LoadOptions {
  /** Restrict to a single season. */
  year?: number;
  /** Restrict to one season by id — cheaper than a year join when you have it. */
  seasonId?: string;
}

/**
 * Every game where both sides are verified, from one query.
 *
 * Returns one row per team per game, so a single matchup appears twice — once
 * from each manager's point of view, which is the shape every caller wants.
 */
export async function loadVerifiedGames(options: LoadOptions = {}): Promise<VerifiedGameRow[]> {
  const rows = await prisma.matchupTeam.findMany({
    where: {
      score: { not: null },
      verifiedScore: true,
      ...(options.seasonId ? { matchup: { seasonId: options.seasonId } } : {}),
      ...(options.year ? { matchup: { season: { year: options.year } } } : {}),
    },
    select: SELECT,
  });

  const games: VerifiedGameRow[] = [];
  for (const mt of rows) {
    if (mt.score == null) continue;
    const managerId = mt.fantasyTeam.managerId;
    if (!managerId) continue;
    const opponent = mt.matchup.teams.find((t) => t.fantasyTeamId !== mt.fantasyTeamId);
    // No opponent: a bye, or an eliminated team still being scored in a
    // postseason week. Real points, but nothing anyone won or lost.
    if (!opponent || opponent.score == null || !opponent.verifiedScore) continue;
    const opponentManagerId = opponent.fantasyTeam.managerId;
    if (!opponentManagerId) continue;

    games.push({
      seasonId: mt.matchup.seasonId,
      year: mt.matchup.season.year,
      dataSource: mt.matchup.season.dataSource,
      week: mt.matchup.week,
      isPlayoff: mt.matchup.isPlayoff,
      bracket: mt.matchup.bracketType,
      fantasyTeamId: mt.fantasyTeamId,
      managerId,
      managerName: mt.fantasyTeam.manager.displayName,
      score: mt.score,
      isWinner: mt.isWinner,
      opponentTeamId: opponent.fantasyTeamId,
      opponentManagerId,
      opponentManagerName: opponent.fantasyTeam.manager.displayName,
      opponentScore: opponent.score,
    });
  }
  return games;
}

/**
 * Every verified weekly score in the league, opponent or not. All-play and
 * league-average calculations measure a score against the rest of the week, so
 * they want the byes too — but never an unverified one.
 */
export async function loadVerifiedTeamWeeks(options: LoadOptions = {}): Promise<VerifiedTeamWeek[]> {
  const rows = await prisma.matchupTeam.findMany({
    where: {
      score: { not: null },
      verifiedScore: true,
      ...(options.seasonId ? { matchup: { seasonId: options.seasonId } } : {}),
      ...(options.year ? { matchup: { season: { year: options.year } } } : {}),
    },
    select: {
      fantasyTeamId: true,
      score: true,
      fantasyTeam: { select: { managerId: true } },
      matchup: {
        select: { week: true, isPlayoff: true, season: { select: { year: true } } },
      },
    },
  });

  const out: VerifiedTeamWeek[] = [];
  for (const mt of rows) {
    if (mt.score == null || !mt.fantasyTeam.managerId) continue;
    out.push({
      year: mt.matchup.season.year,
      week: mt.matchup.week,
      isPlayoff: mt.matchup.isPlayoff,
      managerId: mt.fantasyTeam.managerId,
      fantasyTeamId: mt.fantasyTeamId,
      points: mt.score,
    });
  }
  return out;
}

/** Maps a verified row into the stats package's neutral game shape. */
export function toGameResult(row: VerifiedGameRow): GameResult {
  return {
    week: row.week,
    season: row.year,
    isPlayoff: row.isPlayoff,
    bracket: row.bracket,
    pointsFor: row.score,
    pointsAgainst: row.opponentScore,
    opponentId: row.opponentManagerId,
    result: row.isWinner === true ? "W" : row.isWinner === false ? "L" : "T",
    dataSource: row.dataSource,
  };
}

/** Game logs keyed by manager id, built once for the whole league. */
export function groupByManager(rows: VerifiedGameRow[]): Map<string, GameResult[]> {
  const byManager = new Map<string, GameResult[]>();
  for (const row of rows) {
    const list = byManager.get(row.managerId) ?? [];
    list.push(toGameResult(row));
    byManager.set(row.managerId, list);
  }
  return byManager;
}

/**
 * How many recorded scores are being left out, so pages can say so rather than
 * silently dropping them.
 */
export async function countExcludedScores(): Promise<number> {
  return prisma.matchupTeam.count({ where: { verifiedScore: false, score: { not: null } } });
}
