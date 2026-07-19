import { describe, expect, it } from "vitest";
import { computeEloRatings } from "./elo";
import type { EloGame } from "./types";

describe("Elo ratings", () => {
  it("returns an empty rating list for no games", () => {
    expect(computeEloRatings([])).toEqual([]);
  });

  it("updates ratings for a single decisive game using the default starting rating and K-factor", () => {
    const games: EloGame[] = [{ week: 1, teamAId: "A", teamBId: "B", teamAScore: 120, teamBScore: 100 }];
    const ratings = computeEloRatings(games);
    const byId = Object.fromEntries(ratings.map((r) => [r.teamId, r.rating]));
    // expectedA = 1 / (1 + 10^((1500-1500)/400)) = 0.5; newA = 1500 + 32*(1-0.5) = 1516
    expect(byId["A"]).toBeCloseTo(1516);
    // newB = 1500 + 32*(0-0.5) = 1484
    expect(byId["B"]).toBeCloseTo(1484);
  });

  it("leaves both ratings equal after a tie between equally-rated teams", () => {
    const games: EloGame[] = [{ week: 1, teamAId: "A", teamBId: "B", teamAScore: 100, teamBScore: 100 }];
    const ratings = computeEloRatings(games);
    const byId = Object.fromEntries(ratings.map((r) => [r.teamId, r.rating]));
    expect(byId["A"]).toBeCloseTo(1500);
    expect(byId["B"]).toBeCloseTo(1500);
  });

  it("respects a custom starting rating and K-factor", () => {
    const games: EloGame[] = [{ week: 1, teamAId: "A", teamBId: "B", teamAScore: 100, teamBScore: 50 }];
    const ratings = computeEloRatings(games, { startingRating: 1000, kFactor: 16 });
    const byId = Object.fromEntries(ratings.map((r) => [r.teamId, r.rating]));
    // expectedA = 0.5 at equal starting ratings; newA = 1000 + 16*(1-0.5) = 1008
    expect(byId["A"]).toBeCloseTo(1008);
    expect(byId["B"]).toBeCloseTo(992);
  });

  it("gives a bigger rating boost to an upset winner than to a favorite winning again", () => {
    // A is already the underdog (lower rating) heading into this game.
    const games: EloGame[] = [
      { week: 1, teamAId: "A", teamBId: "B", teamAScore: 80, teamBScore: 100 }, // B favored to win, does win
      { week: 2, teamAId: "A", teamBId: "C", teamAScore: 120, teamBScore: 100 }, // fresh matchup, A now underdog vs C
    ];
    const ratings = computeEloRatings(games);
    const byId = Object.fromEntries(ratings.map((r) => [r.teamId, r.rating]));
    // A lost to B (now below 1500) then beat C (who is still at the 1500 starting rating) as the underdog,
    // so A's upset win against C should gain more than 16 points (half of K=32).
    expect(byId["A"] - 1484).toBeGreaterThan(16);
  });

  it("processes games in chronological (week) order regardless of input array order", () => {
    const chronological: EloGame[] = [
      { week: 1, teamAId: "A", teamBId: "B", teamAScore: 90, teamBScore: 100 },
      { week: 2, teamAId: "A", teamBId: "B", teamAScore: 110, teamBScore: 100 },
    ];
    const reversed = [...chronological].reverse();

    expect(computeEloRatings(reversed)).toEqual(computeEloRatings(chronological));
  });

  it("sorts by season then week when season is provided", () => {
    const games: EloGame[] = [
      { week: 1, season: 2024, teamAId: "A", teamBId: "B", teamAScore: 110, teamBScore: 100 },
      { week: 1, season: 2023, teamAId: "A", teamBId: "B", teamAScore: 90, teamBScore: 100 },
    ];
    const sortedEquivalent: EloGame[] = [
      { week: 1, season: 2023, teamAId: "A", teamBId: "B", teamAScore: 90, teamBScore: 100 },
      { week: 1, season: 2024, teamAId: "A", teamBId: "B", teamAScore: 110, teamBScore: 100 },
    ];
    expect(computeEloRatings(games)).toEqual(computeEloRatings(sortedEquivalent));
  });

  it("tracks multiple teams independently across a small round-robin", () => {
    const games: EloGame[] = [
      { week: 1, teamAId: "A", teamBId: "B", teamAScore: 100, teamBScore: 90 },
      { week: 1, teamAId: "C", teamBId: "D", teamAScore: 80, teamBScore: 95 },
      { week: 2, teamAId: "A", teamBId: "C", teamAScore: 100, teamBScore: 100 },
    ];
    const ratings = computeEloRatings(games);
    expect(ratings).toHaveLength(4);
    const ids = ratings.map((r) => r.teamId).sort();
    expect(ids).toEqual(["A", "B", "C", "D"]);
  });
});
