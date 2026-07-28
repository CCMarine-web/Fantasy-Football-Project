import { describe, expect, it } from "vitest";
import { computeLuckScore, luckLabel, LUCK_WEIGHTS, type LeagueWeekScore, type LuckGame } from "./luck";

/**
 * A four-team league where every team scores the same amount every week, so
 * the only thing that can vary is who plays whom. Helpers below then bend one
 * variable at a time.
 */
function league(
  perManager: Record<string, number[]>,
  opts: { playoffWeeks?: number[] } = {},
): LeagueWeekScore[] {
  const rows: LeagueWeekScore[] = [];
  for (const [managerId, weeks] of Object.entries(perManager)) {
    weeks.forEach((points, i) => {
      const week = i + 1;
      rows.push({
        season: 2025,
        week,
        managerId,
        points,
        isPlayoff: opts.playoffWeeks?.includes(week) ?? false,
      });
    });
  }
  return rows;
}

function game(part: Partial<LuckGame>): LuckGame {
  return {
    season: 2025,
    week: 1,
    isPlayoff: false,
    pointsFor: 100,
    pointsAgainst: 100,
    result: "W",
    opponentId: "b",
    ...part,
  };
}

describe("luckLabel", () => {
  it("puts 50 in the neutral band and the extremes outside it", () => {
    expect(luckLabel(50)).toBe("Neutral");
    expect(luckLabel(45)).toBe("Neutral");
    expect(luckLabel(44)).toBe("Slightly unlucky");
    expect(luckLabel(56)).toBe("Slightly lucky");
    expect(luckLabel(0)).toBe("Very unlucky");
    expect(luckLabel(100)).toBe("Very lucky");
  });
});

describe("computeLuckScore", () => {
  it("weights sum to one so a fully-measured score needs no rescaling", () => {
    const total = Object.values(LUCK_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("refuses to score a season that has not started", () => {
    const result = computeLuckScore("a", [], []);
    expect(result.score).toBeNull();
    expect(result.confidence).toBe("INSUFFICIENT");
    expect(result.label).not.toMatch(/neutral/i);
    expect(result.caveat).toMatch(/No games played/);
  });

  it("refuses to score a handful of games", () => {
    const games = [game({ week: 1 }), game({ week: 2 }), game({ week: 3 })];
    const result = computeLuckScore("a", games, []);
    expect(result.score).toBeNull();
    expect(result.confidence).toBe("INSUFFICIENT");
    expect(result.caveat).toMatch(/at least 4/);
  });

  it("scores a manager whose results exactly match their scoring near neutral", () => {
    // Four identical teams, everyone scores 100 every week, all games tie.
    const scores = league({ a: Array(8).fill(100), b: Array(8).fill(100), c: Array(8).fill(100), d: Array(8).fill(100) });
    const games = Array.from({ length: 8 }, (_, i) =>
      game({ week: i + 1, pointsFor: 100, pointsAgainst: 100, result: "T", opponentId: "b" }),
    );
    const result = computeLuckScore("a", games, scores);
    expect(result.score).toBe(50);
    expect(result.label).toBe("Neutral");
  });

  it("is deterministic", () => {
    const scores = league({ a: [120, 90, 110, 95, 130, 85], b: [100, 100, 100, 100, 100, 100], c: [80, 140, 70, 150, 60, 160], d: [110, 90, 120, 80, 130, 70] });
    const games = [
      game({ week: 1, pointsFor: 120, pointsAgainst: 100, result: "W" }),
      game({ week: 2, pointsFor: 90, pointsAgainst: 100, result: "L" }),
      game({ week: 3, pointsFor: 110, pointsAgainst: 80, result: "W", opponentId: "c" }),
      game({ week: 4, pointsFor: 95, pointsAgainst: 150, result: "L", opponentId: "c" }),
      game({ week: 5, pointsFor: 130, pointsAgainst: 130, result: "T", opponentId: "d" }),
      game({ week: 6, pointsFor: 85, pointsAgainst: 70, result: "W", opponentId: "d" }),
    ];
    const first = computeLuckScore("a", games, scores);
    const second = computeLuckScore("a", games, scores);
    expect(first).toEqual(second);
  });

  it("rates a team that wins more than its scoring deserves as lucky", () => {
    // "a" is the WORST scorer every week but wins every game, because it keeps
    // drawing the one team having a bad week.
    const scores = league({
      a: [80, 80, 80, 80, 80, 80],
      b: [70, 200, 200, 200, 200, 200],
      c: [200, 70, 200, 200, 200, 200],
      d: [200, 200, 70, 70, 70, 70],
    });
    const games = [
      game({ week: 1, pointsFor: 80, pointsAgainst: 70, result: "W", opponentId: "b" }),
      game({ week: 2, pointsFor: 80, pointsAgainst: 70, result: "W", opponentId: "c" }),
      game({ week: 3, pointsFor: 80, pointsAgainst: 70, result: "W", opponentId: "d" }),
      game({ week: 4, pointsFor: 80, pointsAgainst: 70, result: "W", opponentId: "d" }),
      game({ week: 5, pointsFor: 80, pointsAgainst: 70, result: "W", opponentId: "d" }),
      game({ week: 6, pointsFor: 80, pointsAgainst: 70, result: "W", opponentId: "d" }),
    ];
    const result = computeLuckScore("a", games, scores);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThan(70);
    expect(result.label).toMatch(/lucky/i);
  });

  it("rates a team that loses despite outscoring the league as unlucky", () => {
    // "a" is the BEST scorer every week but always draws whoever went nuclear.
    const scores = league({
      a: [150, 150, 150, 150, 150, 150],
      b: [180, 60, 60, 60, 60, 60],
      c: [60, 180, 60, 60, 60, 60],
      d: [60, 60, 180, 180, 180, 180],
    });
    const games = [
      game({ week: 1, pointsFor: 150, pointsAgainst: 180, result: "L", opponentId: "b" }),
      game({ week: 2, pointsFor: 150, pointsAgainst: 180, result: "L", opponentId: "c" }),
      game({ week: 3, pointsFor: 150, pointsAgainst: 180, result: "L", opponentId: "d" }),
      game({ week: 4, pointsFor: 150, pointsAgainst: 180, result: "L", opponentId: "d" }),
      game({ week: 5, pointsFor: 150, pointsAgainst: 180, result: "L", opponentId: "d" }),
      game({ week: 6, pointsFor: 150, pointsAgainst: 180, result: "L", opponentId: "d" }),
    ];
    const result = computeLuckScore("a", games, scores);
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeLessThan(30);
    expect(result.label).toMatch(/unlucky/i);
  });

  it("drops components it cannot measure and rescales the rest to sum to one", () => {
    const scores = league({ a: Array(6).fill(100), b: Array(6).fill(100), c: Array(6).fill(100), d: Array(6).fill(100) });
    // No close games and no postseason games in this log.
    const games = Array.from({ length: 6 }, (_, i) =>
      game({ week: i + 1, pointsFor: 100, pointsAgainst: 100, result: "T" }),
    );
    const result = computeLuckScore("a", games, scores);
    const postseason = result.components.find((c) => c.key === "postseasonDraw")!;
    expect(postseason.available).toBe(false);
    expect(postseason.weight).toBe(0);
    const totalWeight = result.components.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 10);
    expect(result.caveat).toMatch(/rescaled/);
  });

  it("never counts postseason games toward the games-played total", () => {
    const scores = league(
      { a: [100, 100, 100, 100, 100, 100], b: [100, 100, 100, 100, 100, 100], c: [100, 100, 100, 100, 100, 100], d: [100, 100, 100, 100, 100, 100] },
      { playoffWeeks: [5, 6] },
    );
    const games = [
      ...Array.from({ length: 4 }, (_, i) => game({ week: i + 1, result: "T" })),
      game({ week: 5, isPlayoff: true, bracket: "WINNERS", result: "W" }),
      game({ week: 6, isPlayoff: true, bracket: "CONSOLATION", result: "W" }),
    ];
    const result = computeLuckScore("a", games, scores);
    expect(result.gamesConsidered).toBe(4);
  });

  it("reports confidence from the number of games measured", () => {
    const weeks = (n: number) => Array(n).fill(100);
    const build = (n: number) => {
      const scores = league({ a: weeks(n), b: weeks(n), c: weeks(n), d: weeks(n) });
      const games = Array.from({ length: n }, (_, i) => game({ week: i + 1, result: "T" }));
      return computeLuckScore("a", games, scores).confidence;
    };
    expect(build(6)).toBe("LOW");
    expect(build(14)).toBe("MEDIUM");
    expect(build(30)).toBe("HIGH");
  });

  it("ignores consolation games when reading the postseason draw", () => {
    const scores = league(
      { a: Array(8).fill(100), b: Array(8).fill(100), c: Array(8).fill(100), d: Array(8).fill(100) },
      { playoffWeeks: [7, 8] },
    );
    const base = Array.from({ length: 6 }, (_, i) => game({ week: i + 1, result: "T" }));
    // Two consolation games where opponents cratered — should NOT read as a
    // lucky postseason draw, because the toilet bowl is not the playoffs.
    const withConsolation = [
      ...base,
      game({ week: 7, isPlayoff: true, bracket: "CONSOLATION", pointsAgainst: 20, result: "W" }),
      game({ week: 8, isPlayoff: true, bracket: "CONSOLATION", pointsAgainst: 20, result: "W" }),
    ];
    const result = computeLuckScore("a", withConsolation, scores);
    expect(result.components.find((c) => c.key === "postseasonDraw")!.available).toBe(false);
  });
});
