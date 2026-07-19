import { describe, expect, it } from "vitest";
import { closestMeeting, currentStreak, headToHeadRecord, largestBlowout, playoffMeetingCount } from "./head-to-head";
import type { GameResult } from "./types";

function game(overrides: Partial<GameResult>): GameResult {
  return {
    week: 1,
    season: 2023,
    isPlayoff: false,
    pointsFor: 100,
    pointsAgainst: 90,
    opponentId: "rival",
    result: "W",
    ...overrides,
  };
}

describe("head-to-head stats", () => {
  it("returns empty/default values for no shared history", () => {
    expect(headToHeadRecord([])).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(playoffMeetingCount([])).toBe(0);
    expect(closestMeeting([])).toBeNull();
    expect(largestBlowout([])).toBeNull();
    expect(currentStreak([])).toEqual({ winner: null, length: 0 });
  });

  it("tallies the head-to-head record from one manager's perspective", () => {
    const games = [
      game({ week: 1, result: "W" }),
      game({ week: 2, result: "L" }),
      game({ week: 3, result: "T" }),
    ];
    expect(headToHeadRecord(games)).toEqual({ wins: 1, losses: 1, ties: 1 });
  });

  it("counts only playoff meetings", () => {
    const games = [
      game({ week: 1, isPlayoff: false }),
      game({ week: 15, isPlayoff: true }),
      game({ week: 16, isPlayoff: true }),
    ];
    expect(playoffMeetingCount(games)).toBe(2);
  });

  it("finds the closest meeting, excluding ties", () => {
    const games = [
      game({ week: 1, result: "W", pointsFor: 150, pointsAgainst: 100 }),
      game({ week: 2, result: "L", pointsFor: 99, pointsAgainst: 100 }),
      game({ week: 3, result: "T", pointsFor: 100, pointsAgainst: 100 }),
    ];
    expect(closestMeeting(games)?.week).toBe(2);
  });

  it("finds the largest blowout among decided meetings", () => {
    const games = [
      game({ week: 1, result: "W", pointsFor: 150, pointsAgainst: 100 }),
      game({ week: 2, result: "L", pointsFor: 80, pointsAgainst: 220 }),
    ];
    expect(largestBlowout(games)?.week).toBe(2);
  });

  it("handles a single-game history for streak and blowout", () => {
    const games = [game({ week: 1, result: "W", pointsFor: 120, pointsAgainst: 100 })];
    expect(currentStreak(games)).toEqual({ winner: "self", length: 1 });
    expect(largestBlowout(games)?.week).toBe(1);
    expect(closestMeeting(games)?.week).toBe(1);
  });

  it("computes the current streak for the perspective manager", () => {
    const games = [
      game({ week: 1, result: "L" }),
      game({ week: 2, result: "W" }),
      game({ week: 3, result: "W" }),
      game({ week: 4, result: "W" }),
    ];
    expect(currentStreak(games)).toEqual({ winner: "self", length: 3 });
  });

  it("computes the current streak for the opponent", () => {
    const games = [
      game({ week: 1, result: "W" }),
      game({ week: 2, result: "L" }),
      game({ week: 3, result: "L" }),
    ];
    expect(currentStreak(games)).toEqual({ winner: "opponent", length: 2 });
  });

  it("resets the streak to none when the most recent meeting was a tie", () => {
    const games = [game({ week: 1, result: "W" }), game({ week: 2, result: "W" }), game({ week: 3, result: "T" })];
    expect(currentStreak(games)).toEqual({ winner: null, length: 0 });
  });

  it("orders games chronologically regardless of input order when computing the streak", () => {
    const games = [
      game({ week: 3, season: 2023, result: "W" }),
      game({ week: 1, season: 2023, result: "L" }),
      game({ week: 2, season: 2023, result: "W" }),
    ];
    expect(currentStreak(games)).toEqual({ winner: "self", length: 2 });
  });

  it("returns null closest/blowout when all meetings are ties", () => {
    const games = [game({ week: 1, result: "T" }), game({ week: 2, result: "T" })];
    expect(closestMeeting(games)).toBeNull();
    expect(largestBlowout(games)).toBeNull();
  });
});
