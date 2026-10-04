import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The weekly pipeline end to end, with the database and the model replaced:
 * given a season whose weeks are a mix of played, under way and scheduled —
 * plus a week stored the way the old sync bug stored it (FINAL, no scores) —
 * it recaps and awards only the played week.
 */

type Team = { fantasyTeamId: string; score: number | null; isWinner: boolean | null; fantasyTeam: object };
type M = { id: string; week: number; status: string; isPlayoff: boolean; teams: Team[] };

const { state, recapMock, previewMock, awardsMock } = vi.hoisted(() => ({
  state: { matchups: [] as M[] },
  recapMock: vi.fn(async (_input: { matchupId?: string; week: number }, _safeguards: unknown) => ({ generationId: "g", text: "t" })),
  previewMock: vi.fn(async () => ({ generationId: "g", text: "t" })),
  awardsMock: vi.fn(async (_seasonId: string, _week: number) => 4),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    season: {
      findUnique: vi.fn(async () => ({ id: "s2026", year: 2026 })),
      findFirst: vi.fn(async () => ({ id: "s2026", year: 2026 })),
    },
    matchup: { findMany: vi.fn(async () => state.matchups) },
    aIContentGeneration: { findMany: vi.fn(async () => []) },
    weeklyPlayerScore: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/server/sleeper", () => ({ syncCurrentLeague: vi.fn() }));
vi.mock("@/server/repositories/ai-config-repository", () => ({
  getContentSafeguards: vi.fn(async () => ({ humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] })),
}));
vi.mock("@/server/ai/services/matchup-recap", () => ({ generateMatchupRecap: recapMock }));
vi.mock("@/server/ai/services/matchup-preview", () => ({ generateMatchupPreview: previewMock }));
vi.mock("@/server/repositories/weekly-awards-repository", () => ({ computeWeeklyAwards: awardsMock }));

import { generateWeeklyContent } from "./weekly-pipeline";

function side(id: string, score: number | null, isWinner: boolean | null): Team {
  return {
    fantasyTeamId: id,
    score,
    isWinner,
    fantasyTeam: { teamName: `Team ${id}`, managerId: `m-${id}`, manager: { displayName: `Manager ${id}` } },
  };
}

function game(id: string, week: number, status: string, a: number | null, b: number | null): M {
  const final = a != null && b != null;
  return { id, week, status, isPlayoff: false, teams: [side(`${id}a`, a, final ? a! > b! : null), side(`${id}b`, b, final ? b! > a! : null)] };
}

beforeEach(() => {
  recapMock.mockClear();
  previewMock.mockClear();
  awardsMock.mockClear();
});

describe("generateWeeklyContent", () => {
  it("recaps and awards only played weeks", async () => {
    state.matchups = [
      game("w3", 3, "FINAL", 125.3, 115.1),
      game("w4", 4, "IN_PROGRESS", null, null),
      game("w5", 5, "SCHEDULED", null, null),
      // The old bug's shape: a future week marked FINAL with nothing played.
      game("w17", 17, "FINAL", null, null),
    ];

    const result = await generateWeeklyContent({ sync: false });

    expect(recapMock).toHaveBeenCalledTimes(1);
    expect(recapMock.mock.calls[0][0]).toMatchObject({ matchupId: "w3", week: 3 });
    expect(awardsMock.mock.calls.map((c) => c[1])).toEqual([3]);
    expect(result.recapWeek).toBe(3);
    expect(result.previewWeek).toBe(4);
  });

  it("does not recap a week whose scores exist but which is not final", async () => {
    // Live scores mid-week must never read as a result.
    state.matchups = [game("w4", 4, "IN_PROGRESS", 61.2, 44.9)];
    await generateWeeklyContent({ sync: false });
    expect(recapMock).not.toHaveBeenCalled();
    expect(awardsMock).not.toHaveBeenCalled();
  });

  it("an explicit --recap-week for an unplayed week writes nothing", async () => {
    state.matchups = [game("w3", 3, "FINAL", 100, 90), game("w5", 5, "SCHEDULED", null, null)];
    await generateWeeklyContent({ sync: false, recapWeek: 5 });
    expect(recapMock).not.toHaveBeenCalled();
    expect(awardsMock).not.toHaveBeenCalled();
  });

  it("writes nothing for a season with no played games", async () => {
    state.matchups = [game("w1", 1, "SCHEDULED", null, null), game("w2", 2, "SCHEDULED", null, null)];
    const result = await generateWeeklyContent({ sync: false });
    expect(recapMock).not.toHaveBeenCalled();
    expect(awardsMock).not.toHaveBeenCalled();
    expect(result.recapWeek).toBeNull();
  });
});
