import { describe, expect, it } from "vitest";
import { replacementLevels, replacementSummary } from "./position-value";
import { computeDraftReturns } from "./draft-returns";

/** A ten-team pool: QBs score a lot but are deep; RBs fall off a cliff. */
function pool() {
  const players = [];
  for (let i = 0; i < 20; i += 1) players.push({ position: "QB", points: (24 - i * 0.4) * 10, games: 10 });
  for (let i = 0; i < 40; i += 1) players.push({ position: "RB", points: (24 - i * 0.55) * 10, games: 10 });
  return players;
}

describe("replacement levels (the Trade Tribunal's line)", () => {
  it("sets the line at the first player outside the startable pool", () => {
    const levels = replacementLevels(pool(), 10);
    // 10 teams × 1 QB -> the 11th QB (24 - 10 × 0.4 = 20.0).
    expect(levels.QB.replacementPpg).toBeCloseTo(20, 5);
    // 10 × (2 RB + 1/3 flex) = 23 startable -> the 24th RB (24 - 23 × 0.55 = 11.35).
    expect(levels.RB.replacementPpg).toBeCloseTo(11.35, 5);
    expect(replacementSummary(levels)).toBe("QB 20.0 · RB 11.3");
  });

  it("ignores players with fewer than three games", () => {
    const levels = replacementLevels([...pool(), { position: "QB", points: 90, games: 2 }], 10);
    expect(levels.QB.sampleSize).toBe(20);
  });
});

describe("draft returns, position-adjusted", () => {
  // Nov 2026: Gibbs (RB, pick 1, 23.2 ppg) read as a bust and Nix (QB, pick 163) as the steal.
  const teams = [
    {
      fantasyTeamId: "a",
      managerId: "a",
      managerName: "A",
      picks: [
        { overallPickNumber: 1, round: 1, isKeeper: false, playerId: "gibbs", playerName: "Gibbs", totalPoints: 232, gamesPlayed: 10, position: "RB" },
        { overallPickNumber: 3, round: 1, isKeeper: false, playerId: "qb1", playerName: "QB One", totalPoints: 240, gamesPlayed: 10, position: "QB" },
      ],
    },
    {
      fantasyTeamId: "b",
      managerId: "b",
      managerName: "B",
      picks: [
        { overallPickNumber: 2, round: 1, isKeeper: false, playerId: "qb2", playerName: "QB Two", totalPoints: 245, gamesPlayed: 10, position: "QB" },
        { overallPickNumber: 163, round: 17, isKeeper: false, playerId: "nix", playerName: "Nix", totalPoints: 250, gamesPlayed: 10, position: "QB" },
      ],
    },
  ];

  it("raw points call the elite RB a bust", () => {
    const raw = computeDraftReturns(teams);
    const gibbs = raw.teams.flatMap((t) => [...t.bestPicks, ...t.worstPicks]).find((p) => p.playerName === "Gibbs");
    expect(gibbs?.valueDelta).toBeLessThan(0);
  });

  it("above replacement, the elite RB holds his slot and the QB edge shrinks", () => {
    const adjusted = computeDraftReturns(teams, 9, { QB: 20, RB: 11.35 });
    const all = adjusted.teams.flatMap((t) => [...t.bestPicks, ...t.worstPicks]);
    const gibbs = all.find((p) => p.playerName === "Gibbs");
    expect(gibbs?.valueDelta).toBe(0);
    expect(gibbs?.aboveReplacement).toBeCloseTo(11.9, 1);
    const nix = all.find((p) => p.playerName === "Nix");
    expect(nix?.aboveReplacement).toBeCloseTo(5, 1);
  });
});
