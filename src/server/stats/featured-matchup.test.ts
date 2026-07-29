import { describe, expect, it } from "vitest";
import {
  chooseFeaturedMatchup,
  FEATURED_WEIGHTS,
  type FeaturedCandidate,
} from "./featured-matchup";

/** A neutral candidate — every test varies only what it is about. */
function candidate(overrides: Partial<FeaturedCandidate> & { matchupId: string }): FeaturedCandidate {
  return {
    bracket: null,
    isPlayoff: false,
    projectedA: 110,
    projectedB: 110,
    powerRankA: 5,
    powerRankB: 6,
    teamsRanked: 10,
    winsA: 5,
    lossesA: 5,
    winsB: 5,
    lossesB: 5,
    standingA: 5,
    standingB: 6,
    playoffSpots: 6,
    isOfficialRivalry: false,
    headToHeadGames: 6,
    headToHeadAverageMargin: 20,
    recentFormA: ["W", "L", "W"],
    recentFormB: ["L", "W", "L"],
    weeksRemaining: 4,
    ...overrides,
  };
}

describe("chooseFeaturedMatchup", () => {
  it("returns null when there is nothing to choose from", () => {
    expect(chooseFeaturedMatchup([])).toBeNull();
  });

  it("never features a consolation-bracket game, however good it looks", () => {
    const toiletBowl = candidate({
      matchupId: "toilet",
      bracket: "CONSOLATION",
      isPlayoff: true,
      projectedA: 120,
      projectedB: 120,
      isOfficialRivalry: true,
      powerRankA: 1,
      powerRankB: 2,
      headToHeadAverageMargin: 1,
    });
    const ordinary = candidate({ matchupId: "ordinary", projectedA: 100, projectedB: 140 });

    const choice = chooseFeaturedMatchup([toiletBowl, ordinary]);
    expect(choice?.matchupId).toBe("ordinary");
    expect(choice?.ranked.map((r) => r.matchupId)).not.toContain("toilet");
  });

  it("returns null when every candidate is a consolation game", () => {
    expect(
      chooseFeaturedMatchup([candidate({ matchupId: "a", bracket: "CONSOLATION" })]),
    ).toBeNull();
  });

  it("prefers the closer projection when nothing else differs", () => {
    const blowout = candidate({ matchupId: "blowout", projectedA: 90, projectedB: 145 });
    const tight = candidate({ matchupId: "tight", projectedA: 118, projectedB: 120 });
    expect(chooseFeaturedMatchup([blowout, tight])?.matchupId).toBe("tight");
  });

  it("prefers an official rivalry over an identical non-rivalry", () => {
    const plain = candidate({ matchupId: "plain" });
    const grudge = candidate({ matchupId: "grudge", isOfficialRivalry: true });
    expect(chooseFeaturedMatchup([plain, grudge])?.matchupId).toBe("grudge");
  });

  it("does not let an official rivalry win when it is a blowout mismatch", () => {
    /*
     * The case that motivated the weighting. The league has an official rivalry
     * where one side has been dreadful; featuring it every week because it is on
     * a list would be worse than featuring the actual game of the week.
     */
    const lopsidedRivalry = candidate({
      matchupId: "lopsided-rivalry",
      isOfficialRivalry: true,
      projectedA: 92,
      projectedB: 138,
      powerRankA: 10,
      powerRankB: 3,
      winsA: 1,
      lossesA: 9,
      winsB: 8,
      lossesB: 2,
      standingA: 10,
      standingB: 2,
      recentFormA: ["L", "L", "L"],
      recentFormB: ["W", "W", "W"],
      headToHeadAverageMargin: 38,
    });
    const realGameOfTheWeek = candidate({
      matchupId: "real",
      projectedA: 121,
      projectedB: 123,
      powerRankA: 4,
      powerRankB: 5,
      winsA: 6,
      lossesA: 4,
      winsB: 6,
      lossesB: 4,
      standingA: 5,
      standingB: 6,
      recentFormA: ["W", "W", "L"],
      recentFormB: ["W", "L", "W"],
      headToHeadAverageMargin: 6,
    });
    expect(chooseFeaturedMatchup([lopsidedRivalry, realGameOfTheWeek])?.matchupId).toBe("real");
  });

  it("prefers the game on the playoff cut line over one between mid-table teams", () => {
    const onTheLine = candidate({ matchupId: "line", standingA: 6, standingB: 7, weeksRemaining: 1 });
    const deadRubber = candidate({
      matchupId: "dead",
      standingA: 1,
      standingB: 2,
      weeksRemaining: 1,
    });
    const choice = chooseFeaturedMatchup([onTheLine, deadRubber]);
    expect(choice?.matchupId).toBe("line");
  });

  it("treats a playoff game as maximum stakes", () => {
    const playoff = candidate({
      matchupId: "playoff",
      isPlayoff: true,
      bracket: "WINNERS",
      standingA: null,
      standingB: null,
    });
    const regular = candidate({ matchupId: "regular", standingA: 1, standingB: 2 });
    const choice = chooseFeaturedMatchup([playoff, regular]);
    const stakes = choice?.factors.find((f) => f.key === "stakes");
    expect(choice?.matchupId).toBe("playoff");
    expect(stakes?.value).toBe(100);
  });

  it("is deterministic and breaks exact ties on matchup id", () => {
    // Two genuinely identical games: the choice must be the lower id, every time.
    const a = candidate({ matchupId: "aaa" });
    const b = candidate({ matchupId: "bbb" });
    expect(chooseFeaturedMatchup([a, b])?.matchupId).toBe("aaa");
    // Order of input must not change the answer.
    expect(chooseFeaturedMatchup([b, a])?.matchupId).toBe("aaa");
  });

  it("gives the same answer on repeated calls", () => {
    const week = [
      candidate({ matchupId: "m1", projectedA: 118, projectedB: 121 }),
      candidate({ matchupId: "m2", isOfficialRivalry: true }),
      candidate({ matchupId: "m3", standingA: 6, standingB: 7 }),
    ];
    const first = chooseFeaturedMatchup(week);
    for (let i = 0; i < 5; i += 1) {
      expect(chooseFeaturedMatchup(week)).toEqual(first);
    }
  });

  it("drops factors it cannot measure and rescales the rest to 100%", () => {
    // Preseason: no projections, no standings, no form, no ranking.
    const preseason = candidate({
      matchupId: "pre",
      projectedA: null,
      projectedB: null,
      powerRankA: null,
      powerRankB: null,
      standingA: null,
      standingB: null,
      winsA: 0,
      lossesA: 0,
      winsB: 0,
      lossesB: 0,
      recentFormA: [],
      recentFormB: [],
      headToHeadGames: 0,
      headToHeadAverageMargin: null,
    });
    const choice = chooseFeaturedMatchup([preseason]);
    expect(choice).not.toBeNull();
    const total = choice!.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(total).toBeCloseTo(1, 6);
    // Only the rivalry flag survives with no games and no projections.
    expect(choice!.factors.map((f) => f.key)).toEqual(["officialRivalry"]);
  });

  it("still returns a choice when a whole week has no measurable factor", () => {
    const blank = candidate({
      matchupId: "blank",
      projectedA: null,
      projectedB: null,
      powerRankA: null,
      powerRankB: null,
      standingA: null,
      standingB: null,
      recentFormA: [],
      recentFormB: [],
      headToHeadGames: 0,
      headToHeadAverageMargin: null,
      isOfficialRivalry: false,
    });
    const choice = chooseFeaturedMatchup([blank, { ...blank, matchupId: "blank2" }]);
    // Both score 50 on the rivalry flag; the id decides.
    expect(choice?.matchupId).toBe("blank");
  });

  it("ranks every eligible candidate, best first", () => {
    const week = [
      candidate({ matchupId: "m1", projectedA: 100, projectedB: 150 }),
      candidate({ matchupId: "m2", projectedA: 119, projectedB: 121 }),
      candidate({ matchupId: "m3", projectedA: 105, projectedB: 135 }),
    ];
    const choice = chooseFeaturedMatchup(week)!;
    expect(choice.ranked).toHaveLength(3);
    expect(choice.ranked[0].matchupId).toBe("m2");
    for (let i = 1; i < choice.ranked.length; i += 1) {
      expect(choice.ranked[i - 1].score).toBeGreaterThanOrEqual(choice.ranked[i].score);
    }
  });

  it("weights sum to exactly 1", () => {
    const total = Object.values(FEATURED_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("explains its choice in terms a reader can check", () => {
    const choice = chooseFeaturedMatchup([
      candidate({ matchupId: "m1", projectedA: 118.4, projectedB: 121.2, isOfficialRivalry: true }),
      candidate({ matchupId: "m2", projectedA: 90, projectedB: 140 }),
    ])!;
    const closeness = choice.factors.find((f) => f.key === "projectedCloseness");
    expect(closeness?.reason).toBe("2.8 points between them on projections");
    const rivalry = choice.factors.find((f) => f.key === "officialRivalry");
    expect(rivalry?.reason).toBe("an official league rivalry");
  });
});
