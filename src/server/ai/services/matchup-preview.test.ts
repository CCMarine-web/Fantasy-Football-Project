import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIGenerationRequest } from "../types";

// Prevent any real Prisma access — log-generation.ts imports "@/lib/db",
// which in turn constructs a real PrismaClient. Stub it with a spy so this
// stays a pure unit test. vi.mock factories are hoisted above imports, so the
// mock fn itself must be created via vi.hoisted to avoid a TDZ reference error.
const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn().mockResolvedValue({ id: "gen_test_1" }),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    aIContentGeneration: {
      create: createMock,
    },
  },
}));

// Capture the exact request handed to the provider so we can assert the
// safeguard instructions (sensitive topics, no-roast names, humor level)
// actually made it into the constructed system prompt, not just that the
// safeguards object was passed around.
let lastRequest: AIGenerationRequest | undefined;
vi.mock("../get-ai-provider", () => ({
  getAIProvider: () => ({
    generate: async (request: AIGenerationRequest) => {
      lastRequest = request;
      return { text: "[MOCK AI CONTENT] stub", providerName: "mock", model: "mock-v1" };
    },
  }),
}));

import { generateMatchupPreview, MATCHUP_PREVIEW_PROMPT_VERSION } from "./matchup-preview";

const baseInput = {
  week: 5,
  season: 2026,
  teamA: {
    teamName: "Gridiron Ghosts",
    managerName: "Pat Smith",
    record: "4-1",
    recentForm: "won 3 straight",
    keyPlayers: ["Justin Jefferson"],
  },
  teamB: {
    teamName: "End Zone Enforcers",
    managerName: "Jordan Lee",
    record: "2-3",
    recentForm: "lost 2 straight",
    keyPlayers: ["Derrick Henry"],
  },
  headToHeadSummary: "Series tied 2-2, Pat won the last meeting",
};

describe("generateMatchupPreview", () => {
  beforeEach(() => {
    createMock.mockClear();
    lastRequest = undefined;
  });

  it("folds sensitive-topic exclusions and the no-roast manager name into the constructed system prompt", async () => {
    await generateMatchupPreview(baseInput, {
      humorLevel: 5,
      sensitiveTopics: ["ongoing divorce"],
      noRoastManagerNames: ["Jordan Lee"],
    });

    expect(lastRequest).toBeDefined();
    expect(lastRequest?.systemPrompt).toContain("ongoing divorce");
    expect(lastRequest?.systemPrompt).toContain("Jordan Lee");
    expect(lastRequest?.systemPrompt).toMatch(/do not mention/i);
    expect(lastRequest?.systemPrompt).toMatch(/no jokes/i);
    expect(lastRequest?.promptVersion).toBe(MATCHUP_PREVIEW_PROMPT_VERSION);
  });

  it("omits no-roast/sensitive-topic language when the safeguard lists are empty", async () => {
    await generateMatchupPreview(baseInput, { humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] });

    expect(lastRequest?.systemPrompt).not.toContain("Do not mention, joke about");
    expect(lastRequest?.systemPrompt).not.toContain("opted out of roasting");
  });

  it("passes the structured input (not a raw dump) through to the logged generation", async () => {
    await generateMatchupPreview(baseInput, { humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] });

    expect(createMock).toHaveBeenCalledTimes(1);
    const createArgs = createMock.mock.calls[0][0];
    expect(createArgs.data.inputSummary).toEqual(baseInput);
    expect(createArgs.data.promptVersion).toBe(MATCHUP_PREVIEW_PROMPT_VERSION);
    expect(createArgs.data.humorLevel).toBe(3);
  });

  it("returns the provider's text and the logged generation id", async () => {
    const result = await generateMatchupPreview(baseInput, {
      humorLevel: 3,
      sensitiveTopics: [],
      noRoastManagerNames: [],
    });

    expect(result.generationId).toBe("gen_test_1");
    expect(result.text).toContain("[MOCK AI CONTENT]");
  });

  it("never sets status explicitly, relying on the GENERATED default (no auto-publish)", async () => {
    await generateMatchupPreview(baseInput, { humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] });

    const createArgs = createMock.mock.calls[0][0];
    expect(createArgs.data.status).toBeUndefined();
  });
});
