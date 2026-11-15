import { describe, expect, it } from "vitest";
import { computeLuckWins, formatLuckWins, labelRank, luckLabelFromZ, weekExpected, type LuckGameRow } from "./luck-wins";

/** A random-but-seeded league: n teams, w weeks, round-robin-ish pairings. */
function league(n: number, weeks: number, seed = 1, year = 2026): LuckGameRow[] {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ids = Array.from({ length: n }, (_, i) => `m${i}`);
  const rows: LuckGameRow[] = [];
  for (let w = 1; w <= weeks; w += 1) {
    const order = [...ids].sort(() => rand() - 0.5);
    for (let i = 0; i < n; i += 2) {
      const a = order[i];
      const b = order[i + 1];
      const sa = Math.round((90 + rand() * 70) * 100) / 100;
      const sb = Math.round((90 + rand() * 70) * 100) / 100;
      rows.push({ managerId: a, opponentManagerId: b, year, week: w, isPlayoff: false, bracket: null, score: sa, opponentScore: sb, isWinner: sa === sb ? null : sa > sb });
      rows.push({ managerId: b, opponentManagerId: a, year, week: w, isPlayoff: false, bracket: null, score: sb, opponentScore: sa, isWinner: sa === sb ? null : sb > sa });
    }
  }
  return rows;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("luck in wins — league-wide invariants", () => {
  for (const [n, w, label] of [[10, 9, "2026 to date"], [10, 14, "10-team season"], [8, 13, "8-team 2017"]] as const) {
    it(`Σ luckWins = 0 and Σ expected = games (${label})`, () => {
      const rows = league(n, w, n * w);
      const luck = computeLuckWins(rows);
      expect(Math.abs(sum([...luck.values()].map((l) => l.luckWins)))).toBeLessThan(0.05);
      expect(sum([...luck.values()].map((l) => l.expected))).toBeCloseTo((n / 2) * w, 6);
    });
  }

  it("career totals also sum to zero across seasons with different team counts", () => {
    const rows = [...league(8, 13, 3, 2017), ...league(10, 14, 4, 2018), ...league(10, 14, 5, 2019)];
    const luck = computeLuckWins(rows);
    expect(Math.abs(sum([...luck.values()].map((l) => l.luckWins)))).toBeLessThan(0.05);
  });

  it("all-play wins equal all-play losses, ties counted as half", () => {
    const pool = [100, 120, 120, 90].map((score, i) => ({ managerId: String(i), score }));
    const exp = pool.map((p) => weekExpected(pool, p.score));
    // n/2 = 2 expected wins in a week of 4 teams; a tie between the 120s splits.
    expect(sum(exp)).toBeCloseTo(2, 10);
    expect(exp[1]).toBeCloseTo((2 + 0.5) / 3, 10);
  });

  it("ignores playoff, consolation and unplayed games in the regular-season number", () => {
    const rows = league(10, 9, 9);
    const before = computeLuckWins(rows).get("m0")!;
    const extra: LuckGameRow[] = [
      { managerId: "m0", opponentManagerId: "m1", year: 2026, week: 15, isPlayoff: true, bracket: "WINNERS", score: 50, opponentScore: 200, isWinner: false },
      { managerId: "m0", opponentManagerId: "m2", year: 2026, week: 16, isPlayoff: true, bracket: "CONSOLATION", score: 50, opponentScore: 200, isWinner: false },
    ];
    const after = computeLuckWins([...rows, ...extra]).get("m0")!;
    expect(after.luckWins).toBeCloseTo(before.luckWins, 10);
    expect(after.games).toBe(before.games);
    expect(after.context.playoffDraw?.games).toBe(1);
  });

  it("symmetry: swapping a matchup's two scores flips the sign of that game's luck", () => {
    const pool = [80, 100, 120, 140].map((score, i) => ({ managerId: String(i), score }));
    const a = { managerId: "1", opponentManagerId: "2", year: 2026, week: 1, isPlayoff: false, bracket: null, score: 100, opponentScore: 120, isWinner: false };
    const b = { managerId: "2", opponentManagerId: "1", year: 2026, week: 1, isPlayoff: false, bracket: null, score: 120, opponentScore: 100, isWinner: true };
    const others = [
      { managerId: "0", opponentManagerId: "3", year: 2026, week: 1, isPlayoff: false, bracket: null, score: 80, opponentScore: 140, isWinner: false },
      { managerId: "3", opponentManagerId: "0", year: 2026, week: 1, isPlayoff: false, bracket: null, score: 140, opponentScore: 80, isWinner: true },
    ];
    void pool;
    const x = computeLuckWins([a, b, ...others]);
    const y = computeLuckWins([{ ...a, score: 120, opponentScore: 100, isWinner: true }, { ...b, score: 100, opponentScore: 120, isWinner: false }, ...others]);
    // Team 1 lost 100-120 (expected 1/3): luck −1/3. With the scores swapped it wins 120-100 (expected 2/3): +1/3.
    expect(x.get("1")!.luckWins).toBeCloseTo(-1 / 3, 10);
    expect(y.get("1")!.luckWins).toBeCloseTo(1 / 3, 10);
  });
});

describe("labels", () => {
  it("are monotonic in luckWins for the same sample", () => {
    const variance = 2.2; // ~9 games
    let prev = -Infinity;
    for (let l = -5; l <= 5; l += 0.1) {
      const r = labelRank(luckLabelFromZ(l, l / Math.sqrt(variance), 9).label);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("use the spec's bands and the 6-game minimum", () => {
    expect(luckLabelFromZ(0.2, 0.3, 9).label).toBe("Neutral");
    expect(luckLabelFromZ(1, 0.7, 9).label).toBe("Slightly Lucky");
    expect(luckLabelFromZ(-2, -1.5, 9).label).toBe("Unlucky");
    expect(luckLabelFromZ(5, 2.5, 9).label).toBe("Extremely Lucky");
    expect(luckLabelFromZ(3, 3, 5).label).toBe("Not enough games");
  });

  it("career and season are comparable: +10.2 over 135 games outranks +2.9 over 135", () => {
    // Jones vs McManus, career (variance ≈ 0.2 per game).
    const v = 135 * 0.2;
    const jones = luckLabelFromZ(10.2, 10.2 / Math.sqrt(v), 135).label;
    const mcmanus = luckLabelFromZ(2.9, 2.9 / Math.sqrt(v), 135).label;
    expect(labelRank(jones)).toBeGreaterThanOrEqual(labelRank(mcmanus));
    expect(jones).toBe("Lucky");
  });

  it("formats with a sign and one decimal", () => {
    expect(formatLuckWins(2.13)).toBe("+2.1 wins");
    expect(formatLuckWins(-2.78)).toBe("−2.8 wins");
    expect(formatLuckWins(0.01)).toBe("0.0 wins");
  });
});
