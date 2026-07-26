import { describe, expect, it } from "vitest";

import {
  computeSeasonPowerRankings,
  POSTSEASON_POINTS,
  POWER_WEIGHTS,
  type PostseasonResult,
  type SeasonTeamInput,
} from "./season-power-rankings";

function team(
  id: string,
  scores: number[],
  wins: number,
  losses: number,
  postseason: PostseasonResult,
  ties = 0,
): SeasonTeamInput {
  return {
    fantasyTeamId: id,
    managerId: `mgr-${id}`,
    managerName: id,
    teamName: `${id} FC`,
    weeklyScores: scores.map((score, i) => ({ week: i + 1, score })),
    wins,
    losses,
    ties,
    postseason,
  };
}

describe("computeSeasonPowerRankings", () => {
  it("returns an empty list for no teams", () => {
    expect(computeSeasonPowerRankings([])).toEqual([]);
  });

  it("weights sum to exactly 1", () => {
    const total = Object.values(POWER_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("ranks a strictly dominant team first and a strictly worst team last", () => {
    const rows = computeSeasonPowerRankings([
      team("best", [120, 130, 125], 3, 0, "CHAMPION"),
      team("mid", [100, 105, 95], 2, 1, "MADE_PLAYOFFS"),
      team("worst", [80, 70, 75], 0, 3, "MISSED_PLAYOFFS"),
    ]);
    expect(rows.map((r) => r.fantasyTeamId)).toEqual(["best", "mid", "worst"]);
    expect(rows[0].rank).toBe(1);
    expect(rows[2].rank).toBe(3);
  });

  it("scores the best team 100 and the worst 0 on every normalised factor", () => {
    // The worst team must also be the most volatile, otherwise consistency
    // ties and both teams correctly land on 50 for that factor.
    const rows = computeSeasonPowerRankings([
      team("best", [120, 130, 125], 3, 0, "CHAMPION"),
      team("worst", [60, 90, 75], 0, 3, "MISSED_PLAYOFFS"),
    ]);
    const best = rows.find((r) => r.fantasyTeamId === "best")!;
    const worst = rows.find((r) => r.fantasyTeamId === "worst")!;
    expect(best.score).toBe(100);
    expect(worst.score).toBe(0);
  });

  it("gives every team 50 on a factor when they are all tied on it", () => {
    // Identical scores and records => record/scoring/strength/consistency flat.
    const rows = computeSeasonPowerRankings([
      team("a", [100, 100], 1, 1, "MISSED_PLAYOFFS"),
      team("b", [100, 100], 1, 1, "MISSED_PLAYOFFS"),
    ]);
    for (const r of rows) {
      for (const f of r.factors) expect(f.value).toBe(50);
      expect(r.score).toBe(50);
    }
  });

  it("computes all-play from weekly scores across the league", () => {
    // Week 1: a=100 b=90 c=80 -> a beats both, b beats c, c loses both.
    const rows = computeSeasonPowerRankings([
      team("a", [100], 1, 0, "MADE_PLAYOFFS"),
      team("b", [90], 1, 0, "MADE_PLAYOFFS"),
      team("c", [80], 0, 1, "MISSED_PLAYOFFS"),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.fantasyTeamId, r]));
    expect([byId.a.allPlayWins, byId.a.allPlayLosses]).toEqual([2, 0]);
    expect([byId.b.allPlayWins, byId.b.allPlayLosses]).toEqual([1, 1]);
    expect([byId.c.allPlayWins, byId.c.allPlayLosses]).toEqual([0, 2]);
  });

  it("counts an all-play tie for equal weekly scores", () => {
    const rows = computeSeasonPowerRankings([
      team("a", [100], 1, 0, "MADE_PLAYOFFS"),
      team("b", [100], 0, 1, "MISSED_PLAYOFFS"),
    ]);
    expect(rows.every((r) => r.allPlayTies === 1)).toBe(true);
  });

  it("treats win percentage as (W + 0.5T) / games", () => {
    const rows = computeSeasonPowerRankings([team("a", [100, 100], 1, 0, "MADE_PLAYOFFS", 1)]);
    expect(rows[0].winPct).toBe(0.75); // (1 + 0.5) / 2
  });

  it("rewards a lower standard deviation on the consistency factor", () => {
    // Same total points, same record; only volatility differs.
    const rows = computeSeasonPowerRankings([
      team("steady", [100, 100, 100], 2, 1, "MADE_PLAYOFFS"),
      team("swingy", [150, 50, 100], 2, 1, "MADE_PLAYOFFS"),
    ]);
    const steady = rows.find((r) => r.fantasyTeamId === "steady")!;
    const swingy = rows.find((r) => r.fantasyTeamId === "swingy")!;
    const c = (r: typeof steady) => r.factors.find((f) => f.key === "consistency")!.value;
    expect(c(steady)).toBe(100);
    expect(c(swingy)).toBe(0);
    expect(steady.score).toBeGreaterThan(swingy.score);
  });

  it("orders the postseason ladder champion > runner-up > third > made > missed", () => {
    const order: PostseasonResult[] = ["CHAMPION", "RUNNER_UP", "THIRD", "MADE_PLAYOFFS", "MISSED_PLAYOFFS"];
    for (let i = 1; i < order.length; i++) {
      expect(POSTSEASON_POINTS[order[i - 1]]).toBeGreaterThan(POSTSEASON_POINTS[order[i]]);
    }
  });

  it("lets a strong postseason outrank a marginally better regular season", () => {
    // Identical scoring; one wins the title, the other misses the playoffs
    // with one extra regular-season win.
    const rows = computeSeasonPowerRankings([
      team("champ", [100, 100, 100], 2, 1, "CHAMPION"),
      team("missed", [100, 100, 100], 3, 0, "MISSED_PLAYOFFS"),
    ]);
    expect(rows[0].fantasyTeamId).toBe("champ");
  });

  it("breaks score ties on total points, then name", () => {
    const rows = computeSeasonPowerRankings([
      team("zeta", [100, 100], 1, 1, "MADE_PLAYOFFS"),
      team("alpha", [100, 100], 1, 1, "MADE_PLAYOFFS"),
    ]);
    // Everything is flat, so both score 50 and equal points -> alphabetical.
    expect(rows.map((r) => r.fantasyTeamId)).toEqual(["alpha", "zeta"]);
  });

  it("assigns dense sequential ranks with no gaps", () => {
    const rows = computeSeasonPowerRankings([
      team("a", [120], 1, 0, "CHAMPION"),
      team("b", [110], 1, 0, "RUNNER_UP"),
      team("c", [100], 0, 1, "THIRD"),
      team("d", [90], 0, 1, "MISSED_PLAYOFFS"),
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("survives a team with no recorded games instead of dropping it", () => {
    const rows = computeSeasonPowerRankings([
      team("played", [100, 110], 2, 0, "CHAMPION"),
      team("empty", [], 0, 0, "MISSED_PLAYOFFS"),
    ]);
    expect(rows).toHaveLength(2);
    const empty = rows.find((r) => r.fantasyTeamId === "empty")!;
    expect(empty.pointsFor).toBe(0);
    expect(empty.winPct).toBe(0);
  });

  it("reports each factor's weight so the UI can explain the formula", () => {
    const rows = computeSeasonPowerRankings([team("a", [100], 1, 0, "CHAMPION")]);
    const weights = Object.fromEntries(rows[0].factors.map((f) => [f.key, f.weight]));
    expect(weights).toEqual(POWER_WEIGHTS);
  });

  it("is deterministic across runs", () => {
    const input = [
      team("a", [120, 95, 133], 2, 1, "RUNNER_UP"),
      team("b", [88, 140, 101], 1, 2, "MISSED_PLAYOFFS"),
      team("c", [110, 110, 110], 3, 0, "CHAMPION"),
    ];
    expect(computeSeasonPowerRankings(input)).toEqual(computeSeasonPowerRankings(input));
  });
});
