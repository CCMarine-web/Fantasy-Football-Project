import { describe, expect, it } from "vitest";
import { isBracketPending, projectedSeeds } from "./playoff-week";

describe("isBracketPending", () => {
  it("regular-season weeks are never pending", () => {
    expect(isBracketPending({ week: 10, playoffStartWeek: 15, lastFinalRegularWeek: 9 })).toBe(false);
    expect(isBracketPending({ week: 14, playoffStartWeek: 15, lastFinalRegularWeek: null })).toBe(false);
  });

  it("a playoff week is pending until the last regular-season week is final", () => {
    expect(isBracketPending({ week: 15, playoffStartWeek: 15, lastFinalRegularWeek: 9 })).toBe(true);
    expect(isBracketPending({ week: 17, playoffStartWeek: 15, lastFinalRegularWeek: 13 })).toBe(true);
    expect(isBracketPending({ week: 15, playoffStartWeek: 15, lastFinalRegularWeek: null })).toBe(true);
    expect(isBracketPending({ week: 15, playoffStartWeek: 15, lastFinalRegularWeek: 14 })).toBe(false);
    expect(isBracketPending({ week: 16, playoffStartWeek: 15, lastFinalRegularWeek: 14 })).toBe(false);
  });

  it("follows Sleeper's playoff_week_start, not a hard-coded week", () => {
    expect(isBracketPending({ week: 14, playoffStartWeek: 14, lastFinalRegularWeek: 12 })).toBe(true);
    expect(isBracketPending({ week: 14, playoffStartWeek: 14, lastFinalRegularWeek: 13 })).toBe(false);
  });
});

describe("projectedSeeds", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    rank: 10 - i,
    teamName: `T${10 - i}`,
    managerName: `M${10 - i}`,
    wins: i,
    losses: 9 - i,
  }));

  it("takes the top teams in standings order", () => {
    const seeds = projectedSeeds(rows, 6);
    expect(seeds.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seeds.map((s) => s.teamName)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
  });

  it("gives seeds 1 and 2 the bye in a six-team bracket", () => {
    expect(projectedSeeds(rows, 6).filter((s) => s.bye).map((s) => s.seed)).toEqual([1, 2]);
    expect(projectedSeeds(rows, 4).some((s) => s.bye)).toBe(false);
  });
});
