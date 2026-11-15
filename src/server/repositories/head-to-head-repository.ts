import { cached, CACHE_TAGS } from "@/server/cache";
import { summarizeSeries, type SeriesSummary } from "@/server/stats/head-to-head";
import type { GameResult } from "@/server/stats/types";
import { loadVerifiedGames, toGameResult, type VerifiedGameRow } from "./verified-games";

/**
 * HEAD-TO-HEAD, the data path every page uses.
 *
 * One loader (verified games), one game-log shape, one series function
 * (`summarizeSeries`). The rivalry recompute builds its stored rows from the
 * same verified rows and the same function; the cross-page consistency test
 * (head-to-head-consistency.test.ts) and `npm run verify:data` assert that the
 * rivalry, profile and matchup paths agree for every pair.
 */

/** One manager's game log, every opponent, from verified rows. */
export function gameLogFor(rows: VerifiedGameRow[], managerId: string): GameResult[] {
  return rows.filter((r) => r.managerId === managerId).map(toGameResult);
}

/** The series between A and B, from A's side. */
export function seriesFromRows(rows: VerifiedGameRow[], aId: string, bId: string): SeriesSummary {
  return summarizeSeries(gameLogFor(rows, aId), bId);
}

/** Every opponent a manager has a counted series against, keyed by opponent id. */
export function seriesByOpponent(rows: VerifiedGameRow[], managerId: string): Map<string, SeriesSummary> {
  const log = gameLogFor(rows, managerId);
  const opponents = new Set(log.map((g) => g.opponentId));
  const out = new Map<string, SeriesSummary>();
  for (const opponentId of opponents) {
    const series = summarizeSeries(log, opponentId);
    if (series.games > 0) out.set(opponentId, series);
  }
  return out;
}

/**
 * Verified rows, cached. The whole league's history is a few thousand rows and
 * every head-to-head question on a page is answered from it.
 */
export const getVerifiedRowsCached = cached(() => loadVerifiedGames(), ["verified-game-rows"], {
  tags: [CACHE_TAGS.league],
});

/** The series between two managers, from A's side. */
export async function getSeries(aId: string, bId: string): Promise<SeriesSummary> {
  return seriesFromRows(await getVerifiedRowsCached(), aId, bId);
}
