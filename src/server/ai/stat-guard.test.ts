import { describe, expect, it } from "vitest";
import { findHardRuleBreaches, findUnverifiedNumbers, toOneDecimal } from "./editorial-guards";

const SOURCE = `{"teamA":{"finalScore":125.34},"teamB":{"finalScore":115.08},"keyPerformances":["Jeremiyah Love (RB) 21.9","Dak Prescott (QB) 19.9"],"record":"2-1","seasonPoints":1560.4}`;

describe("findUnverifiedNumbers", () => {
  it("accepts numbers from the data, including its own rounding", () => {
    expect(findUnverifiedNumbers("Won 125.34-115.08, or 125.3-115.1, or 125 to 115.", SOURCE)).toEqual([]);
  });

  it("accepts gaps, totals and percentages of verified numbers", () => {
    // 125.34 - 115.08 = 10.26; 125.34 + 115.08 = 240.42
    expect(findUnverifiedNumbers("A 10.3-point win; 240.4 combined.", SOURCE)).toEqual([]);
  });

  it("flags an invented score", () => {
    expect(findUnverifiedNumbers("He put up 162.7, a franchise best.", SOURCE)).toEqual(["162.7"]);
  });

  it("handles thousands separators", () => {
    expect(findUnverifiedNumbers("1,560.4 points on the season", SOURCE)).toEqual([]);
    expect(findUnverifiedNumbers("1,999.9 points on the season", SOURCE)).toEqual(["1,999.9"]);
  });

  it("ignores small counts and years", () => {
    expect(findUnverifiedNumbers("Third loss in 4 weeks, worst since 2019.", SOURCE)).toEqual([]);
  });
});

describe("toOneDecimal", () => {
  it("rounds scores and margins to one decimal", () => {
    expect(toOneDecimal("Won 125.34-115.08, a 10.26-point margin.")).toBe("Won 125.3-115.1, a 10.3-point margin.");
  });

  it("leaves one-decimal figures, integers and records alone", () => {
    const text = "125.3 points, a 3-24 all-play, 85.8% efficiency, 1,891 points.";
    expect(toOneDecimal(text)).toBe(text);
  });

  it("keeps precision that would otherwise round to zero", () => {
    expect(toOneDecimal("won by 0.04")).toBe("won by 0.04");
  });
});

describe("findHardRuleBreaches", () => {
  it("flags sexual language and naming the group chat", () => {
    expect(findHardRuleBreaches("Redemption porn, a perfect Group Chat screenshot.", SOURCE)).toEqual(["porn", "Group Chat"]);
  });

  it("passes ordinary trash talk", () => {
    expect(findHardRuleBreaches("A boring-ass win, tough shit, a strip of bacon, the drapes.", SOURCE)).toEqual([]);
  });

  it("allows a phrase the league itself uses, such as a team name", () => {
    expect(findHardRuleBreaches("The Group Chat Legends won again.", `${SOURCE} "teamName":"The Group Chat Legends"`)).toEqual([]);
  });
});
