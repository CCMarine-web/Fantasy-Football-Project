import { describe, expect, it } from "vitest";
import { findLastPlace, type SeasonStandingTeam } from "./last-place";

function team(part: Partial<SeasonStandingTeam> & { managerId: string }): SeasonStandingTeam {
  return {
    managerName: part.managerId,
    teamName: `${part.managerId}'s team`,
    wins: 7,
    losses: 7,
    ties: 0,
    pointsFor: 1500,
    pointsAgainst: 1500,
    regularSeasonRank: null,
    ...part,
  };
}

describe("findLastPlace", () => {
  it("uses the platform's own standings order when every team is ranked", () => {
    // Deliberately conflicting: the worst RECORD is not the bottom-ranked team.
    // The league's own order wins, because it encodes the real tiebreaker.
    const result = findLastPlace(2025, [
      team({ managerId: "a", wins: 11, losses: 3, regularSeasonRank: 1 }),
      team({ managerId: "b", wins: 2, losses: 12, regularSeasonRank: 9, pointsFor: 1200 }),
      team({ managerId: "c", wins: 3, losses: 11, regularSeasonRank: 10, pointsFor: 1100 }),
    ]);
    expect(result?.managerId).toBe("c");
    expect(result?.basis).toBe("LEAGUE_STANDINGS");
  });

  it("falls back to record then points when no standings order was recorded", () => {
    const result = findLastPlace(2025, [
      team({ managerId: "a", wins: 10, losses: 4 }),
      team({ managerId: "b", wins: 4, losses: 10, pointsFor: 1400 }),
      team({ managerId: "c", wins: 4, losses: 10, pointsFor: 1300 }),
    ]);
    expect(result?.managerId).toBe("c");
    expect(result?.basis).toBe("POINTS_FALLBACK");
  });

  it("falls back when the standings order is only partly recorded", () => {
    // A half-ranked season must not be decided by whichever teams happen to
    // carry a number.
    const result = findLastPlace(2025, [
      team({ managerId: "a", wins: 10, losses: 4, regularSeasonRank: 1 }),
      team({ managerId: "b", wins: 6, losses: 8, regularSeasonRank: 2 }),
      team({ managerId: "c", wins: 1, losses: 13, regularSeasonRank: null }),
    ]);
    expect(result?.managerId).toBe("c");
    expect(result?.basis).toBe("POINTS_FALLBACK");
  });

  it("ignores teams that played no games, and returns null when none did", () => {
    const played = findLastPlace(2026, [
      team({ managerId: "a", wins: 2, losses: 3 }),
      team({ managerId: "unplayed", wins: 0, losses: 0, pointsFor: 0 }),
    ]);
    expect(played?.managerId).toBe("a");
    expect(played?.teamsInSeason).toBe(1);

    const preseason = findLastPlace(2026, [
      team({ managerId: "a", wins: 0, losses: 0, pointsFor: 0 }),
      team({ managerId: "b", wins: 0, losses: 0, pointsFor: 0 }),
    ]);
    expect(preseason).toBeNull();
  });

  it("counts a tie as half a win when falling back on record", () => {
    const result = findLastPlace(2025, [
      team({ managerId: "a", wins: 4, losses: 9, ties: 1 }), // .321
      team({ managerId: "b", wins: 4, losses: 10, ties: 0 }), // .286
    ]);
    expect(result?.managerId).toBe("b");
    expect(result?.record).toBe("4-10");
  });

  it("formats a tied record with the tie included", () => {
    const result = findLastPlace(2025, [
      team({ managerId: "a", wins: 10, losses: 4 }),
      team({ managerId: "b", wins: 2, losses: 11, ties: 1 }),
    ]);
    expect(result?.record).toBe("2-11-1");
  });
});
