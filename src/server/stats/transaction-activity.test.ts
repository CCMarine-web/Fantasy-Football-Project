import { describe, expect, it } from "vitest";
import { activityGrid, pickupStint } from "./transaction-activity";

describe("activityGrid", () => {
  it("counts each move once per manager per week, split by type", () => {
    const grid = activityGrid([
      { week: 3, type: "WAIVER", managerIds: ["a"] },
      { week: 3, type: "FREE_AGENT", managerIds: ["a", "a"] },
      { week: 3, type: "TRADE", managerIds: ["a", "b"] },
      { week: 4, type: "WAIVER", managerIds: ["b"] },
      { week: null, type: "COMMISSIONER", managerIds: ["a"] },
    ]);
    expect(grid.get("a|3")).toEqual({ total: 3, byType: { WAIVER: 1, FREE_AGENT: 1, TRADE: 1 } });
    expect(grid.get("b|3")).toEqual({ total: 1, byType: { TRADE: 1 } });
    expect(grid.get("b|4")?.total).toBe(1);
    expect(grid.size).toBe(3);
  });
});

describe("pickupStint", () => {
  const teamWeeks = [1, 2, 3, 4, 5, 6, 7, 8];

  it("sums starter points from the add week until he leaves the roster", () => {
    const s = pickupStint(3, teamWeeks, [
      { week: 3, isStarter: true, points: 10 },
      { week: 4, isStarter: false, points: 30 },
      { week: 5, isStarter: true, points: 12.5 },
      // gone in week 6; a later re-add is a different stint
      { week: 8, isStarter: true, points: 40 },
    ]);
    expect(s).toEqual({ startWeek: 3, endWeek: 5, weeksOnRoster: 3, startedWeeks: 2, starterPoints: 22.5 });
  });

  it("starts the week after when the add cleared after kickoff", () => {
    const s = pickupStint(3, teamWeeks, [{ week: 4, isStarter: true, points: 8 }]);
    expect(s.startWeek).toBe(4);
    expect(s.starterPoints).toBe(8);
  });

  it("is empty when he never appears on the roster", () => {
    const s = pickupStint(3, teamWeeks, [{ week: 7, isStarter: true, points: 20 }]);
    expect(s).toEqual({ startWeek: null, endWeek: null, weeksOnRoster: 0, startedWeeks: 0, starterPoints: 0 });
  });

  it("ignores rows before the add and starts with a null score", () => {
    const s = pickupStint(5, teamWeeks, [
      { week: 2, isStarter: true, points: 50 },
      { week: 5, isStarter: true, points: null },
      { week: 6, isStarter: true, points: 9 },
    ]);
    expect(s).toMatchObject({ startWeek: 5, endWeek: 6, startedWeeks: 1, starterPoints: 9 });
  });
});
