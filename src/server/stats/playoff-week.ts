/**
 * PLAYOFF WEEKS BEFORE THE BRACKET IS SET.
 *
 * Sleeper returns pairings for playoff weeks long before the bracket exists
 * (the Nov 2026 audit found Week 15 showing "Barkemeyer vs McManus" in Week 10).
 * Those pairings are placeholders. Until every regular-season week is final, a
 * playoff week shows "Bracket set after Week N" and the projected seeds — never
 * the placeholder games, and never a Matchup of the Week.
 *
 * (The live sync does not record `bracketType`; only the backfill script does.
 * So "the regular season is over" is the signal, not the bracket column.)
 */

export interface PlayoffWeekInput {
  week: number;
  /** Sleeper's `playoff_week_start` (Season.playoffStartWeek). */
  playoffStartWeek: number;
  /** The last regular-season week whose games are all final, or null. */
  lastFinalRegularWeek: number | null;
}

/** The last regular-season week. */
export function lastRegularWeek(playoffStartWeek: number): number {
  return playoffStartWeek - 1;
}

/** True when `week` is a playoff week whose bracket is not set yet. */
export function isBracketPending({ week, playoffStartWeek, lastFinalRegularWeek }: PlayoffWeekInput): boolean {
  if (week < playoffStartWeek) return false;
  return (lastFinalRegularWeek ?? 0) < lastRegularWeek(playoffStartWeek);
}

export interface SeedRow {
  rank: number;
  teamName: string;
  managerName: string;
  managerId?: string | null;
  wins: number;
  losses: number;
  ties?: number;
  playoffPct?: number | null;
}

export interface ProjectedSeed extends SeedRow {
  seed: number;
  /** Seeds 1–2 get the first-round bye in a six-team bracket. */
  bye: boolean;
}

/** Current standings order, cut at the playoff line. */
export function projectedSeeds(rows: SeedRow[], playoffTeams: number): ProjectedSeed[] {
  const byes = playoffTeams === 6 ? 2 : playoffTeams === 4 ? 0 : Math.max(0, 8 - playoffTeams);
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, playoffTeams)
    .map((r, i) => ({ ...r, seed: i + 1, bye: i < byes }));
}
