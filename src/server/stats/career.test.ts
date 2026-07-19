import { describe, expect, it } from "vitest";
import {
  careerSummary,
  closestGame,
  filterBySegment,
  highestScoreInLoss,
  highestWeeklyScore,
  largestMarginOfVictory,
  longestLosingStreak,
  longestWinningStreak,
  lowestScoreInWin,
  lowestWeeklyScore,
  record,
  totalPointsAgainst,
  totalPointsFor,
  winningPercentage,
} from "./career";
import type { GameResult } from "./types";

function game(overrides: Partial<GameResult>): GameResult {
  return {
    week: 1,
    season: 2023,
    isPlayoff: false,
    pointsFor: 100,
    pointsAgainst: 90,
    opponentId: "opp",
    result: "W",
    ...overrides,
  };
}

describe("career stats", () => {
  it("returns zeroed values for an empty game log", () => {
    expect(record([])).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(winningPercentage([])).toBe(0);
    expect(totalPointsFor([])).toBe(0);
    expect(totalPointsAgainst([])).toBe(0);
    expect(longestWinningStreak([])).toBe(0);
    expect(longestLosingStreak([])).toBe(0);
    expect(highestWeeklyScore([])).toBeNull();
    expect(lowestWeeklyScore([])).toBeNull();
    expect(largestMarginOfVictory([])).toBeNull();
    expect(closestGame([])).toBeNull();
    expect(highestScoreInLoss([])).toBeNull();
    expect(lowestScoreInWin([])).toBeNull();
  });

  it("tallies wins, losses, and ties", () => {
    const games = [
      game({ week: 1, result: "W" }),
      game({ week: 2, result: "L" }),
      game({ week: 3, result: "T" }),
      game({ week: 4, result: "W" }),
    ];
    expect(record(games)).toEqual({ wins: 2, losses: 1, ties: 1 });
  });

  it("computes winning percentage counting ties as half a win", () => {
    const games = [
      game({ week: 1, result: "W" }),
      game({ week: 2, result: "L" }),
      game({ week: 3, result: "T" }),
      game({ week: 4, result: "T" }),
    ];
    // (1 win + 0.5*2 ties) / 4 games = 0.5
    expect(winningPercentage(games)).toBe(0.5);
  });

  it("treats a log that is all ties as a 0.5 winning percentage with no streaks", () => {
    const games = [game({ week: 1, result: "T" }), game({ week: 2, result: "T" })];
    expect(winningPercentage(games)).toBe(0.5);
    expect(longestWinningStreak(games)).toBe(0);
    expect(longestLosingStreak(games)).toBe(0);
  });

  it("sums points for and against", () => {
    const games = [
      game({ week: 1, pointsFor: 100, pointsAgainst: 90 }),
      game({ week: 2, pointsFor: 80, pointsAgainst: 120 }),
    ];
    expect(totalPointsFor(games)).toBe(180);
    expect(totalPointsAgainst(games)).toBe(210);
  });

  it("computes the longest winning streak, treating ties as breaking the streak", () => {
    const games = [
      game({ week: 1, result: "W" }),
      game({ week: 2, result: "W" }),
      game({ week: 3, result: "T" }),
      game({ week: 4, result: "W" }),
      game({ week: 5, result: "W" }),
      game({ week: 6, result: "W" }),
    ];
    expect(longestWinningStreak(games)).toBe(3);
  });

  it("computes the longest losing streak, treating ties as breaking the streak", () => {
    const games = [
      game({ week: 1, result: "L" }),
      game({ week: 2, result: "L" }),
      game({ week: 3, result: "T" }),
      game({ week: 4, result: "L" }),
    ];
    expect(longestLosingStreak(games)).toBe(2);
  });

  it("computes streaks correctly regardless of input order (sorts chronologically internally)", () => {
    const games = [
      game({ week: 3, season: 2023, result: "W" }),
      game({ week: 1, season: 2023, result: "W" }),
      game({ week: 2, season: 2023, result: "W" }),
    ];
    expect(longestWinningStreak(games)).toBe(3);
  });

  it("handles a single-game history", () => {
    const games = [game({ week: 1, result: "W", pointsFor: 120, pointsAgainst: 100 })];
    expect(record(games)).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(highestWeeklyScore(games)).toBe(120);
    expect(lowestWeeklyScore(games)).toBe(120);
    expect(longestWinningStreak(games)).toBe(1);
    expect(largestMarginOfVictory(games)).toBe(20);
    expect(closestGame(games)).toEqual(games[0]);
  });

  it("finds highest and lowest weekly scores", () => {
    const games = [
      game({ week: 1, pointsFor: 75 }),
      game({ week: 2, pointsFor: 150 }),
      game({ week: 3, pointsFor: 100 }),
    ];
    expect(highestWeeklyScore(games)).toBe(150);
    expect(lowestWeeklyScore(games)).toBe(75);
  });

  it("finds the largest margin of victory among wins only", () => {
    const games = [
      game({ week: 1, result: "W", pointsFor: 150, pointsAgainst: 100 }),
      game({ week: 2, result: "L", pointsFor: 90, pointsAgainst: 200 }),
      game({ week: 3, result: "W", pointsFor: 110, pointsAgainst: 108 }),
    ];
    expect(largestMarginOfVictory(games)).toBe(50);
  });

  it("returns null largest margin of victory when there are no wins", () => {
    const games = [game({ week: 1, result: "L" }), game({ week: 2, result: "T" })];
    expect(largestMarginOfVictory(games)).toBeNull();
  });

  it("finds the closest decided game, excluding ties", () => {
    const games = [
      game({ week: 1, result: "W", pointsFor: 130, pointsAgainst: 100 }),
      game({ week: 2, result: "L", pointsFor: 99, pointsAgainst: 100 }),
      game({ week: 3, result: "T", pointsFor: 100, pointsAgainst: 100 }),
    ];
    expect(closestGame(games)?.week).toBe(2);
  });

  it("finds the highest score in a loss and lowest score in a win", () => {
    const games = [
      game({ week: 1, result: "L", pointsFor: 140, pointsAgainst: 141 }),
      game({ week: 2, result: "L", pointsFor: 90, pointsAgainst: 200 }),
      game({ week: 3, result: "W", pointsFor: 95, pointsAgainst: 90 }),
      game({ week: 4, result: "W", pointsFor: 160, pointsAgainst: 100 }),
    ];
    expect(highestScoreInLoss(games)).toBe(140);
    expect(lowestScoreInWin(games)).toBe(95);
  });

  it("filters by regular season vs playoffs", () => {
    const games = [
      game({ week: 1, isPlayoff: false, result: "W" }),
      game({ week: 15, isPlayoff: true, result: "L" }),
      game({ week: 16, isPlayoff: true, result: "W" }),
    ];
    expect(filterBySegment(games, "regularSeason")).toHaveLength(1);
    expect(filterBySegment(games, "playoffs")).toHaveLength(2);
    expect(filterBySegment(games, "all")).toHaveLength(3);
    expect(filterBySegment(games)).toHaveLength(3);

    expect(record(games, "regularSeason")).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(record(games, "playoffs")).toEqual({ wins: 1, losses: 1, ties: 0 });
  });

  it("bundles every stat into careerSummary for a given segment", () => {
    const games = [
      game({ week: 1, isPlayoff: false, result: "W", pointsFor: 120, pointsAgainst: 100 }),
      game({ week: 2, isPlayoff: false, result: "L", pointsFor: 90, pointsAgainst: 110 }),
    ];
    const summary = careerSummary(games, "regularSeason");
    expect(summary.record).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(summary.winningPercentage).toBe(0.5);
    expect(summary.totalPointsFor).toBe(210);
    expect(summary.totalPointsAgainst).toBe(210);
    expect(summary.highestWeeklyScore).toBe(120);
    expect(summary.lowestWeeklyScore).toBe(90);
    expect(summary.largestMarginOfVictory).toBe(20);
    expect(summary.highestScoreInLoss).toBe(90);
    expect(summary.lowestScoreInWin).toBe(120);
    expect(summary.closestGame).not.toBeNull();
  });

  it("returns an empty summary safely for an empty career", () => {
    const summary = careerSummary([]);
    expect(summary.record).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(summary.winningPercentage).toBe(0);
    expect(summary.highestWeeklyScore).toBeNull();
    expect(summary.closestGame).toBeNull();
  });
});
