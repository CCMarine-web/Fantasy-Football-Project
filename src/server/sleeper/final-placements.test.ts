import { describe, expect, it } from "vitest";
import { deriveFinalPlacements } from "./final-placements";
import type { SleeperBracketMatchup } from "./types";

function m(part: Partial<SleeperBracketMatchup>): SleeperBracketMatchup {
  return {
    r: 1,
    m: 1,
    t1: null,
    t2: null,
    w: null,
    l: null,
    t1_from: null,
    t2_from: null,
    ...part,
  };
}

/**
 * The real 2023 brackets for this league, which is what the offset assumption
 * has to hold against.
 */
const WINNERS_2023: SleeperBracketMatchup[] = [
  m({ r: 1, m: 1, t1: 5, t2: 4, w: 5, l: 4 }),
  m({ r: 1, m: 2, t1: 3, t2: 6, w: 6, l: 3 }),
  m({ r: 2, m: 3, t1: 7, t2: 5, w: 7, l: 5 }),
  m({ r: 2, m: 4, t1: 2, t2: 6, w: 6, l: 2 }),
  m({ r: 2, m: 5, t1: 4, t2: 3, w: 3, l: 4, p: 5 }),
  m({ r: 3, m: 6, t1: 7, t2: 6, w: 6, l: 7, p: 1 }),
  m({ r: 3, m: 7, t1: 5, t2: 2, w: 2, l: 5, p: 3 }),
];

const LOSERS_2023: SleeperBracketMatchup[] = [
  m({ r: 1, m: 1, t1: 8, t2: 9, w: 9, l: 8 }),
  m({ r: 1, m: 2, t1: 1, t2: 10, w: 1, l: 10 }),
  m({ r: 2, m: 3, t1: 9, t2: 1, w: 1, l: 9, p: 1 }),
  m({ r: 2, m: 4, t1: 8, t2: 10, w: 10, l: 8, p: 3 }),
];

describe("deriveFinalPlacements", () => {
  it("assigns every roster exactly one distinct place", () => {
    const result = deriveFinalPlacements(WINNERS_2023, LOSERS_2023, 6, 10);
    expect(result.problem).toBeUndefined();
    expect(result.byRosterId.size).toBe(10);
    const places = [...result.byRosterId.values()].sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("reads the winners bracket placements as absolute", () => {
    const { byRosterId } = deriveFinalPlacements(WINNERS_2023, LOSERS_2023, 6, 10);
    expect(byRosterId.get(6)).toBe(1); // won the p=1 final
    expect(byRosterId.get(7)).toBe(2); // lost it
    expect(byRosterId.get(2)).toBe(3); // won the p=3 game
    expect(byRosterId.get(5)).toBe(4);
    expect(byRosterId.get(3)).toBe(5); // won the p=5 game
    expect(byRosterId.get(4)).toBe(6);
  });

  it("reads the losers bracket from the bottom of the table up", () => {
    const { byRosterId } = deriveFinalPlacements(WINNERS_2023, LOSERS_2023, 6, 10);
    // p=1 is the toilet-bowl final: its `w` advanced by losing, so it is last.
    // Roster 1 scored 66 to roster 9's 107.1 in that game and finishes 10th.
    expect(byRosterId.get(1)).toBe(10);
    expect(byRosterId.get(9)).toBe(9);
    // p=3 decides 7th/8th between the two teams knocked out of the toilet bowl
    // by winning their first-round games.
    expect(byRosterId.get(10)).toBe(8);
    expect(byRosterId.get(8)).toBe(7);
  });

  it("records who reached the winners bracket", () => {
    const { playoffRosterIds } = deriveFinalPlacements(WINNERS_2023, LOSERS_2023, 6, 10);
    expect([...playoffRosterIds].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("returns nothing for an unplayed bracket rather than guessing", () => {
    const unplayed = WINNERS_2023.map((x) => ({ ...x, w: null, l: null }));
    const result = deriveFinalPlacements(unplayed, [], 6, 10);
    expect(result.byRosterId.size).toBe(0);
    expect(result.problem).toBeUndefined();
  });

  it("refuses consolation places that fall inside the playoff field", () => {
    // Nine playoff teams cannot coexist with a four-team toilet bowl; rather
    // than overwrite a real playoff finish, the whole season is refused.
    const result = deriveFinalPlacements(WINNERS_2023, LOSERS_2023, 9, 10);
    expect(result.problem).toMatch(/inside the 9-team playoff field/);
    expect(result.byRosterId.size).toBe(0);
  });

  it("refuses a bracket that would place two rosters in the same position", () => {
    // Two placement games claiming the same slot — what a wrong team count
    // looks like from the other direction.
    const collide: SleeperBracketMatchup[] = [
      m({ r: 2, m: 3, t1: 9, t2: 1, w: 1, l: 9, p: 1 }),
      m({ r: 2, m: 4, t1: 8, t2: 10, w: 10, l: 8, p: 1 }),
    ];
    const result = deriveFinalPlacements([], collide, 6, 10);
    expect(result.problem).toMatch(/assigned to both/);
    expect(result.byRosterId.size).toBe(0);
  });

  it("ignores matchups with no placement value", () => {
    const onlyUnplaced = [m({ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 })];
    const result = deriveFinalPlacements(onlyUnplaced, [], 6, 10);
    expect(result.byRosterId.size).toBe(0);
    expect(result.playoffRosterIds.has(1)).toBe(true);
  });
});
