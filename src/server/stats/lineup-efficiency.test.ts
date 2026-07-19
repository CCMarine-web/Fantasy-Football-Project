import { describe, expect, it } from "vitest";
import {
  bestEfficiencyWeek,
  seasonAverageEfficiency,
  weeklyEfficiency,
  worstEfficiencyWeek,
} from "./lineup-efficiency";
import type { WeeklyLineup } from "./types";

function lineup(overrides: Partial<WeeklyLineup>): WeeklyLineup {
  return { week: 1, season: 2023, starterPoints: 100, optimalPoints: 100, benchPoints: 20, ...overrides };
}

describe("lineup efficiency stats", () => {
  it("returns empty results for an empty lineup history", () => {
    expect(weeklyEfficiency([])).toEqual([]);
    expect(seasonAverageEfficiency([])).toBe(0);
    expect(bestEfficiencyWeek([])).toBeNull();
    expect(worstEfficiencyWeek([])).toBeNull();
  });

  it("computes per-week efficiency as starterPoints / optimalPoints", () => {
    const lineups = [lineup({ week: 1, starterPoints: 90, optimalPoints: 100 })];
    expect(weeklyEfficiency(lineups)).toEqual([{ week: 1, season: 2023, efficiency: 0.9 }]);
  });

  it("guards against divide-by-zero when optimalPoints is 0", () => {
    const lineups = [lineup({ week: 1, starterPoints: 0, optimalPoints: 0 })];
    expect(weeklyEfficiency(lineups)).toEqual([{ week: 1, season: 2023, efficiency: 0 }]);
  });

  it("computes the season average efficiency across weeks", () => {
    const lineups = [
      lineup({ week: 1, starterPoints: 100, optimalPoints: 100 }), // 1.0
      lineup({ week: 2, starterPoints: 50, optimalPoints: 100 }), // 0.5
    ];
    expect(seasonAverageEfficiency(lineups)).toBeCloseTo(0.75);
  });

  it("handles a single-week history for average, best, and worst", () => {
    const lineups = [lineup({ week: 1, starterPoints: 80, optimalPoints: 100 })];
    expect(seasonAverageEfficiency(lineups)).toBeCloseTo(0.8);
    expect(bestEfficiencyWeek(lineups)?.week).toBe(1);
    expect(worstEfficiencyWeek(lineups)?.week).toBe(1);
  });

  it("identifies the best and worst efficiency weeks", () => {
    const lineups = [
      lineup({ week: 1, starterPoints: 90, optimalPoints: 100 }), // 0.9
      lineup({ week: 2, starterPoints: 40, optimalPoints: 100 }), // 0.4 worst
      lineup({ week: 3, starterPoints: 100, optimalPoints: 100 }), // 1.0 best
    ];
    expect(bestEfficiencyWeek(lineups)?.week).toBe(3);
    expect(worstEfficiencyWeek(lineups)?.week).toBe(2);
  });
});
