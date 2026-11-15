import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { scoreStatLine } from "./projections";

describe("scoreStatLine", () => {
  it("scores a projected stat line with the league's own settings", () => {
    const scoring = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rec: 1, rec_yd: 0.1, rec_td: 6 };
    // 246.21 pass yds, 1.68 TD, 0.37 INT, 32.25 rush yds
    expect(scoreStatLine({ pass_yd: 246.21, pass_td: 1.68, pass_int: 0.37, rush_yd: 32.25, gp: 1 }, scoring)).toBeCloseTo(
      9.85 + 6.72 - 0.74 + 3.23,
      1,
    );
  });

  it("ignores stats the league doesn't score and non-numeric values", () => {
    expect(scoreStatLine({ adp_dd_ppr: 25, rec: 3 }, { rec: 0.5 })).toBe(1.5);
  });

  it("is PPR-aware purely through the settings", () => {
    const stats = { rec: 5, rec_yd: 60 };
    expect(scoreStatLine(stats, { rec: 1, rec_yd: 0.1 })).toBe(11);
    expect(scoreStatLine(stats, { rec: 0, rec_yd: 0.1 })).toBe(6);
  });
});
