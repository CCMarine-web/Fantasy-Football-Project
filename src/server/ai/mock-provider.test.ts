import { describe, expect, it } from "vitest";
import { MockAIProvider } from "./mock-provider";

describe("MockAIProvider", () => {
  it("labels its output clearly as mock content", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      promptVersion: "matchup-preview-v1",
      systemPrompt: "You are a sports writer.",
      userPrompt: '{\n  "week": 5\n}',
      humorLevel: 3,
    });

    expect(result.providerName).toBe("mock");
    expect(result.text).toContain("[MOCK AI CONTENT]");
  });

  it("reports the prompt version and humor level it was called with", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      promptVersion: "season-summary-v1",
      systemPrompt: "System.",
      userPrompt: "{}",
      humorLevel: 5,
    });

    expect(result.text).toContain("season-summary-v1");
    expect(result.text).toContain("5/5");
  });

  it("echoes recognizable facts from the structured user prompt back into the output", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      promptVersion: "matchup-preview-v1",
      systemPrompt: "System.",
      userPrompt: JSON.stringify(
        { headToHeadSummary: "Series tied 2-2, Team A won the last meeting" },
        null,
        2
      ),
      humorLevel: 3,
    });

    expect(result.text).toContain("headToHeadSummary");
    expect(result.text).toContain("Series tied 2-2, Team A won the last meeting");
  });

  it("never varies providerName/model regardless of input", async () => {
    const provider = new MockAIProvider();
    const first = await provider.generate({
      promptVersion: "v1",
      systemPrompt: "a",
      userPrompt: "b",
      humorLevel: 1,
    });
    const second = await provider.generate({
      promptVersion: "v2",
      systemPrompt: "c",
      userPrompt: "d",
      humorLevel: 5,
    });

    expect(first.providerName).toBe(second.providerName);
    expect(first.model).toBe(second.model);
  });
});
