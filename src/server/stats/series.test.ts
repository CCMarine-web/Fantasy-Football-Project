import { describe, expect, it } from "vitest";
import { countsForSeries, describeSeries, seriesRecordString, summarizeSeries } from "./head-to-head";
import type { GameResult } from "./types";

function g(over: Partial<GameResult>): GameResult {
  return {
    season: 2025,
    week: 1,
    isPlayoff: false,
    bracket: null,
    pointsFor: 110,
    pointsAgainst: 100,
    opponentId: "B",
    result: "W",
    ...over,
  };
}

describe("summarizeSeries — the one head-to-head definition", () => {
  it("names the leader correctly when the perspective side trails", () => {
    // Barkemeyer's view of the series with Cibilich: 6 wins, 8 losses.
    const games = [
      ...Array.from({ length: 6 }, (_, i) => g({ week: i + 1, pointsFor: 120, pointsAgainst: 100 })),
      ...Array.from({ length: 8 }, (_, i) => g({ season: 2024, week: i + 1, pointsFor: 90, pointsAgainst: 100, result: "L" })),
    ];
    const s = summarizeSeries(games, "B");
    expect(s).toMatchObject({ games: 14, aWins: 6, bWins: 8, ties: 0, leader: "B" });
    expect(describeSeries(s, "Michael Barkemeyer", "Anthony Cibilich")).toBe("Anthony Cibilich leads 8-6");
    expect(seriesRecordString(s)).toBe("8-6");
  });

  it("phrases a level series as tied, and never as 'to nobody'", () => {
    const games = [g({ week: 1 }), g({ week: 2, pointsFor: 80, result: "L" })];
    const s = summarizeSeries(games, "B");
    expect(s.leader).toBeNull();
    expect(describeSeries(s, "A", "B")).toBe("Series tied 1-1");
  });

  it("includes ties in the record string", () => {
    const games = [g({ week: 1 }), g({ week: 2, pointsFor: 100, pointsAgainst: 100, result: "T" })];
    const s = summarizeSeries(games, "B");
    expect(describeSeries(s, "Ann", "Bea")).toBe("Ann leads 1-0-1");
  });

  it("excludes consolation games and counts the championship bracket separately", () => {
    const games = [
      g({ week: 3 }),
      g({ week: 15, isPlayoff: true, bracket: "WINNERS", pointsFor: 90, result: "L" }),
      g({ week: 16, isPlayoff: true, bracket: "CONSOLATION" }),
    ];
    const s = summarizeSeries(games, "B");
    expect(s.games).toBe(2);
    expect(s.playoff).toEqual({ games: 1, aWins: 0, bWins: 1, ties: 0 });
    expect(countsForSeries({ isPlayoff: true, bracket: "CONSOLATION" })).toBe(false);
    expect(countsForSeries({ isPlayoff: true, bracket: "WINNERS" })).toBe(true);
    expect(countsForSeries({ isPlayoff: false, bracket: null })).toBe(true);
  });

  it("ignores games against other opponents", () => {
    const s = summarizeSeries([g({}), g({ opponentId: "C" })], "B");
    expect(s.games).toBe(1);
  });

  it("decides each result from the score, and the current streak from the most recent games", () => {
    const games = [
      g({ season: 2024, week: 1, pointsFor: 90, result: "W" /* stale flag: score says L */ }),
      g({ season: 2025, week: 1 }),
      g({ season: 2025, week: 9 }),
    ];
    const s = summarizeSeries(games, "B");
    expect(s.aWins).toBe(2);
    expect(s.streak).toEqual({ holder: "A", length: 2 });
    expect(s.lastMeeting).toEqual({ season: 2025, week: 9, winner: "A", isPlayoff: false });
  });

  it("averages the absolute margin", () => {
    const s = summarizeSeries([g({ pointsFor: 130, pointsAgainst: 100 }), g({ week: 2, pointsFor: 100, pointsAgainst: 110, result: "L" })], "B");
    expect(s.averageMargin).toBe(20);
  });

  it("describes an empty series as a first meeting", () => {
    expect(describeSeries(summarizeSeries([], "B"), "A", "B")).toBe("First meeting");
  });
});
