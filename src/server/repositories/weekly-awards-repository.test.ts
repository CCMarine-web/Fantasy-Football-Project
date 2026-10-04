import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Weekly awards may only come from finished games. The query asks for FINAL
 * games only; these tests also hand the function rows a buggy query could
 * return (an unplayed week stored as 0-0, a live score) and prove nothing is
 * awarded from them — and that a week with no final games has its awards
 * cleared rather than left standing.
 */

type Row = {
  score: number | null;
  isWinner: boolean | null;
  matchup: { status: string };
  fantasyTeam: { id: string; managerId: string; manager: { displayName: string } };
};

const { state, findManyMock, upsertMock, deleteManyMock } = vi.hoisted(() => ({
  state: { rows: [] as Row[] },
  findManyMock: vi.fn(),
  upsertMock: vi.fn(async (_args: { create: { type: string; managerId: string } }) => ({})),
  deleteManyMock: vi.fn(async () => ({ count: 0 })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    matchupTeam: { findMany: findManyMock },
    roster: { findMany: vi.fn(async () => []) },
    weeklyAward: { upsert: upsertMock, deleteMany: deleteManyMock },
  },
}));

import { computeWeeklyAwards } from "./weekly-awards-repository";

function row(id: string, score: number | null, isWinner: boolean | null, status = "FINAL"): Row {
  return { score, isWinner, matchup: { status }, fantasyTeam: { id, managerId: `m-${id}`, manager: { displayName: id } } };
}

beforeEach(() => {
  findManyMock.mockReset().mockImplementation(async () => state.rows);
  upsertMock.mockClear();
  deleteManyMock.mockClear();
});

describe("computeWeeklyAwards", () => {
  it("asks only for FINAL, scored, verified regular-season games", async () => {
    state.rows = [];
    await computeWeeklyAwards("s", 4);
    const { where } = findManyMock.mock.calls[0][0];
    expect(where).toMatchObject({
      matchup: { seasonId: "s", week: 4, isPlayoff: false, status: "FINAL" },
      score: { not: null },
      verifiedScore: true,
    });
  });

  it("awards a played week", async () => {
    state.rows = [row("a", 140, true), row("b", 90, false), row("c", 110, true), row("d", 120, false)];
    const n = await computeWeeklyAwards("s", 3);
    expect(n).toBe(4);
    const types = upsertMock.mock.calls.map((c) => c[0].create.type);
    expect(types).toEqual(["BOOM_OF_WEEK", "BUST_OF_WEEK", "LUCKIEST_WIN", "UNLUCKIEST_LOSS"]);
  });

  it("clears and awards nothing for a week with no final games", async () => {
    state.rows = [];
    expect(await computeWeeklyAwards("s", 9)).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { seasonId: "s", week: 9 } });
  });

  it("awards nothing from unfinished games even if a query returned them", async () => {
    state.rows = [row("a", 0, null, "SCHEDULED"), row("b", 0, null, "SCHEDULED"), row("c", 55.5, null, "IN_PROGRESS")];
    expect(await computeWeeklyAwards("s", 5)).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { seasonId: "s", week: 5 } });
  });

  it("ignores unfinished rows mixed in with finished ones", async () => {
    state.rows = [row("a", 130, true), row("b", 100, false), row("z", 0, null, "SCHEDULED")];
    await computeWeeklyAwards("s", 3);
    const winners = upsertMock.mock.calls.map((c) => c[0].create.managerId);
    expect(winners).not.toContain("m-z");
  });
});
