import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PowerGrid } from "./power-grid";
import type { PowerRankingView } from "@/server/repositories/power-rankings-repository";

const weights = ["scoring", "allPlay", "recentForm"].map((key) => ({ key, label: key, description: "", weight: 1 / 3 }));

function row(i: number): PowerRankingView {
  return {
    rank: i + 1,
    previousRank: i === 0 ? 2 : i + 1,
    fantasyTeamId: `t${i}`,
    managerId: `m${i}`,
    managerName: `Manager ${i}`,
    teamName: `Team ${i}`,
    score: 90 - i,
    weightedPointsPerGame: 130,
    allPlayWins: 10,
    allPlayLosses: 5,
    allPlayTies: 0,
    allPlayPct: 0.6,
    expectedWins: 5,
    actualWins: 5,
    luck: 0,
    lineupEfficiency: 0.9,
    factors: weights.map((w, j) => ({ key: w.key as never, label: w.label, value: 10 * (i + j), weight: w.weight, raw: `${w.key} raw` })),
    avatarUrl: null,
    record: "5-4",
    blurb: null,
  };
}

describe("PowerGrid", () => {
  it("has exactly one header cell per body cell (no shifted columns)", () => {
    render(<PowerGrid rows={[row(0), row(1)]} weights={weights} percents={[34, 33, 33]} luck={{}} blurbs={{}} />);
    const header = screen.getByTestId("power-grid-header");
    const rows = screen.getAllByTestId("power-grid-row");
    expect(header.children.length).toBe(4 + weights.length);
    for (const r of rows) expect(r.children.length).toBe(header.children.length);
    // No header cell may be taken out of the grid flow.
    for (const cell of Array.from(header.children)) expect(cell.className).not.toContain("sr-only");
  });

  it("puts each factor value under its own header", () => {
    render(<PowerGrid rows={[row(1)]} weights={weights} percents={[34, 33, 33]} luck={{}} blurbs={{}} />);
    const header = screen.getByTestId("power-grid-header");
    const r = screen.getByTestId("power-grid-row");
    weights.forEach((w, j) => {
      expect(header.children[4 + j].textContent).toContain(w.key);
      expect(r.children[4 + j].getAttribute("title")).toContain(`${w.key}:`);
    });
  });
});
