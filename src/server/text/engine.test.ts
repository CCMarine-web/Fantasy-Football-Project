import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, drafts } = vi.hoisted(() => ({ store: new Map<string, Record<string, unknown>>(), drafts: [] as string[] }));

vi.mock("@/lib/db", () => ({
  prisma: {
    generatedText: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        store.set(String(create.subjectKey), create);
        return create;
      }),
    },
  },
}));
vi.mock("@/server/repositories/ai-config-repository", () => ({
  getContentSafeguards: vi.fn(async () => ({ humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] })),
}));
vi.mock("@/server/ai/get-ai-provider", () => ({
  getAIProvider: () => ({
    generate: vi.fn(async () => ({ text: drafts.shift() ?? "", providerName: "openai", model: "test-model" })),
  }),
}));

import { produceText } from "./engine";
import type { TextSpec } from "./core";

const spec: TextSpec = {
  kind: "RIVALRY",
  subjectKey: "r1",
  asOfSeason: 2026,
  asOfWeek: 9,
  facts: { series: "Michael Shea leads 11-8", meetings: 19, streak: { holder: "Michael Barkemeyer", games: 5 } },
  tokens: { series: "Michael Shea leads 11-8" },
  contentType: "rivalry",
  task: "Write it.",
  fallback: "{{series}}.",
  maxWords: 60,
};

describe("produceText", () => {
  beforeEach(() => {
    store.clear();
    drafts.length = 0;
  });

  it("retries a draft with an invented record, then stores the grounded one", async () => {
    drafts.push("Shea leads 12-7 across 19 meetings.", "{{series}} across 19 meetings; Barkemeyer has won 5 straight.");
    expect(await produceText(spec)).toBe("generated");
    const row = store.get("r1")!;
    expect(row.template).toBe("{{series}} across 19 meetings; Barkemeyer has won 5 straight.");
    expect(row.attempts).toBe(2);
    expect(JSON.stringify(row.validation)).toContain('record \\"12-7\\" is not in the facts');
  });

  it("stores the templated fallback after three ungrounded drafts — never the bad prose", async () => {
    drafts.push("12-7!", "a four-game streak", "Luck Score 48");
    expect(await produceText(spec)).toBe("fallback");
    expect(store.get("r1")).toMatchObject({ template: "{{series}}.", status: "FALLBACK", attempts: 3 });
  });
});
