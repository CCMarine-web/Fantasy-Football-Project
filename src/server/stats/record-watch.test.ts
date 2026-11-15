import { describe, expect, it } from "vitest";
import { computeRecordWatch, type WatchGame } from "./record-watch";

function games(managerId: string, name: string, year: number, results: ("W" | "L")[], startWeek = 1): WatchGame[] {
  return results.map((r, i) => ({
    managerId,
    managerName: name,
    year,
    week: startWeek + i,
    isPlayoff: false,
    score: r === "W" ? 120 : 90,
    opponentScore: 100,
    opponentName: "Opp",
  }));
}

describe("computeRecordWatch", () => {
  const history = [
    ...games("javier", "Logan Javier", 2024, Array(10).fill("L")),
    ...games("bark", "Michael Barkemeyer", 2019, Array(10).fill("L")),
  ];

  it("flags Shea's 9-game losing streak as one away from the all-time 10", () => {
    const watch = computeRecordWatch({
      seasonYear: 2026,
      regularSeasonWeeks: 14,
      games: [...history, ...games("shea", "Michael Shea", 2026, Array(9).fill("L"))],
      completedSeasons: [],
      currentTeams: [],
    });
    const shea = watch.find((w) => w.kind === "LOSS_STREAK");
    expect(shea?.headline).toBe("Michael Shea has lost 9 straight");
    expect(shea?.detail).toBe("One more loss ties the all-time mark of 10 (Logan Javier & Michael Barkemeyer).");
  });

  it("ignores streaks more than two games short and streaks from finished seasons", () => {
    const watch = computeRecordWatch({
      seasonYear: 2026,
      regularSeasonWeeks: 14,
      games: [...history, ...games("x", "X", 2026, ["L", "L", "L", "L"]), ...games("y", "Y", 2025, Array(9).fill("L"))],
      completedSeasons: [],
      currentTeams: [],
    });
    expect(watch.filter((w) => w.kind === "LOSS_STREAK")).toEqual([]);
  });

  it("reports a winless team chasing the worst record against completed seasons only", () => {
    const watch = computeRecordWatch({
      seasonYear: 2026,
      regularSeasonWeeks: 14,
      games: [],
      completedSeasons: [{ managerName: "Logan Javier", year: 2024, wins: 1, losses: 13, ties: 0, pointsFor: 1460 }],
      currentTeams: [{ managerId: "shea", managerName: "Michael Shea", wins: 0, losses: 9, ties: 0, pointsFor: 1080 }],
    });
    const w = watch.find((x) => x.kind === "WORST_RECORD_PACE");
    expect(w?.headline).toBe("Michael Shea is 0-9 with 5 games left");
    expect(w?.detail).toContain("1-13 (Logan Javier, 2024)");
    expect(w?.detail).toContain("Needs 2 more wins to avoid it");
  });

  it("places a season-high score in the all-time top 10", () => {
    const g = (s: number, year = 2020): WatchGame => ({ managerId: "m", managerName: "M", year, week: 1, isPlayoff: false, score: s, opponentScore: 0, opponentName: "o" });
    const watch = computeRecordWatch({
      seasonYear: 2026,
      regularSeasonWeeks: 14,
      games: [g(200), g(190), { ...g(195, 2026), managerName: "Bark" }],
      completedSeasons: [],
      currentTeams: [],
    });
    expect(watch.find((w) => w.kind === "HIGH_GAME")?.detail).toMatch(/^2nd-highest score in league history/);
  });
});

describe("season pace (Nov 2026 audit)", () => {
  it("shows only paces that would break the record, highest pace first", () => {
    const team = (managerId: string, pointsFor: number) => ({ managerId, managerName: managerId, wins: 5, losses: 4, ties: 0, pointsFor });
    const watch = computeRecordWatch({
      seasonYear: 2026,
      regularSeasonWeeks: 14,
      games: [],
      completedSeasons: [{ managerName: "Old", year: 2023, wins: 9, losses: 5, ties: 0, pointsFor: 1971 }],
      // paces over 14 games: Jones 1943 (below the record), Barkemeyer 2043, McManus 2233
      currentTeams: [team("Jones", (1943 * 9) / 14), team("Barkemeyer", (2043 * 9) / 14), team("McManus", (2233 * 9) / 14)],
    });
    expect(watch.filter((w) => w.kind === "POINTS_PACE").map((w) => w.managerId)).toEqual(["McManus", "Barkemeyer"]);
  });
});
