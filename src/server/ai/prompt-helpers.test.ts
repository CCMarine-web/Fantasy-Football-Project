import { describe, expect, it } from "vitest";
import { buildSystemPrompt, humorLevelInstruction, normalizeHumorLevel, safeguardInstructions } from "./prompt-helpers";

describe("normalizeHumorLevel", () => {
  it("clamps out-of-range values into 1-5", () => {
    expect(normalizeHumorLevel(0)).toBe(1);
    expect(normalizeHumorLevel(-3)).toBe(1);
    expect(normalizeHumorLevel(9)).toBe(5);
  });

  it("defaults garbage input to 3", () => {
    expect(normalizeHumorLevel(NaN)).toBe(3);
  });

  it("passes valid values through unchanged", () => {
    expect(normalizeHumorLevel(1)).toBe(1);
    expect(normalizeHumorLevel(4)).toBe(4);
  });
});

describe("humorLevelInstruction", () => {
  it("describes level 1 as dry/no jokes", () => {
    expect(humorLevelInstruction(1)).toMatch(/dry/i);
    expect(humorLevelInstruction(1)).toMatch(/no jokes/i);
  });

  it("describes level 5 as a full roast that stays non-cruel", () => {
    expect(humorLevelInstruction(5)).toMatch(/full roast/i);
    expect(humorLevelInstruction(5)).toMatch(/never/i);
  });
});

describe("safeguardInstructions", () => {
  it("instructs the model to avoid every listed sensitive topic", () => {
    const text = safeguardInstructions({
      humorLevel: 4,
      sensitiveTopics: ["divorce", "layoffs"],
      noRoastManagerNames: [],
    });

    expect(text).toContain("divorce");
    expect(text).toContain("layoffs");
    expect(text).toMatch(/do not mention/i);
  });

  it("instructs the model to stay neutral toward every no-roast manager", () => {
    const text = safeguardInstructions({
      humorLevel: 5,
      sensitiveTopics: [],
      noRoastManagerNames: ["Pat Smith", "Jordan Lee"],
    });

    expect(text).toContain("Pat Smith");
    expect(text).toContain("Jordan Lee");
    expect(text).toMatch(/no jokes/i);
  });

  it("still includes the humor-level instruction even with empty lists", () => {
    const text = safeguardInstructions({ humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] });
    expect(text).toMatch(/balanced/i);
  });
});

describe("buildSystemPrompt", () => {
  it("appends the safeguard block to the base prompt", () => {
    const prompt = buildSystemPrompt("Write a preview.", {
      humorLevel: 2,
      sensitiveTopics: ["injury history"],
      noRoastManagerNames: ["Alex Rivera"],
    });

    expect(prompt).toContain("Write a preview.");
    expect(prompt).toContain("injury history");
    expect(prompt).toContain("Alex Rivera");
  });
});
