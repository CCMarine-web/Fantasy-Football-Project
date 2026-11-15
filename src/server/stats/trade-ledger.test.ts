import { describe, expect, it } from "vitest";
import { buildValueTimeline, tradeLedger, tradePartnerGrid, type TimelineSide } from "./trade-ledger";
import { valuePlayer, type PositionContext } from "./trade-value";

const contexts = new Map<string, PositionContext>([
  ["RB", { position: "RB", replacementPpg: 10, scarcity: 1.5, sampleSize: 30 }],
  ["QB", { position: "QB", replacementPpg: 18, scarcity: 1.2, sampleSize: 12 }],
]);

const sides: TimelineSide[] = [
  {
    managerId: "a",
    consolidationCredit: 4,
    players: [
      {
        playerId: "rb1",
        name: "Back One",
        position: "RB",
        weekly: [
          { week: 5, points: 20 },
          { week: 6, points: 4 },
          { week: 8, points: 25 },
          { week: 15, points: 30 },
        ],
      },
    ],
  },
  {
    managerId: "b",
    consolidationCredit: 0,
    players: [
      { playerId: "qb1", name: "Arm One", position: "QB", weekly: [{ week: 6, points: 22 }, { week: 7, points: 12 }] },
      { playerId: "rb2", name: "Back Two", position: "RB", weekly: [] },
    ],
  },
];

describe("buildValueTimeline", () => {
  const weeks = [5, 6, 7, 8, 15];
  const tl = buildValueTimeline({ sides, weeks, contexts, playoffStart: 15, weeksRemaining: 11 });

  it("returns one point per week with a value for every side", () => {
    expect(tl.map((p) => p.week)).toEqual(weeks);
    for (const p of tl) expect(Object.keys(p.values).sort()).toEqual(["a", "b"]);
  });

  it("ends exactly on the full-window valuation plus the consolidation credit", () => {
    const full = valuePlayer(
      { playerId: "rb1", name: "Back One", position: "RB", gamesPlayed: 4, points: 79, playoffPoints: 30, playoffGames: 1, weeksRemaining: 11 },
      contexts.get("RB"),
      null,
    ).value;
    expect(tl.at(-1)!.values.a).toBe(Number((full + 4).toFixed(1)));
    const qb = valuePlayer(
      { playerId: "qb1", name: "Arm One", position: "QB", gamesPlayed: 2, points: 34, playoffPoints: 0, playoffGames: 0, weeksRemaining: 11 },
      contexts.get("QB"),
      null,
    ).value;
    expect(tl.at(-1)!.values.b).toBe(qb);
  });

  it("banks the consolidation credit from the first week and floors below-replacement windows at zero", () => {
    // Week 5: 20 pts in one game, (20-10)*1.5 = 15, + 4 credit.
    expect(tl[0].values.a).toBe(19);
    // Week 5, side b has no games yet.
    expect(tl[0].values.b).toBe(0);
    // Week 6: 24 in 2 games, (12-10)*2*1.5 = 6, + 4.
    expect(tl[1].values.a).toBe(10);
    // QB at week 6: 22-18 = 4 * 1.2 = 4.8; week 7: 34/2=17 < 18 -> floored at 0.
    expect(tl[1].values.b).toBe(4.8);
    expect(tl[2].values.b).toBe(0);
  });
});

describe("tradeLedger", () => {
  it("nets value received against value given, per manager", () => {
    const ledger = tradeLedger([
      { sides: [{ managerId: "a", value: 50 }, { managerId: "b", value: 10 }] },
      { sides: [{ managerId: "b", value: 30 }, { managerId: "c", value: 5 }] },
    ]);
    const by = new Map(ledger.map((e) => [e.managerId, e]));
    expect(by.get("a")).toMatchObject({ trades: 1, received: 50, given: 10, net: 40 });
    expect(by.get("b")).toMatchObject({ trades: 2, received: 40, given: 55, net: -15 });
    expect(by.get("c")).toMatchObject({ trades: 1, net: -25 });
    // Sorted best to worst.
    expect(ledger.map((e) => e.managerId)).toEqual(["a", "b", "c"]);
    // Zero-sum across the league.
    expect(ledger.reduce((s, e) => s + e.net, 0)).toBeCloseTo(0);
  });

  it("skips trades that are not two-sided", () => {
    expect(tradeLedger([{ sides: [{ managerId: "a", value: 5 }] }])).toEqual([]);
  });
});

describe("tradePartnerGrid", () => {
  it("counts trades per pair symmetrically, with the row manager's net", () => {
    const grid = tradePartnerGrid([
      { sides: [{ managerId: "a", value: 50 }, { managerId: "b", value: 10 }] },
      { sides: [{ managerId: "b", value: 30 }, { managerId: "a", value: 5 }] },
    ]);
    expect(grid.get("a|b")).toEqual({ trades: 2, net: 15 });
    expect(grid.get("b|a")).toEqual({ trades: 2, net: -15 });
    expect(grid.get("a|a")).toBeUndefined();
  });
});
