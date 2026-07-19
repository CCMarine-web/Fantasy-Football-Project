import { describe, expect, it } from "vitest";
import { averageFinish, championships, finalsAppearances, finishesBySeason, playoffAppearances } from "./finishes";
import type { SeasonFinish } from "./types";

function finish(overrides: Partial<SeasonFinish>): SeasonFinish {
  return {
    season: 2023,
    regularSeasonRank: 5,
    finalRank: 5,
    madePlayoffs: false,
    isChampion: false,
    isRunnerUp: false,
    ...overrides,
  };
}

describe("career finish stats", () => {
  it("returns zeroed/empty values for an empty career", () => {
    expect(playoffAppearances([])).toBe(0);
    expect(championships([])).toBe(0);
    expect(finalsAppearances([])).toBe(0);
    expect(averageFinish([])).toBe(0);
    expect(finishesBySeason([])).toEqual([]);
  });

  it("counts playoff appearances", () => {
    const finishes = [
      finish({ season: 2020, madePlayoffs: true }),
      finish({ season: 2021, madePlayoffs: false }),
      finish({ season: 2022, madePlayoffs: true }),
    ];
    expect(playoffAppearances(finishes)).toBe(2);
  });

  it("counts championships", () => {
    const finishes = [
      finish({ season: 2020, isChampion: true, finalRank: 1 }),
      finish({ season: 2021, isChampion: false, finalRank: 3 }),
      finish({ season: 2022, isChampion: true, finalRank: 1 }),
    ];
    expect(championships(finishes)).toBe(2);
  });

  it("counts finals appearances as champion or runner-up", () => {
    const finishes = [
      finish({ season: 2020, isChampion: true, finalRank: 1 }),
      finish({ season: 2021, isRunnerUp: true, finalRank: 2 }),
      finish({ season: 2022, finalRank: 4 }),
    ];
    expect(finalsAppearances(finishes)).toBe(2);
  });

  it("computes the average final rank across seasons", () => {
    const finishes = [finish({ finalRank: 1 }), finish({ finalRank: 3 }), finish({ finalRank: 8 })];
    expect(averageFinish(finishes)).toBeCloseTo(4);
  });

  it("handles a single-season career", () => {
    const finishes = [finish({ season: 2023, finalRank: 2, isRunnerUp: true, madePlayoffs: true })];
    expect(playoffAppearances(finishes)).toBe(1);
    expect(championships(finishes)).toBe(0);
    expect(finalsAppearances(finishes)).toBe(1);
    expect(averageFinish(finishes)).toBe(2);
    expect(finishesBySeason(finishes)).toEqual(finishes);
  });

  it("sorts finishes chronologically by season without mutating the input", () => {
    const finishes = [finish({ season: 2022 }), finish({ season: 2020 }), finish({ season: 2021 })];
    const sorted = finishesBySeason(finishes);
    expect(sorted.map((f) => f.season)).toEqual([2020, 2021, 2022]);
    // original array order is untouched
    expect(finishes.map((f) => f.season)).toEqual([2022, 2020, 2021]);
  });
});
