import { describe, expect, it } from "vitest";
import { compareStandings, isInPlayoffField, rankStandings, winPct, type RankableTeam } from "./standings";

function t(id: string, wins: number, losses: number, pointsFor: number, extra: Partial<RankableTeam> = {}): RankableTeam {
  return { id, name: id, wins, losses, ties: 0, pointsFor, pointsAgainst: 1000, ...extra };
}

describe("rankStandings", () => {
  it("ranks 1..n by win percentage, never 0 or a dash", () => {
    const ranked = rankStandings([t("c", 3, 6, 1215), t("a", 8, 1, 1435), t("b", 7, 2, 1249)]);
    expect(ranked.map((r) => [r.team.id, r.rank])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("breaks equal records on points for and says so", () => {
    // Week 9, 2026: Cibilich and Javier both 6-3.
    const ranked = rankStandings([t("javier", 6, 3, 1153.96), t("cibilich", 6, 3, 1240.22)]);
    expect(ranked[0].team.id).toBe("cibilich");
    expect(ranked[1]).toMatchObject({ rank: 2, separatedBy: "Points for" });
    expect(ranked[0].separatedBy).toBeNull();
  });

  it("falls back to points against, then name", () => {
    const ranked = rankStandings([
      t("z", 5, 4, 1100, { pointsAgainst: 900 }),
      t("y", 5, 4, 1100, { pointsAgainst: 1000 }),
      t("x", 5, 4, 1100, { pointsAgainst: 900 }),
    ]);
    expect(ranked.map((r) => r.team.id)).toEqual(["x", "z", "y"]);
    expect(ranked[1].separatedBy).toBe("Team name");
    expect(ranked[2].separatedBy).toBe("Points against (fewer)");
  });

  it("counts a tie as half a win", () => {
    expect(winPct({ wins: 1, losses: 1, ties: 1 })).toBe(0.5);
    expect(compareStandings(t("a", 5, 3, 1, { ties: 1 }), t("b", 5, 4, 999))).toBeLessThan(0);
  });

  it("uses the platform's stored rank once a season is complete", () => {
    const ranked = rankStandings([
      t("a", 10, 4, 1500, { storedRank: 2 }),
      t("b", 9, 5, 1600, { storedRank: 1 }),
    ]);
    expect(ranked.map((r) => r.team.id)).toEqual(["b", "a"]);
  });

  it("ignores partial stored ranks during a season", () => {
    const ranked = rankStandings([t("a", 1, 0, 100, { storedRank: 5 }), t("b", 0, 1, 90, { storedRank: null })]);
    expect(ranked[0].team.id).toBe("a");
  });

  it("marks the playoff field", () => {
    expect(isInPlayoffField(6, 6)).toBe(true);
    expect(isInPlayoffField(7, 6)).toBe(false);
    expect(isInPlayoffField(0, 6)).toBe(false);
  });
});
