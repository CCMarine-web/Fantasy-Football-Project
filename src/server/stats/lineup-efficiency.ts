import type { WeeklyLineup } from "./types";

export interface WeeklyEfficiency {
  week: number;
  season: number;
  efficiency: number; // starterPoints / optimalPoints, 0 when optimalPoints is 0
}

// Per-week lineup efficiency = starterPoints / optimalPoints; guarded to 0 when optimalPoints is 0.
export function weeklyEfficiency(lineups: WeeklyLineup[]): WeeklyEfficiency[] {
  return lineups.map((l) => ({
    week: l.week,
    season: l.season,
    efficiency: l.optimalPoints === 0 ? 0 : l.starterPoints / l.optimalPoints,
  }));
}

// Season-average efficiency = mean of each week's efficiency ratio; 0 when there are no weeks.
export function seasonAverageEfficiency(lineups: WeeklyLineup[]): number {
  const weekly = weeklyEfficiency(lineups);
  if (weekly.length === 0) return 0;
  return weekly.reduce((sum, w) => sum + w.efficiency, 0) / weekly.length;
}

// The single week with the highest starterPoints/optimalPoints ratio; null when there are no weeks.
export function bestEfficiencyWeek(lineups: WeeklyLineup[]): WeeklyEfficiency | null {
  const weekly = weeklyEfficiency(lineups);
  if (weekly.length === 0) return null;
  return weekly.reduce((best, w) => (w.efficiency > best.efficiency ? w : best));
}

// The single week with the lowest starterPoints/optimalPoints ratio; null when there are no weeks.
export function worstEfficiencyWeek(lineups: WeeklyLineup[]): WeeklyEfficiency | null {
  const weekly = weeklyEfficiency(lineups);
  if (weekly.length === 0) return null;
  return weekly.reduce((worst, w) => (w.efficiency < worst.efficiency ? w : worst));
}
