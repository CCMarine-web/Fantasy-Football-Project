import type { SeasonFinish } from "./types";

// Count of seasons in which the manager made the playoffs.
export function playoffAppearances(finishes: SeasonFinish[]): number {
  return finishes.filter((f) => f.madePlayoffs).length;
}

// Count of seasons the manager won the championship.
export function championships(finishes: SeasonFinish[]): number {
  return finishes.filter((f) => f.isChampion).length;
}

// Count of seasons the manager reached the championship game, as champion or runner-up.
export function finalsAppearances(finishes: SeasonFinish[]): number {
  return finishes.filter((f) => f.isChampion || f.isRunnerUp).length;
}

// Mean of finalRank across all seasons; 0 when there are no seasons (avoids NaN from an empty career).
export function averageFinish(finishes: SeasonFinish[]): number {
  if (finishes.length === 0) return 0;
  return finishes.reduce((sum, f) => sum + f.finalRank, 0) / finishes.length;
}

// Every season's finish sorted chronologically by season, ascending.
export function finishesBySeason(finishes: SeasonFinish[]): SeasonFinish[] {
  return [...finishes].sort((a, b) => a.season - b.season);
}

/**
 * The record-holder(s) of the longest value in `entries`, with ties named
 * together ("A & B") rather than decided by whichever row came first. The id
 * is only set when one manager holds it alone (it is used for a profile link).
 */
export function sharedRecord(
  entries: { id: string; name: string; len: number }[],
): { id: string | null; name: string; len: number; shared: boolean } | null {
  const best = Math.max(0, ...entries.map((e) => e.len));
  if (best === 0) return null;
  const holders = entries.filter((e) => e.len === best).sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: holders.length === 1 ? holders[0].id : null,
    name: holders.map((h) => h.name).join(" & "),
    len: best,
    shared: holders.length > 1,
  };
}
