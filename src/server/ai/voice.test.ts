import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt-helpers";
import { buildVoicedSystemPrompt, VOICE_EXAMPLES, type VoiceContentType } from "./voice";

const TASK = "Write a short recap of the matchup described below.";
const SAFE = { humorLevel: 3, sensitiveTopics: ["divorce"], noRoastManagerNames: ["Pat"] };

describe("buildVoicedSystemPrompt", () => {
  it("classic is exactly the prompt that has been live all along", () => {
    expect(buildVoicedSystemPrompt(TASK, "matchup-recap", SAFE, { mode: "classic", spice: 3 })).toBe(
      buildSystemPrompt(TASK, SAFE),
    );
  });

  it("classic still carries per-manager off-limits topics", () => {
    const prompt = buildVoicedSystemPrompt(
      TASK,
      "matchup-recap",
      { ...SAFE, offLimitsByManager: [{ managerName: "Sam", topics: ["his job"] }] },
      { mode: "classic", spice: 3 },
    );
    expect(prompt.startsWith(buildSystemPrompt(TASK, SAFE))).toBe(true);
    expect(prompt).toContain("Sam: his job");
  });

  it("unhinged keeps the task, the hard rules and every safeguard", () => {
    const prompt = buildVoicedSystemPrompt(
      TASK,
      "trade-verdict",
      { ...SAFE, offLimitsByManager: [{ managerName: "Sam", topics: ["his job"] }] },
      { mode: "unhinged", spice: 3 },
    );
    expect(prompt).toContain(TASK);
    expect(prompt).toContain("No slurs");
    expect(prompt).toContain("Never invent a statistic");
    expect(prompt).toContain("divorce"); // league-wide sensitive topic
    expect(prompt).toContain("Pat"); // no-roast manager
    expect(prompt).toContain("Sam: his job"); // per-manager off-limits
    expect(prompt).toContain("SPICE 3");
    // The 1-5 humor ladder is replaced by the spice level, not stacked on it.
    expect(prompt).not.toContain("Humor level 3/5");
  });

  it("spice level changes the intensity instruction", () => {
    const at = (spice: 1 | 2 | 3) => buildVoicedSystemPrompt(TASK, "matchup-recap", SAFE, { mode: "unhinged", spice });
    expect(at(1)).toContain("PG-13");
    expect(at(2)).toContain("SPICE 2 (R)");
    expect(at(3)).toContain("UNHINGED");
  });

  it("has 3-5 examples for every content type that writes copy", () => {
    for (const [type, examples] of Object.entries(VOICE_EXAMPLES) as [VoiceContentType, string[]][]) {
      if (type === "other") continue;
      expect(examples.length, type).toBeGreaterThanOrEqual(3);
      expect(examples.length, type).toBeLessThanOrEqual(5);
    }
  });
});
