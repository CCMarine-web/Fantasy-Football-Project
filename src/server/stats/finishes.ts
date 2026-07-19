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
