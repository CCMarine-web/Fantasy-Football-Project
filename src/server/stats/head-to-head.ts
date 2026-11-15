import type { GameResult } from "./types";

// Sorts games chronologically (season, then week) so streak/"current" calculations read in play order.
function sortChronologically(games: GameResult[]): GameResult[] {
  return [...games].sort((a, b) => a.season - b.season || a.week - b.week);
}

export interface HeadToHeadRecord {
  wins: number;
  losses: number;
  ties: number;
}

// Tallies the perspective manager's wins, losses, and ties against this one opponent.
export function headToHeadRecord(games: GameResult[]): HeadToHeadRecord {
  const rec: HeadToHeadRecord = { wins: 0, losses: 0, ties: 0 };
  for (const g of games) {
    if (g.result === "W") rec.wins += 1;
    else if (g.result === "L") rec.losses += 1;
    else rec.ties += 1;
  }
  return rec;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE SERIES — the one head-to-head definition on the site.
 *
 * Every surface that quotes a head-to-head record (matchup cards, matchup
 * detail, "Why this game", rivalries, manager profiles, the facts handed to the
 * AI writer) goes through `summarizeSeries` and `describeSeries`. Four separate
 * implementations used to disagree about the same pair: one dropped the current
 * week even after it was final, one counted toilet-bowl games, one named the
 * wrong leader.
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *   counted   every verified, final regular-season game, and every
 *             championship-bracket postseason game
 *   excluded  consolation-bracket games: the toilet bowl and placement games
 *             below it decide nothing
 *   current   the current season counts through the last completed week —
 *             which is automatic, because only final weeks store scores
 *
 * The playoff record is the championship-bracket subset, shown separately.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The rule, as one sentence a tooltip can show. */
export const SERIES_DEFINITION =
  "Regular season and championship-bracket games, through the last completed week. Consolation and toilet-bowl games are not counted.";

/** True when a game counts toward a head-to-head series. */
export function countsForSeries(g: { isPlayoff: boolean; bracket?: string | null }): boolean {
  return !(g.isPlayoff && g.bracket === "CONSOLATION");
}

/** The result of one game from the perspective side, decided by the score. */
export function seriesResult(g: Pick<GameResult, "pointsFor" | "pointsAgainst" | "result">): "W" | "L" | "T" {
  if (g.pointsFor > g.pointsAgainst) return "W";
  if (g.pointsFor < g.pointsAgainst) return "L";
  // Level on points: the platform's own decision (a bench-points tiebreak) stands.
  return g.result;
}

export interface SeriesRecord {
  games: number;
  aWins: number;
  bWins: number;
  ties: number;
}

export interface SeriesSummary extends SeriesRecord {
  /** Championship-bracket meetings only. */
  playoff: SeriesRecord;
  aPoints: number;
  bPoints: number;
  /** Mean absolute margin, or null with no meetings. */
  averageMargin: number | null;
  /** Who leads: "A", "B", or null when level (or no meetings). */
  leader: "A" | "B" | null;
  /** Current streak: who has won the most recent meetings in a row. */
  streak: { holder: "A" | "B" | null; length: number };
  lastMeeting: { season: number; week: number; winner: "A" | "B" | null; isPlayoff: boolean } | null;
  /** The counted games, oldest first, from A's perspective. */
  meetings: GameResult[];
}

function emptyRecord(): SeriesRecord {
  return { games: 0, aWins: 0, bWins: 0, ties: 0 };
}

/**
 * Summarises the series from side A's game log against B. `games` may contain
 * games against other opponents and consolation games; both are filtered here
 * so every caller gets the same answer from the same input.
 */
export function summarizeSeries(games: GameResult[], opponentId?: string): SeriesSummary {
  const meetings = sortChronologically(
    games.filter((g) => (opponentId == null || g.opponentId === opponentId) && countsForSeries(g)),
  );
  const total = emptyRecord();
  const playoff = emptyRecord();
  let aPoints = 0;
  let bPoints = 0;
  let marginSum = 0;
  for (const g of meetings) {
    const r = seriesResult(g);
    // Every two-sided postseason game on record has its bracket set (the
    // null-bracket postseason rows are byes and unplayed weeks), so the playoff
    // record is exactly the championship bracket.
    const isChampionshipBracket = g.isPlayoff && g.bracket === "WINNERS";
    for (const rec of isChampionshipBracket ? [total, playoff] : [total]) {
      rec.games += 1;
      if (r === "W") rec.aWins += 1;
      else if (r === "L") rec.bWins += 1;
      else rec.ties += 1;
    }
    aPoints += g.pointsFor;
    bPoints += g.pointsAgainst;
    marginSum += Math.abs(g.pointsFor - g.pointsAgainst);
  }

  let streakHolder: "A" | "B" | null = null;
  let streakLength = 0;
  for (let i = meetings.length - 1; i >= 0; i -= 1) {
    const r = seriesResult(meetings[i]);
    const holder = r === "W" ? "A" : r === "L" ? "B" : null;
    if (holder === null) break;
    if (streakHolder === null) streakHolder = holder;
    if (holder !== streakHolder) break;
    streakLength += 1;
  }

  const last = meetings.at(-1);
  const lastResult = last ? seriesResult(last) : null;
  return {
    ...total,
    playoff,
    aPoints: Number(aPoints.toFixed(2)),
    bPoints: Number(bPoints.toFixed(2)),
    averageMargin: meetings.length ? Number((marginSum / meetings.length).toFixed(2)) : null,
    leader: total.aWins > total.bWins ? "A" : total.bWins > total.aWins ? "B" : null,
    streak: { holder: streakHolder, length: streakLength },
    lastMeeting: last
      ? {
          season: last.season,
          week: last.week,
          winner: lastResult === "W" ? "A" : lastResult === "L" ? "B" : null,
          isPlayoff: last.isPlayoff,
        }
      : null,
    meetings,
  };
}

/** "W-L" or "W-L-T", leader's (or A's, when level) wins first. */
function recordString(high: number, low: number, ties: number): string {
  return `${high}-${low}${ties ? `-${ties}` : ""}`;
}

/**
 * The series in words, the only phrasing the site uses:
 *   "{Leader} leads {W}-{L}"   or   "Series tied {W}-{W}"
 * Never "5-8 to Anthony Cibilich".
 */
export function describeSeries(record: SeriesRecord, nameA: string, nameB: string): string {
  if (record.games === 0) return "First meeting";
  if (record.aWins === record.bWins) return `Series tied ${recordString(record.aWins, record.bWins, record.ties)}`;
  return record.aWins > record.bWins
    ? `${nameA} leads ${recordString(record.aWins, record.bWins, record.ties)}`
    : `${nameB} leads ${recordString(record.bWins, record.aWins, record.ties)}`;
}

/** The leader's record alone ("8-6"), for tokens and compact cells. */
export function seriesRecordString(record: SeriesRecord): string {
  return record.aWins >= record.bWins
    ? recordString(record.aWins, record.bWins, record.ties)
    : recordString(record.bWins, record.aWins, record.ties);
}

// Count of meetings between the two managers that occurred in the playoffs.
export function playoffMeetingCount(games: GameResult[]): number {
  return games.filter((g) => g.isPlayoff).length;
}

// The decided meeting (win or loss, ties excluded) with the smallest absolute point differential; null if none.
export function closestMeeting(games: GameResult[]): GameResult | null {
  const decided = games.filter((g) => g.result !== "T");
  if (decided.length === 0) return null;
  return decided.reduce((closest, g) =>
    Math.abs(g.pointsFor - g.pointsAgainst) < Math.abs(closest.pointsFor - closest.pointsAgainst) ? g : closest
  );
}

// The decided meeting (win or loss, ties excluded) with the largest absolute point differential; null if none.
export function largestBlowout(games: GameResult[]): GameResult | null {
  const decided = games.filter((g) => g.result !== "T");
  if (decided.length === 0) return null;
  return decided.reduce((biggest, g) =>
    Math.abs(g.pointsFor - g.pointsAgainst) > Math.abs(biggest.pointsFor - biggest.pointsAgainst) ? g : biggest
  );
}

export interface HeadToHeadStreak {
  winner: "self" | "opponent" | null; // "self" = the manager whose perspective this game log is from
  length: number;
}

// Current streak = consecutive identical results counting back from the most recent meeting; a tie resets it to none.
export function currentStreak(games: GameResult[]): HeadToHeadStreak {
  const chronological = sortChronologically(games);
  if (chronological.length === 0) return { winner: null, length: 0 };

  const lastResult = chronological[chronological.length - 1].result;
  if (lastResult === "T") return { winner: null, length: 0 };

  let length = 0;
  for (let i = chronological.length - 1; i >= 0; i -= 1) {
    if (chronological[i].result !== lastResult) break;
    length += 1;
  }
  return { winner: lastResult === "W" ? "self" : "opponent", length };
}
