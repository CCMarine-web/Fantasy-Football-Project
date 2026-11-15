import { describe, expect, it, vi } from "vitest";

/*
 * CROSS-PAGE CONSISTENCY.
 *
 * For every manager pair, the head-to-head record and meeting count must be
 * identical on the three data paths the site renders from:
 *   rivalry   stats/rivalry-recompute.ts  (stored Rivalry rows, /rivalries)
 *   profile   manager-repository.ts       (/managers/[id] head-to-head list)
 *   matchup   head-to-head-repository.ts  (matchup card, detail, "Why this
 *                                          game", AI facts)
 * The fixture deliberately contains every case that used to split them:
 * consolation games, championship-bracket games, a tie, a game in the current
 * week, and pairs seen from both sides.
 *
 * `npm run verify:data` runs the same comparison against the real database.
 */

vi.mock("@/lib/db", () => ({ prisma: {} }));

import type { VerifiedGameRow } from "./verified-games";
import { seriesFromRows } from "./head-to-head-repository";
import { headToHeadLines } from "./manager-repository";
import { computePair, meetingsFromVerifiedRows, pairKey } from "@/server/stats/rivalry-recompute";

const NAMES: Record<string, string> = { a: "Ann", b: "Bea", c: "Cal", d: "Dee" };

let seq = 0;
/** One game, as the two verified rows (one per side) the loader returns. */
function game(
  year: number,
  week: number,
  x: string,
  y: string,
  xScore: number,
  yScore: number,
  opts: { isPlayoff?: boolean; bracket?: "WINNERS" | "CONSOLATION" | null; roundName?: string | null } = {},
): VerifiedGameRow[] {
  const matchupId = `m${++seq}`;
  const base = {
    matchupId,
    roundName: opts.roundName ?? null,
    seasonId: `s${year}`,
    year,
    dataSource: (year >= 2023 ? "SLEEPER" : "ESPN") as VerifiedGameRow["dataSource"],
    week,
    isPlayoff: opts.isPlayoff ?? false,
    bracket: opts.bracket ?? null,
  };
  const side = (me: string, opp: string, my: number, their: number): VerifiedGameRow => ({
    ...base,
    fantasyTeamId: `${me}-${year}`,
    managerId: me,
    managerName: NAMES[me],
    score: my,
    isWinner: my === their ? null : my > their,
    opponentTeamId: `${opp}-${year}`,
    opponentManagerId: opp,
    opponentManagerName: NAMES[opp],
    opponentScore: their,
  });
  return [side(x, y, xScore, yScore), side(y, x, yScore, xScore)];
}

const rows: VerifiedGameRow[] = [
  ...game(2019, 3, "a", "b", 120, 100),
  ...game(2019, 9, "b", "a", 130.5, 99.2),
  ...game(2019, 15, "a", "b", 101, 99, { isPlayoff: true, bracket: "WINNERS", roundName: "Semifinal" }),
  ...game(2019, 16, "b", "a", 140, 80, { isPlayoff: true, bracket: "CONSOLATION" }),
  ...game(2024, 2, "a", "c", 100, 100),
  ...game(2024, 7, "c", "a", 88, 120),
  ...game(2024, 16, "c", "b", 110, 90, { isPlayoff: true, bracket: "WINNERS", roundName: "Championship" }),
  ...game(2025, 15, "d", "c", 70, 75, { isPlayoff: true, bracket: "CONSOLATION" }),
  // The current week, final: it counts on every path.
  ...game(2026, 9, "b", "a", 151.8, 132.2),
  ...game(2026, 9, "c", "d", 101, 140),
];

const managers = Object.keys(NAMES);
const meetings = meetingsFromVerifiedRows(rows);

describe("head-to-head is identical across the rivalry, profile and matchup paths", () => {
  for (const x of managers) {
    for (const y of managers) {
      if (x >= y) continue;
      it(`${NAMES[x]} vs ${NAMES[y]}`, () => {
        const viaMatchup = seriesFromRows(rows, x, y);
        const viaMatchupReverse = seriesFromRows(rows, y, x);

        const rivalry = computePair(x, y, meetings.get(pairKey(x, y)) ?? []);

        const profileX = headToHeadLines(rows, x).find((l) => l.opponentId === y);
        const profileY = headToHeadLines(rows, y).find((l) => l.opponentId === x);

        // Counts
        expect(rivalry.gamesPlayed).toBe(viaMatchup.games);
        expect(profileX?.games ?? 0).toBe(viaMatchup.games);
        expect(profileY?.games ?? 0).toBe(viaMatchup.games);
        expect(viaMatchupReverse.games).toBe(viaMatchup.games);

        // Records, both orientations
        expect([rivalry.managerAWins, rivalry.managerBWins, rivalry.ties]).toEqual([
          viaMatchup.aWins,
          viaMatchup.bWins,
          viaMatchup.ties,
        ]);
        if (viaMatchup.games > 0) {
          expect([profileX!.wins, profileX!.losses, profileX!.ties]).toEqual([viaMatchup.aWins, viaMatchup.bWins, viaMatchup.ties]);
          expect([profileY!.wins, profileY!.losses]).toEqual([viaMatchup.bWins, viaMatchup.aWins]);
        }
        expect([viaMatchupReverse.aWins, viaMatchupReverse.bWins]).toEqual([viaMatchup.bWins, viaMatchup.aWins]);

        // Margin and playoff record
        expect(rivalry.averageMargin).toBe(viaMatchup.averageMargin);
        expect(rivalry.playoffMeetings).toBe(viaMatchup.playoff.games);
        if (viaMatchup.games > 0) expect(profileX!.averageMargin).toBe(viaMatchup.averageMargin);
      });
    }
  }

  it("leaves consolation games out everywhere and keeps the current week in", () => {
    const ab = seriesFromRows(rows, "a", "b");
    // 2019 wk3 W, wk9 L, wk15 PO W, (wk16 consolation excluded), 2026 wk9 L
    expect(ab).toMatchObject({ games: 4, aWins: 2, bWins: 2 });
    expect(ab.playoff).toEqual({ games: 1, aWins: 1, bWins: 0, ties: 0 });
    expect(seriesFromRows(rows, "c", "d").games).toBe(1);
  });
});
