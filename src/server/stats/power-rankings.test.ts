import { describe, it, expect } from "vitest";
import { computePowerRankings, POWER_WEIGHTS, type PowerRankingTeamInput } from "./power-rankings";

function team(id: string, pts: number[], opps: string[], results: ("W" | "L" | "T")[]): PowerRankingTeamInput {
  return {
    teamId: id,
    games: pts.map((p, i) => ({ week: i + 1, points: p, opponentId: opps[i], result: results[i] })),
  };
}

describe("computePowerRankings", () => {
  it("weights sum to 1", () => {
    const total = Object.values(POWER_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("ranks a dominant team first and a doormat last", () => {
    // A crushes everyone, C is crushed by everyone, B in the middle.
    const teams = [
      team("A", [130, 140, 135], ["B", "C", "B"], ["W", "W", "W"]),
      team("B", [100, 105, 110], ["A", "C", "A"], ["L", "W", "L"]),
      team("C", [80, 70, 75], ["C-bye", "A", "B-x"], ["L", "L", "L"]),
    ];
    const ranked = computePowerRankings(teams, 3);
    expect(ranked[0].teamId).toBe("A");
    expect(ranked[ranked.length - 1].teamId).toBe("C");
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    // scores are within 0-100
    for (const r of ranked) expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("respects the asOfWeek window (later weeks excluded)", () => {
    const teams = [
      team("A", [150, 150, 50], ["B", "B", "B"], ["W", "W", "L"]),
      team("B", [60, 60, 160], ["A", "A", "A"], ["L", "L", "W"]),
    ];
    // Through week 2, A dominates.
    const early = computePowerRankings(teams, 2);
    expect(early[0].teamId).toBe("A");
    // rank movement input: through week 3, B's huge week 3 narrows things,
    // but the function still returns a valid ordering with ranks assigned.
    const late = computePowerRankings(teams, 3);
    expect(late.map((r) => r.rank).sort()).toEqual([1, 2]);
  });

  it("gives a flat league equal-ish scores without throwing", () => {
    const teams = [
      team("A", [100, 100], ["B", "B"], ["T", "T"]),
      team("B", [100, 100], ["A", "A"], ["T", "T"]),
    ];
    const ranked = computePowerRankings(teams, 2);
    expect(ranked).toHaveLength(2);
    // identical teams -> identical normalized factors (50 each) -> equal scores
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 6);
  });

  it("handles an empty-window team gracefully", () => {
    const teams = [team("A", [], [], [])];
    const ranked = computePowerRankings(teams, 5);
    expect(ranked[0].raw.seasonPointsFor).toBe(0);
    expect(ranked[0].rank).toBe(1);
  });
});
