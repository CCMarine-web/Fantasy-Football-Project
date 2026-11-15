import { describe, expect, it } from "vitest";
import { recencyStats, simulatePlayoffOdds, type OddsTeam } from "./playoff-odds";

function team(id: string, wins: number, losses: number, avg: number): OddsTeam {
  return { id, name: id, wins, losses, ties: 0, pointsFor: avg * (wins + losses), pointsAgainst: 0, scores: Array(wins + losses).fill(avg) };
}

describe("simulatePlayoffOdds", () => {
  const teams = [team("a", 8, 1, 150), team("b", 7, 2, 130), team("c", 5, 4, 120), team("d", 4, 5, 115), team("e", 0, 9, 90)];
  const remaining = [
    { a: "a", b: "e" },
    { a: "b", b: "c" },
    { a: "d", b: "e" },
  ];

  it("is deterministic for the same seed", () => {
    const x = simulatePlayoffOdds({ teams, remaining, playoffTeams: 3, sims: 2000, seed: 7 });
    const y = simulatePlayoffOdds({ teams, remaining, playoffTeams: 3, sims: 2000, seed: 7 });
    expect([...x.values()]).toEqual([...y.values()]);
  });

  it("gives probabilities that add up across the league", () => {
    const odds = simulatePlayoffOdds({ teams, remaining, playoffTeams: 3, sims: 4000 });
    const sum = (k: "playoffPct" | "titlePct" | "lastPct") => [...odds.values()].reduce((s, o) => s + o[k], 0);
    expect(sum("playoffPct")).toBeCloseTo(300, 5);
    expect(sum("titlePct")).toBeCloseTo(100, 5);
    expect(sum("lastPct")).toBeCloseTo(100, 5);
  });

  it("marks clinched and eliminated exactly, not from the simulation", () => {
    const odds = simulatePlayoffOdds({ teams, remaining, playoffTeams: 3, sims: 500 });
    expect(odds.get("a")?.clinched).toBe(true); // 8 wins; only b (max 8) can reach it
    expect(odds.get("e")?.eliminated).toBe(true); // max 2 wins; a, b, c all have more
    expect(odds.get("d")?.clinched).toBe(false);
    expect(odds.get("d")?.eliminated).toBe(false);
    expect(odds.get("a")!.playoffPct).toBe(100);
    expect(odds.get("e")!.playoffPct).toBe(0);
  });

  it("weights recent weeks more heavily", () => {
    const s = recencyStats([80, 80, 80, 140, 140, 140], 110, 20);
    expect(s.mean).toBeGreaterThan(110);
  });
});
