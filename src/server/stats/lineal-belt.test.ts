import { describe, expect, it } from "vitest";
import { computeLinealBelt, type BeltGame } from "./lineal-belt";

/** Both sides of one game, the way verified game rows arrive. */
function game(
  year: number,
  week: number,
  a: string,
  aScore: number,
  b: string,
  bScore: number,
  extra: Partial<Pick<BeltGame, "isPlayoff" | "bracket">> & { aWins?: boolean | null } = {},
): BeltGame[] {
  const aWins = extra.aWins !== undefined ? extra.aWins : aScore > bScore ? true : aScore < bScore ? false : null;
  const base = { year, week, isPlayoff: extra.isPlayoff ?? false, bracket: extra.bracket ?? null };
  return [
    { ...base, managerId: a, managerName: a.toUpperCase(), opponentManagerId: b, opponentManagerName: b.toUpperCase(), score: aScore, opponentScore: bScore, isWinner: aWins },
    { ...base, managerId: b, managerName: b.toUpperCase(), opponentManagerId: a, opponentManagerName: a.toUpperCase(), score: bScore, opponentScore: aScore, isWinner: aWins == null ? null : !aWins },
  ];
}

const start = { managerId: "a", managerName: "A", year: 2017, week: 16 };

describe("computeLinealBelt", () => {
  it("starts with the first champion and passes to whoever beats the holder", () => {
    const belt = computeLinealBelt(
      [
        // The title game itself crowns, it does not count as a defense.
        ...game(2017, 16, "a", 120, "b", 100, { isPlayoff: true, bracket: "WINNERS" }),
        ...game(2018, 1, "a", 110, "c", 90),
        ...game(2018, 1, "b", 100, "d", 80),
        ...game(2018, 2, "a", 95, "d", 130),
        ...game(2018, 3, "d", 101, "b", 99),
        ...game(2018, 4, "c", 140, "d", 70),
      ],
      start,
    );
    expect(belt.reigns.map((r) => r.holderId)).toEqual(["a", "d", "c"]);
    expect(belt.reigns[0]).toMatchObject({ defenses: 1, endYear: 2018, endWeek: 2, lostToId: "d", lostScore: [95, 130] });
    expect(belt.reigns[1]).toMatchObject({ wonFromId: "a", wonScore: [130, 95], defenses: 1, lostToId: "c" });
    expect(belt.current).toMatchObject({ holderId: "c", isCurrent: true, startYear: 2018, startWeek: 4, defenses: 0 });
  });

  it("ignores consolation games and weeks the holder does not play", () => {
    const belt = computeLinealBelt(
      [
        ...game(2018, 15, "a", 50, "b", 150, { isPlayoff: true, bracket: "CONSOLATION" }),
        ...game(2018, 16, "c", 100, "d", 90, { isPlayoff: true, bracket: "WINNERS" }),
        ...game(2019, 1, "a", 100, "c", 90),
      ],
      start,
    );
    expect(belt.reigns).toHaveLength(1);
    expect(belt.current).toMatchObject({ holderId: "a", defenses: 1 });
  });

  it("treats a championship-bracket loss like any other", () => {
    const belt = computeLinealBelt(game(2018, 15, "a", 80, "b", 81, { isPlayoff: true, bracket: "WINNERS" }), start);
    expect(belt.current.holderId).toBe("b");
  });

  it("keeps the belt on a genuine tie, and lets the platform's tiebreak decide level scores", () => {
    const tie = computeLinealBelt(game(2018, 1, "a", 100, "b", 100), start);
    expect(tie.current).toMatchObject({ holderId: "a", defenses: 1 });

    const tiebreak = computeLinealBelt(game(2018, 1, "a", 100, "b", 100, { aWins: false }), start);
    expect(tiebreak.current.holderId).toBe("b");
  });

  it("names every reign tied for the longest and totals by manager", () => {
    const belt = computeLinealBelt(
      [
        ...game(2018, 1, "a", 100, "b", 90),
        ...game(2018, 2, "a", 100, "c", 120),
        ...game(2018, 3, "c", 100, "b", 90),
        ...game(2018, 4, "c", 100, "a", 190),
        ...game(2018, 5, "a", 100, "b", 90),
      ],
      start,
    );
    expect(belt.reigns.map((r) => [r.holderId, r.defenses])).toEqual([
      ["a", 1],
      ["c", 1],
      ["a", 1],
    ]);
    expect(belt.longest).toHaveLength(3);
    expect(belt.byManager[0]).toMatchObject({ managerId: "a", reigns: 2, defenses: 2 });
  });

  it("returns the opening reign unchanged when nothing has been played since", () => {
    const belt = computeLinealBelt([], start);
    expect(belt.reigns).toHaveLength(1);
    expect(belt.current).toMatchObject({ holderId: "a", defenses: 0, isCurrent: true, wonFromId: null });
  });
});
