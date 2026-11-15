import { describe, expect, it } from "vitest";
import { lineupDecisions, type DecisionPlayer } from "./lineup-decisions";
import { windowFor } from "@/server/nfl-games";

const p = (id: string, position: string, points: number, slot: string, isStarter = slot !== "BN"): DecisionPlayer => ({ id, name: id, position, points, isStarter, slot });

describe("lineupDecisions", () => {
  it("names the costly start: Waddle (3.2) over Charbonnet (9.6) = -6.4", () => {
    const d = lineupDecisions([
      p("Walker", "RB", 36.3, "RB"),
      p("Chase", "WR", 31.5, "WR"),
      p("Waddle", "WR", 3.2, "FLEX"),
      p("Charbonnet", "RB", 9.6, "BN"),
      p("Benchwarmer", "WR", 1, "BN"),
    ]);
    expect(d.mistakes).toEqual([
      { started: expect.objectContaining({ id: "Waddle" }), benched: expect.objectContaining({ id: "Charbonnet" }), cost: 6.4 },
    ]);
    expect(d.leftOnBench).toBe(6.4);
  });

  it("respects positions: a bench QB can't replace a starting RB", () => {
    const d = lineupDecisions([p("QB1", "QB", 10, "QB"), p("RB1", "RB", 2, "RB"), p("QB2", "QB", 30, "BN")]);
    expect(d.best).toBe(30 + 2);
    expect(d.mistakes.map((m) => m.started.id)).toEqual(["QB1"]);
  });

  it("reports nothing for a perfect lineup", () => {
    expect(lineupDecisions([p("a", "RB", 20, "RB"), p("b", "RB", 5, "BN")]).mistakes).toEqual([]);
  });
});

describe("windowFor", () => {
  it("buckets kickoffs into the TV windows", () => {
    expect(windowFor("Thursday", "20:15")).toBe("TNF");
    expect(windowFor("Sunday", "09:30")).toBe("Sun early");
    expect(windowFor("Sunday", "13:00")).toBe("Sun early");
    expect(windowFor("Sunday", "16:25")).toBe("Sun late");
    expect(windowFor("Sunday", "20:20")).toBe("SNF");
    expect(windowFor("Monday", "20:15")).toBe("MNF");
  });
});
