import { describe, expect, it } from "vitest";
import { expectedWins, scheduleLuck, seasonAllPlayTotals, weeklyAllPlay } from "./all-play";
import type { AllPlayRecord, WeeklyScore } from "./types";

describe("all-play stats", () => {
  it("returns an empty array for an empty week", () => {
    expect(weeklyAllPlay([], 1, 2023)).toEqual([]);
  });

  it("computes each team's all-play record against every other team for the week", () => {
    const scores: WeeklyScore[] = [
      { teamId: "A", points: 100 },
      { teamId: "B", points: 90 },
      { teamId: "C", points: 110 },
    ];
    const result = weeklyAllPlay(scores, 1, 2023);
    const byId = Object.fromEntries(result.map((r) => [r.teamId, r]));

    // A beat B (100 > 90), lost to C (100 < 110)
    expect(byId["A"]).toMatchObject({ wins: 1, losses: 1, ties: 0, week: 1, season: 2023 });
    // B lost to both A and C
    expect(byId["B"]).toMatchObject({ wins: 0, losses: 2, ties: 0 });
    // C beat both A and B
    expect(byId["C"]).toMatchObject({ wins: 2, losses: 0, ties: 0 });
  });

  it("counts ties when scores are identical", () => {
    const scores: WeeklyScore[] = [
      { teamId: "A", points: 100 },
      { teamId: "B", points: 100 },
      { teamId: "C", points: 100 },
    ];
    const result = weeklyAllPlay(scores, 1, 2023);
    for (const r of result) {
      expect(r).toMatchObject({ wins: 0, losses: 0, ties: 2 });
    }
  });

  it("gives a lone team in the league neither wins nor losses", () => {
    const scores: WeeklyScore[] = [{ teamId: "A", points: 100 }];
    const result = weeklyAllPlay(scores, 1, 2023);
    expect(result).toEqual([{ teamId: "A", week: 1, season: 2023, wins: 0, losses: 0, ties: 0 }]);
  });

  it("aggregates weekly all-play records into season totals", () => {
    const records: AllPlayRecord[] = [
      { teamId: "A", week: 1, season: 2023, wins: 2, losses: 1, ties: 0 },
      { teamId: "A", week: 2, season: 2023, wins: 1, losses: 2, ties: 0 },
      { teamId: "B", week: 1, season: 2023, wins: 1, losses: 2, ties: 0 },
    ];
    const totals = seasonAllPlayTotals(records);
    const byId = Object.fromEntries(totals.map((t) => [t.teamId, t]));
    expect(byId["A"]).toEqual({ teamId: "A", wins: 3, losses: 3, ties: 0, games: 6 });
    expect(byId["B"]).toEqual({ teamId: "B", wins: 1, losses: 2, ties: 0, games: 3 });
  });

  it("returns an empty array of totals for empty input", () => {
    expect(seasonAllPlayTotals([])).toEqual([]);
  });

  it("computes expected wins as the sum of weekly all-play win rates", () => {
    const records: AllPlayRecord[] = [
      { teamId: "A", week: 1, season: 2023, wins: 3, losses: 0, ties: 0 }, // rate 1.0
      { teamId: "A", week: 2, season: 2023, wins: 0, losses: 2, ties: 2 }, // rate 0.25
    ];
    // 1.0 + 0.25 = 1.25
    expect(expectedWins(records)).toBeCloseTo(1.25);
  });

  it("guards against divide-by-zero when a week has no games", () => {
    const records: AllPlayRecord[] = [{ teamId: "A", week: 1, season: 2023, wins: 0, losses: 0, ties: 0 }];
    expect(expectedWins(records)).toBe(0);
  });

  it("returns 0 expected wins for an empty record set", () => {
    expect(expectedWins([])).toBe(0);
  });

  it("computes schedule luck as actual wins minus expected wins", () => {
    const records: AllPlayRecord[] = [{ teamId: "A", week: 1, season: 2023, wins: 1, losses: 3, ties: 0 }]; // rate 0.25
    expect(scheduleLuck(4, records)).toBeCloseTo(3.75);
    expect(scheduleLuck(0, records)).toBeCloseTo(-0.25);
  });
});
