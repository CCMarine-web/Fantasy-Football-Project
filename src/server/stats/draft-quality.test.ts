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

  it("scores bye-week spread neutrally when byes are unknown", () => {
    const board = snakeBoard(2, 6);
    const result = computeDraftQuality(board.map((p, i) => team(`t${i}`, p)));
    for (const t of result.teams) {
      expect(t.factors.find((f) => f.key === "byeWeekSpread")!.value).toBe(50);
    }
    expect(result.notes.join(" ")).toMatch(/bye weeks/i);
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
