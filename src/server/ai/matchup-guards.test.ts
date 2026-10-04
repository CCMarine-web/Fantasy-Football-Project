import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Recaps may only ever be stored for a game that has been played. These tests
 * drive the two storage paths (the generation log and the blurb cache) and the
 * recap service itself against an in-memory set of matchups, and prove each
 * refuses an unplayed week — including the exact shape of the old bug, a
 * future week stored as FINAL with null scores.
 */

const { matchups, createMock, upsertMock, generateMock } = vi.hoisted(() => ({
  matchups: new Map<string, { status: string; teams: { score: number | null }[] }>(),
  createMock: vi.fn(async () => ({ id: "gen_1" })),
  upsertMock: vi.fn(async () => ({})),
  generateMock: vi.fn(async () => ({ text: "A recap.", providerName: "openai", model: "gpt-5-mini" })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    matchup: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => matchups.get(where.id) ?? null) },
    aIContentGeneration: { create: createMock },
    aIBlurbCache: { upsert: upsertMock },
  },
}));
vi.mock("./get-ai-provider", () => ({ getAIProvider: () => ({ generate: generateMock }) }));

import { assertMatchupPlayed, isPlayedMatchup, UnplayedMatchupError } from "./matchup-guards";
import { logGeneration } from "./log-generation";
import { putBlurb } from "./blurb-cache";
import { generateMatchupRecap } from "./services/matchup-recap";

const SAFEGUARDS = { humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] };

function recapInput(matchupId: string | undefined) {
  return {
    matchupId,
    week: 4,
    season: 2026,
    teamA: { teamName: "A", managerName: "Ann", finalScore: 0 },
    teamB: { teamName: "B", managerName: "Bob", finalScore: 0 },
    keyPerformances: [],
    framing: "nail-biter" as const,
  };
}

beforeEach(() => {
  matchups.clear();
  matchups.set("played", { status: "FINAL", teams: [{ score: 120.5 }, { score: 99.1 }] });
  matchups.set("in-progress", { status: "IN_PROGRESS", teams: [{ score: null }, { score: null }] });
  matchups.set("scheduled", { status: "SCHEDULED", teams: [{ score: null }, { score: null }] });
  // The old bug: an unplayed week stored as FINAL. Scores are what give it away.
  matchups.set("final-no-scores", { status: "FINAL", teams: [{ score: null }, { score: null }] });
  matchups.set("bye", { status: "FINAL", teams: [{ score: 101 }] });
  createMock.mockClear();
  upsertMock.mockClear();
  generateMock.mockClear();
});

const UNPLAYED = ["in-progress", "scheduled", "final-no-scores", "bye", "no-such-matchup"];

describe("isPlayedMatchup", () => {
  it("is true only for a FINAL two-sided game with both scores", () => {
    expect(isPlayedMatchup(matchups.get("played")!)).toBe(true);
    for (const id of ["in-progress", "scheduled", "final-no-scores", "bye"]) {
      expect(isPlayedMatchup(matchups.get(id)!)).toBe(false);
    }
    expect(isPlayedMatchup({ status: "IN_PROGRESS", teams: [{ score: 80 }, { score: 70 }] })).toBe(false);
  });
});

describe("assertMatchupPlayed", () => {
  it("passes a played game", async () => {
    await expect(assertMatchupPlayed("played")).resolves.toBeUndefined();
  });

  it.each([...UNPLAYED, undefined, null, ""])("refuses %s", async (id) => {
    await expect(assertMatchupPlayed(id as string | undefined)).rejects.toBeInstanceOf(UnplayedMatchupError);
  });
});

describe("a recap is never stored for an unplayed week", () => {
  it.each(UNPLAYED)("generation log refuses %s", async (matchupId) => {
    await expect(
      logGeneration({
        contentType: "MATCHUP_RECAP",
        promptVersion: "v",
        humorLevel: 3,
        providerName: "openai",
        model: "m",
        inputSummary: { matchupId },
        outputText: "A 0-0 nail-biter.",
      }),
    ).rejects.toBeInstanceOf(UnplayedMatchupError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("generation log refuses a recap that names no matchup", async () => {
    await expect(
      logGeneration({ contentType: "MATCHUP_RECAP", promptVersion: "v", humorLevel: 3, providerName: "openai", model: "m", inputSummary: {}, outputText: "x" }),
    ).rejects.toBeInstanceOf(UnplayedMatchupError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("generation log stores a recap of a played game", async () => {
    await logGeneration({ contentType: "MATCHUP_RECAP", promptVersion: "v", humorLevel: 3, providerName: "openai", model: "m", inputSummary: { matchupId: "played" }, outputText: "x" });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("previews of unplayed games are still allowed", async () => {
    await logGeneration({ contentType: "MATCHUP_PREVIEW", promptVersion: "v", humorLevel: 3, providerName: "openai", model: "m", inputSummary: { matchupId: "scheduled" }, outputText: "x" });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it.each(UNPLAYED)("blurb cache refuses a featured recap of %s", async (matchupId) => {
    await expect(
      putBlurb({ kind: "MATCHUP_RECAP", subjectKey: `2026:4:${matchupId}`, inputHash: "h", text: "x", providerName: "openai", model: "m" }),
    ).rejects.toBeInstanceOf(UnplayedMatchupError);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("blurb cache stores a featured recap of a played game", async () => {
    await putBlurb({ kind: "MATCHUP_RECAP", subjectKey: "2026:3:played", inputHash: "h", text: "x", providerName: "openai", model: "m" });
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});

describe("a recap is never generated for an unplayed week", () => {
  it.each([...UNPLAYED, undefined])("the recap service refuses %s before calling the model", async (matchupId) => {
    await expect(generateMatchupRecap(recapInput(matchupId), SAFEGUARDS)).rejects.toBeInstanceOf(UnplayedMatchupError);
    expect(generateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("the recap service writes a played game", async () => {
    await generateMatchupRecap(recapInput("played"), SAFEGUARDS);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
