import { describe, expect, it } from "vitest";
import {
  computeWeeklyPowerRankings,
  draftCapitalScore,
  IN_SEASON_WEIGHTS,
  PRESEASON_WEIGHTS,
  type TeamRankingInput,
  type WeeklyLine,
} from "./weekly-power-rankings";

function team(overrides: Partial<TeamRankingInput> & { fantasyTeamId: string }): TeamRankingInput {
  return {
    managerId: `mgr-${overrides.fantasyTeamId}`,
    managerName: overrides.fantasyTeamId.toUpperCase(),
    teamName: `Team ${overrides.fantasyTeamId}`,
    weeks: [],
    ...overrides,
  };
}

function weeks(points: number[], against: number[]): WeeklyLine[] {
  return points.map((pointsFor, i) => ({
    week: i + 1,
    pointsFor,
    pointsAgainst: against[i] ?? 100,
  }));
}

describe("weekly power rankings — weights", () => {
  it("in-season weights sum to 1", () => {
    const total = Object.values(IN_SEASON_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("preseason weights sum to 1", () => {
    const total = Object.values(PRESEASON_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("does not include win-loss record, championships or placement as a factor", () => {
    const keys = Object.keys(IN_SEASON_WEIGHTS);
    for (const banned of ["record", "wins", "losses", "postseason", "championships", "finalRank"]) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe("weekly power rankings — in season", () => {
  it("ranks the higher-scoring team above a luckier but weaker one", () => {
    // A loses every week but scores far more; B wins every week narrowly.
    const a = team({
      fantasyTeamId: "a",
      weeks: weeks([140, 145, 150, 138], [150, 150, 160, 150]),
    });
    const b = team({ fantasyTeamId: "b", weeks: weeks([90, 92, 88, 95], [80, 80, 80, 80]) });
    const result = computeWeeklyPowerRankings([a, b]);

    expect(result.mode).toBe("IN_SEASON");
    expect(result.rows[0].fantasyTeamId).toBe("a");
    // B actually won more games; the rating still prefers A.
    expect(result.rows[1].actualWins).toBeGreaterThan(result.rows[0].actualWins);
  });

  it("reports the latest completed week", () => {
    const a = team({ fantasyTeamId: "a", weeks: weeks([100, 110, 120], [90, 90, 90]) });
    const b = team({ fantasyTeamId: "b", weeks: weeks([95, 105, 115], [90, 90, 90]) });
    const result = computeWeeklyPowerRankings([a, b]);
    expect(result.throughWeek).toBe(3);
    expect(result.weeksCounted).toBe(3);
  });

  it("weights recent weeks more heavily than early ones", () => {
    // Same total points; A front-loaded, B finishing strong.
    const a = team({ fantasyTeamId: "a", weeks: weeks([160, 150, 90, 80], [100, 100, 100, 100]) });
    const b = team({ fantasyTeamId: "b", weeks: weeks([80, 90, 150, 160], [100, 100, 100, 100]) });
    const result = computeWeeklyPowerRankings([a, b]);
    const rowA = result.rows.find((r) => r.fantasyTeamId === "a")!;
    const rowB = result.rows.find((r) => r.fantasyTeamId === "b")!;
    expect(rowB.weightedPointsPerGame!).toBeGreaterThan(rowA.weightedPointsPerGame!);
    expect(result.rows[0].fantasyTeamId).toBe("b");
  });

  it("computes all-play and expected wins independently of the schedule", () => {
    const a = team({ fantasyTeamId: "a", weeks: weeks([120, 120], [200, 200]) });
    const b = team({ fantasyTeamId: "b", weeks: weeks([110, 110], [10, 10]) });
    const result = computeWeeklyPowerRankings([a, b]);
    const rowA = result.rows.find((r) => r.fantasyTeamId === "a")!;
    // A out-scored B both weeks, so it wins the all-play regardless of results.
    expect(rowA.allPlayWins).toBe(2);
    expect(rowA.allPlayLosses).toBe(0);
    expect(rowA.expectedWins).toBe(2);
  });

  it("drops the lineup factors and renormalises when player data is missing", () => {
    const a = team({ fantasyTeamId: "a", weeks: weeks([120, 130], [100, 100]) });
    const b = team({ fantasyTeamId: "b", weeks: weeks([110, 100], [100, 100]) });
    const result = computeWeeklyPowerRankings([a, b]);

    const keys = result.weights.map((w) => w.key);
    expect(keys).not.toContain("lineupEfficiency");
    expect(keys).not.toContain("starterStrength");
    expect(keys).not.toContain("benchDepth");
    expect(result.weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 2);
    expect(result.notes.join(" ")).toMatch(/player-level/i);
  });

  it("uses the lineup factors when player-level data is present", () => {
    const withLineups = (points: number[]): WeeklyLine[] =>
      points.map((pointsFor, i) => ({
        week: i + 1,
        pointsFor,
        pointsAgainst: 100,
        starterPoints: pointsFor,
        optimalPoints: pointsFor + 10,
        benchPoints: 30,
      }));
    const a = team({ fantasyTeamId: "a", weeks: withLineups([120, 130]) });
    const b = team({ fantasyTeamId: "b", weeks: withLineups([110, 100]) });
    const result = computeWeeklyPowerRankings([a, b]);

    expect(result.weights.map((w) => w.key)).toContain("lineupEfficiency");
    expect(result.rows[0].lineupEfficiency).not.toBeNull();
    expect(result.notes).toHaveLength(0);
  });

  it("is deterministic", () => {
    const teams = [
      team({ fantasyTeamId: "a", weeks: weeks([120, 130, 110], [100, 100, 100]) }),
      team({ fantasyTeamId: "b", weeks: weeks([115, 125, 135], [100, 100, 100]) }),
      team({ fantasyTeamId: "c", weeks: weeks([100, 100, 100], [100, 100, 100]) }),
    ];
    const first = computeWeeklyPowerRankings(teams);
    const second = computeWeeklyPowerRankings(teams);
    expect(second.rows.map((r) => r.fantasyTeamId)).toEqual(first.rows.map((r) => r.fantasyTeamId));
    expect(second.rows.map((r) => r.score)).toEqual(first.rows.map((r) => r.score));
  });

  it("reports movement against a previous order", () => {
    const teams = [
      team({ fantasyTeamId: "a", weeks: weeks([150], [100]) }),
      team({ fantasyTeamId: "b", weeks: weeks([100], [100]) }),
    ];
    const result = computeWeeklyPowerRankings(teams, ["b", "a"]);
    const rowA = result.rows.find((r) => r.fantasyTeamId === "a")!;
    expect(rowA.rank).toBe(1);
    expect(rowA.previousRank).toBe(2);
  });
});

describe("weekly power rankings — before the draft", () => {
  it("ranks managers on history when no draft has happened", () => {
    const a = team({
      fantasyTeamId: "a",
      historicalPointsPerGame: 120,
      historicalStdDev: 10,
      managerAllPlayRate: 0.62,
    });
    const b = team({
      fantasyTeamId: "b",
      historicalPointsPerGame: 100,
      historicalStdDev: 25,
      managerAllPlayRate: 0.41,
    });
    const result = computeWeeklyPowerRankings([a, b]);

    expect(result.mode).toBe("MANAGER_BASELINE");
    expect(result.throughWeek).toBe(0);
    expect(result.rows[0].fantasyTeamId).toBe("a");
    expect(result.notes.join(" ")).toMatch(/draft has not happened/i);
  });

  it("never scores draft capital before a draft exists", () => {
    const a = team({ fantasyTeamId: "a", historicalPointsPerGame: 110, managerAllPlayRate: 0.5 });
    const b = team({ fantasyTeamId: "b", historicalPointsPerGame: 100, managerAllPlayRate: 0.5 });
    const result = computeWeeklyPowerRankings([a, b]);
    expect(result.weights.map((w) => w.key)).not.toContain("draftCapital");
  });

  it("drops categories it cannot measure and rescales the rest to 100%", () => {
    // No keepers and no consistency data for either team.
    const a = team({ fantasyTeamId: "a", historicalPointsPerGame: 120, managerAllPlayRate: 0.6 });
    const b = team({ fantasyTeamId: "b", historicalPointsPerGame: 100, managerAllPlayRate: 0.4 });
    const result = computeWeeklyPowerRankings([a, b]);

    expect(result.weights.map((w) => w.key).sort()).toEqual(["historicalScoring", "managerStrength"]);
    const total = result.weights.reduce((sum, w) => sum + w.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.notes.join(" ")).toMatch(/redistributed/i);
    // And every row's own factor weights add to 1 as well.
    for (const row of result.rows) {
      expect(row.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 10);
    }
  });

  it("handles a manager with no prior seasons without crashing", () => {
    const a = team({ fantasyTeamId: "a" });
    const b = team({ fantasyTeamId: "b" });
    const result = computeWeeklyPowerRankings([a, b]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => Number.isFinite(r.score))).toBe(true);
  });
});

describe("weekly power rankings — after the draft, before week 1", () => {
  const drafted = (id: string, capital: number, starter: number) =>
    team({
      fantasyTeamId: id,
      draftCapital: capital,
      starterQuality: starter,
      benchQuality: starter * 0.4,
      positionalBalance: 0.9,
      rosterDepth: 6,
      // Present, and deliberately ignored by this mode.
      historicalPointsPerGame: 999,
      managerAllPlayRate: 0.99,
    });

  it("switches to roster inputs once picks exist", () => {
    const result = computeWeeklyPowerRankings([drafted("a", 500, 14), drafted("b", 300, 10)]);
    expect(result.mode).toBe("PRESEASON");
    expect(result.rows[0].fantasyTeamId).toBe("a");
    expect(result.notes.join(" ")).toMatch(/draft is done/i);
  });

  it("scores the roster, not the manager's history", () => {
    // "b" has every historical advantage and a worse roster; the roster wins.
    const a = drafted("a", 600, 16);
    const b = { ...drafted("b", 200, 8), historicalPointsPerGame: 200, managerAllPlayRate: 0.95 };
    const result = computeWeeklyPowerRankings([a, b]);
    expect(result.rows[0].fantasyTeamId).toBe("a");
    expect(result.weights.map((w) => w.key)).not.toContain("historicalScoring");
    expect(result.weights.map((w) => w.key)).not.toContain("managerStrength");
  });

  it("drops the projection category when no projections exist and says so", () => {
    const result = computeWeeklyPowerRankings([drafted("a", 500, 14), drafted("b", 300, 10)]);
    expect(result.weights.map((w) => w.key)).not.toContain("projection");
    expect(result.notes.join(" ")).toMatch(/Preseason projection/i);
    expect(result.weights.reduce((sum, w) => sum + w.weight, 0)).toBeCloseTo(1, 10);
  });
});

describe("draftCapitalScore", () => {
  it("values earlier picks more, with diminishing differences", () => {
    const early = draftCapitalScore([1, 2]);
    const late = draftCapitalScore([101, 102]);
    expect(early).toBeGreaterThan(late);
    // The gap between picks 1 and 11 should exceed the gap between 101 and 111.
    const gapEarly = draftCapitalScore([1]) - draftCapitalScore([11]);
    const gapLate = draftCapitalScore([101]) - draftCapitalScore([111]);
    expect(gapEarly).toBeGreaterThan(gapLate);
  });

  it("is zero for an empty draft", () => {
    expect(draftCapitalScore([])).toBe(0);
  });
});
