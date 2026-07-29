import { describe, expect, it } from "vitest";
import {
  computeDraftQuality,
  DRAFT_WEIGHTS,
  letterFromDraftRank,
  type DraftPickInput,
  type TeamDraftInput,
} from "./draft-quality";

/** A 10-team, 16-round draft board. Team `slot` picks snake-style. */
function snakeBoard(teamCount: number, rounds: number): number[][] {
  const perTeam: number[][] = Array.from({ length: teamCount }, () => []);
  let pick = 1;
  for (let round = 1; round <= rounds; round++) {
    const order = round % 2 === 1 ? [...perTeam.keys()] : [...perTeam.keys()].reverse();
    for (const slot of order) perTeam[slot].push(pick++);
  }
  return perTeam;
}

const LINEUP: string[] = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "K",
  "DEF",
  "RB",
  "WR",
  "TE",
  "RB",
  "WR",
  "QB",
  "WR",
  "RB",
];

function team(
  id: string,
  picks: number[],
  overrides: Partial<DraftPickInput>[] = [],
): TeamDraftInput {
  return {
    fantasyTeamId: id,
    managerId: `mgr-${id}`,
    managerName: id.toUpperCase(),
    picks: picks.map((overallPickNumber, i) => ({
      overallPickNumber,
      round: i + 1,
      isKeeper: false,
      position: LINEUP[i % LINEUP.length],
      nflTeam: `T${i % 12}`,
      adp: null,
      byeWeek: null,
      ...overrides[i],
    })),
  };
}

describe("computeDraftQuality — starter quality", () => {
  it("rates starters by their prior positional standing, not by pick order", () => {
    const board = snakeBoard(2, 10);
    // Team 0 picks first all the way through but drafted mediocre players;
    // team 1 picks later and drafted the best at every position. Judged on
    // pick order team 0 would win; judged on the players, team 1 must.
    const t0 = team(
      "t0",
      board[0],
      board[0].map(() => ({ priorPositionalPercentile: 25 })),
    );
    const t1 = team(
      "t1",
      board[1],
      board[1].map(() => ({ priorPositionalPercentile: 95 })),
    );
    const result = computeDraftQuality([t0, t1]);

    const starter = (id: string) =>
      result.teams.find((x) => x.fantasyTeamId === id)!.factors.find((f) => f.key === "starterQuality")!;
    expect(starter("t1").value).toBeGreaterThan(starter("t0").value);
    expect(starter("t1").raw).toMatch(/percentile/);
  });

  it("falls back to pick order and warns when no prior season is on record", () => {
    const board = snakeBoard(2, 10);
    const result = computeDraftQuality(board.map((picks, i) => team(`t${i}`, picks)));
    expect(result.notes.join(" ")).toMatch(/falls back to where each starter was taken/i);
    const starter = result.teams[0].factors.find((f) => f.key === "starterQuality")!;
    expect(starter.raw).toMatch(/no prior-season data/);
  });

  it("still charges a team for slots it never filled", () => {
    const board = snakeBoard(2, 10);
    // Every pick is a running back, so most starting slots go unfilled even
    // though each individual player is elite.
    const allRb = team(
      "t0",
      board[0],
      board[0].map(() => ({ position: "RB", priorPositionalPercentile: 99 })),
    );
    const balanced = team(
      "t1",
      board[1],
      board[1].map(() => ({ priorPositionalPercentile: 60 })),
    );
    const result = computeDraftQuality([allRb, balanced]);
    const starter = (id: string) =>
      result.teams.find((x) => x.fantasyTeamId === id)!.factors.find((f) => f.key === "starterQuality")!;
    expect(starter("t0").value).toBeLessThan(starter("t1").value);
  });
});

describe("computeDraftQuality", () => {
  it("drops the ADP factor and says so when no ADP is on record", () => {
    const board = snakeBoard(3, 6);
    const teams = board.map((picks, i) => team(`t${i}`, picks));
    const result = computeDraftQuality(teams);

    expect(result.adpAvailable).toBe(false);
    expect(result.weights.map((w) => w.key)).not.toContain("valueVsAdp");
    expect(result.notes.join(" ")).toMatch(/average draft position/i);
    // Remaining weights are renormalised to sum to 1.
    expect(result.weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 2);
  });

  it("uses the ADP factor when ADP is available", () => {
    const board = snakeBoard(2, 6);
    const teams = board.map((picks, i) =>
      team(
        `t${i}`,
        picks,
        picks.map((p) => ({ adp: p + (i === 0 ? 12 : -12) })),
      ),
    );
    const result = computeDraftQuality(teams);

    expect(result.adpAvailable).toBe(true);
    expect(result.weights.map((w) => w.key)).toContain("valueVsAdp");
    // t0's players all went later than their ADP — that is value.
    expect(result.teams[0].fantasyTeamId).toBe("t0");
  });

  it("weights sum to 1", () => {
    expect(Object.values(DRAFT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("does not use season results — identical boards grade identically", () => {
    // Two teams with mirror-image draft slots. Nothing about the season is
    // passed in, so there is nothing that could make one outrank the other
    // beyond the picks themselves.
    const board = snakeBoard(2, 8);
    const first = computeDraftQuality([team("a", board[0]), team("b", board[1])]);
    const second = computeDraftQuality([team("a", board[0]), team("b", board[1])]);
    expect(second.teams.map((t) => t.score)).toEqual(first.teams.map((t) => t.score));
  });

  it("rewards a team that secured its starters earlier", () => {
    // "early" holds picks 1-8; "late" holds 9-16. Same positions either way.
    const early = team("early", [1, 2, 3, 4, 5, 6, 7, 8]);
    const late = team("late", [9, 10, 11, 12, 13, 14, 15, 16]);
    const result = computeDraftQuality([early, late]);
    expect(result.teams[0].fantasyTeamId).toBe("early");
  });

  it("penalises a roster that cannot field a legal lineup", () => {
    const board = snakeBoard(2, 8);
    const balanced = team("balanced", board[0]);
    const allRunningBacks: TeamDraftInput = {
      ...team("hoarder", board[1]),
      picks: board[1].map((overallPickNumber, i) => ({
        overallPickNumber,
        round: i + 1,
        isKeeper: false,
        position: "RB",
        nflTeam: "T1",
        adp: null,
        byeWeek: null,
      })),
    };
    const result = computeDraftQuality([balanced, allRunningBacks]);
    const hoarder = result.teams.find((t) => t.fantasyTeamId === "hoarder")!;
    const good = result.teams.find((t) => t.fantasyTeamId === "balanced")!;
    const construction = (id: string) =>
      result.teams
        .find((t) => t.fantasyTeamId === id)!
        .factors.find((f) => f.key === "rosterConstruction")!.value;
    expect(construction("hoarder")).toBeLessThan(construction("balanced"));
    expect(hoarder.score).toBeLessThan(good.score);
  });

  it("penalises concentrating the roster on one NFL team", () => {
    const board = snakeBoard(2, 8);
    const spread = team("spread", board[0]);
    const stacked: TeamDraftInput = {
      ...team("stacked", board[1]),
      picks: board[1].map((overallPickNumber, i) => ({
        overallPickNumber,
        round: i + 1,
        isKeeper: false,
        position: LINEUP[i % LINEUP.length],
        nflTeam: "KC",
        adp: null,
        byeWeek: null,
      })),
    };
    const result = computeDraftQuality([spread, stacked]);
    const risk = (id: string) =>
      result.teams
        .find((t) => t.fantasyTeamId === id)!
        .factors.find((f) => f.key === "riskConcentration")!.value;
    expect(risk("stacked")).toBeLessThan(risk("spread"));
  });

  it("drops bye-week spread entirely when byes are unknown, rather than scoring it neutrally", () => {
    const board = snakeBoard(2, 6);
    const result = computeDraftQuality(board.map((p, i) => team(`t${i}`, p)));
    for (const t of result.teams) {
      expect(t.factors.find((f) => f.key === "byeWeekSpread")).toBeUndefined();
    }
    expect(result.weights.some((w) => w.key === "byeWeekSpread")).toBe(false);
    expect(result.notes.join(" ")).toMatch(/bye weeks/i);
  });

  it("renormalises the surviving weights to 1 when factors are dropped", () => {
    const board = snakeBoard(4, 8);
    const result = computeDraftQuality(board.map((p, i) => team(`t${i}`, p)));
    const total = result.weights.reduce((sum, w) => sum + w.weight, 0);
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
    for (const t of result.teams) {
      const factorTotal = t.factors.reduce((sum, f) => sum + f.weight, 0);
      expect(factorTotal).toBeCloseTo(total, 2);
    }
  });

  it("does not grade an incidental same-team stack as concentration risk", () => {
    // Every roster takes at most RISK_FREE_STACK players from one club, which
    // is what a draft of this length picks up by accident.
    const board = snakeBoard(3, 6);
    const teams = board.map((picks, t) => ({
      ...team(`t${t}`, picks),
      picks: picks.map((overallPickNumber, i) => ({
        overallPickNumber,
        round: i + 1,
        isKeeper: false,
        position: LINEUP[i % LINEUP.length],
        // Rotates across four clubs, so nobody exceeds three from one.
        nflTeam: ["KC", "SF", "BUF", "DAL"][i % 4],
        adp: null,
        byeWeek: null,
      })),
    }));
    const result = computeDraftQuality(teams);
    for (const t of result.teams) {
      expect(t.factors.find((f) => f.key === "riskConcentration")).toBeUndefined();
    }
    expect(result.notes.join(" ")).toMatch(/concentration/i);
  });

  it("returns an empty result for no teams", () => {
    const result = computeDraftQuality([]);
    expect(result.teams).toEqual([]);
    expect(result.weights).toEqual([]);
  });
});

describe("letterFromDraftRank", () => {
  it("spreads a ten-team field across the alphabet instead of bunching at B+", () => {
    const letters = Array.from({ length: 10 }, (_, i) => letterFromDraftRank(i + 1, 10));
    expect(letters[0]).toBe("A_PLUS");
    expect(letters[9]).toBe("F");
    // The old heuristic returned B+ for essentially everyone; a real curve
    // should produce a wide spread.
    expect(new Set(letters).size).toBeGreaterThanOrEqual(7);
  });

  it("orders letters monotonically from best to worst rank", () => {
    const order = [
      "A_PLUS",
      "A",
      "A_MINUS",
      "B_PLUS",
      "B",
      "B_MINUS",
      "C_PLUS",
      "C",
      "C_MINUS",
      "D",
      "F",
    ];
    const indices = Array.from({ length: 12 }, (_, i) =>
      order.indexOf(letterFromDraftRank(i + 1, 12)),
    );
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it("handles a single-team field without dividing by zero", () => {
    expect(letterFromDraftRank(1, 1)).toBe("A_PLUS");
  });
});
