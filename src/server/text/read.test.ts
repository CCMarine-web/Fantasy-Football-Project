import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows } = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/db", () => ({
  prisma: { generatedText: { findMany: vi.fn(async () => rows) } },
}));

import { classifySpecs, readTexts, textKey } from "./read";
import { specHash, type TextSpec } from "./core";

function spec(facts: Record<string, unknown>): TextSpec {
  return {
    kind: "RIVALRY",
    subjectKey: "r1",
    asOfSeason: 2026,
    asOfWeek: 9,
    facts,
    tokens: { series: String(facts.series) },
    contentType: "rivalry",
    task: "t",
    fallback: "Fallback: {{series}}",
    maxWords: 50,
  };
}

describe("never show stale AI text", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("shows the AI text, with live tokens, when it was written from these facts", async () => {
    const s = spec({ series: "Shea leads 11-8" });
    rows.push({ kind: "RIVALRY", subjectKey: "r1", template: "AI: {{series}}", inputHash: specHash(s), status: "GENERATED", asOfSeason: 2026, asOfWeek: 9, model: "m", attempts: 1 });
    const t = (await readTexts([s])).get(textKey("RIVALRY", "r1"));
    expect(t).toMatchObject({ text: "AI: Shea leads 11-8", source: "AI" });
  });

  it("falls back to the templated sentence when the facts have moved on", async () => {
    const old = spec({ series: "Shea leads 12-7" });
    rows.push({ kind: "RIVALRY", subjectKey: "r1", template: "AI: Shea leads 12-7 and a four-game streak", inputHash: specHash(old), status: "GENERATED", asOfSeason: 2026, asOfWeek: 4, model: "m", attempts: 1 });
    const now = spec({ series: "Shea leads 11-8" });
    const t = (await readTexts([now])).get(textKey("RIVALRY", "r1"));
    expect(t).toMatchObject({ text: "Fallback: Shea leads 11-8", source: "FALLBACK" });
    const c = await classifySpecs([now]);
    expect(c.stale).toHaveLength(1);
  });

  it("counts a missing text as stale and a validated fallback as grounded", async () => {
    const s = spec({ series: "x" });
    expect((await classifySpecs([s])).stale).toHaveLength(1);
    rows.push({ kind: "RIVALRY", subjectKey: "r1", template: "Fallback: {{series}}", inputHash: specHash(s), status: "FALLBACK", attempts: 3 });
    const c = await classifySpecs([s]);
    expect(c.stale).toHaveLength(0);
    expect(c.fallback).toHaveLength(1);
  });
});
