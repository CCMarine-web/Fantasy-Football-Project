import { describe, expect, it } from "vitest";
import { optimalLineupPoints } from "./optimal-lineup";

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF"];

describe("optimalLineupPoints", () => {
  it("never starts two quarterbacks in a one-QB lineup", () => {
    const players = [
      { position: "QB", points: 30 },
      { position: "QB", points: 28 }, // the old top-N method started this one too
      { position: "RB", points: 10 },
      { position: "RB", points: 9 },
      { position: "WR", points: 8 },
      { position: "WR", points: 7 },
      { position: "TE", points: 6 },
      { position: "RB", points: 5 },
      { position: "WR", points: 4 },
      { position: "K", points: 3 },
      { position: "DEF", points: 2 },
    ];
    // QB 30 + RB 10, 9 + WR 8, 7 + TE 6 + FLEX 5, 4 + K 3 + DEF 2 = 84
    expect(optimalLineupPoints(SLOTS, players)).toBe(84);
  });

  it("fills flex from the best remaining eligible players", () => {
    const players = [
      { position: "QB", points: 20 },
      { position: "RB", points: 25 },
      { position: "RB", points: 22 },
      { position: "RB", points: 21 },
      { position: "WR", points: 19 },
      { position: "WR", points: 18 },
      { position: "TE", points: 17 },
      { position: "TE", points: 16 },
      { position: "K", points: 9 },
      { position: "D/ST", points: 8 },
    ];
    // Flex takes RB 21 and TE 16; the defence is matched despite "D/ST".
    expect(optimalLineupPoints(SLOTS, players)).toBe(20 + 25 + 22 + 19 + 18 + 17 + 21 + 16 + 9 + 8);
  });

  it("leaves a slot empty rather than filling it illegally", () => {
    expect(optimalLineupPoints(["QB", "K"], [{ position: "QB", points: 20 }, { position: "WR", points: 30 }])).toBe(20);
  });

  it("treats a plain-position slot list as fixed slots", () => {
    expect(optimalLineupPoints(["RB", "WR"], [{ position: "RB", points: 5 }, { position: "RB", points: 9 }, { position: "WR", points: 1 }])).toBe(10);
  });
});
