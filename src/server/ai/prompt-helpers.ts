// Shared prompt-construction helpers used by every service in src/server/ai/services/.
// Centralizing this means the humor-level ladder and safeguard wording only
// need to be tuned in one place, and every content type stays consistent.

import type { ContentSafeguards } from "./types";

/** Copy for each rung of the 1-5 humor dial. Kept short — this gets embedded in every system prompt. */
const HUMOR_LEVEL_COPY: Record<number, string> = {
  1: "Humor level 1/5: Dry and strictly factual. No jokes, no roasting, no snark. Report what happened.",
  2: "Humor level 2/5: Mostly factual with an occasional light, gentle quip. Nothing pointed.",
  3: "Humor level 3/5: Balanced. Friendly ribbing and light sarcasm are welcome, but keep it good-natured.",
  4: "Humor level 4/5: Lean into the roast. Sharp, teasing, confident sports-talk-radio energy.",
  5: "Humor level 5/5: Full roast. Brutal, savage, no mercy on in-game decisions and performance — but NEVER cruel, and never about anything outside the game itself.",
};

/** Clamps to the 1-5 range this module works in, defaulting out-of-range/garbage input to 3 (League.defaultHumorLevel's own default). */
export function normalizeHumorLevel(humorLevel: number): number {
  if (!Number.isFinite(humorLevel)) return 3;
  return Math.min(5, Math.max(1, Math.round(humorLevel)));
}

export function humorLevelInstruction(humorLevel: number): string {
  const level = normalizeHumorLevel(humorLevel);
  return HUMOR_LEVEL_COPY[level] ?? HUMOR_LEVEL_COPY[3];
}

/**
 * Builds the block of safety instructions every system prompt must include:
 * sensitive-topic exclusions and per-manager no-roast opt-outs. Every
 * content-service function calls this and appends the result to its system
 * prompt — never skip it, even when the lists are empty.
 */
export function safeguardInstructions(safeguards: ContentSafeguards): string {
  const lines: string[] = [humorLevelInstruction(safeguards.humorLevel)];

  if (safeguards.sensitiveTopics.length > 0) {
    lines.push(
      `Do not mention, joke about, or allude to the following topics under any circumstances: ${safeguards.sensitiveTopics.join(", ")}. If the input data touches one of these topics, omit it entirely rather than working around it.`
    );
  }

  if (safeguards.noRoastManagerNames.length > 0) {
    lines.push(
      `The following managers have opted out of roasting and must be treated strictly factually and neutrally — describe their moves/performance plainly, with no jokes, teasing, or snark directed at them, even if the surrounding humor level is high: ${safeguards.noRoastManagerNames.join(", ")}. Other managers not on this list may still be roasted per the humor level above.`
    );
  }

  lines.push(
    "Never invent facts, stats, or events that are not present in the structured input provided below. Only joke about in-game performance and decisions — never about real personal hardship, health, finances, or anything outside the fantasy football context."
  );

  return lines.join("\n");
}

/** Wraps a content-type-specific system prompt with the shared safeguard block. */
export function buildSystemPrompt(basePrompt: string, safeguards: ContentSafeguards): string {
  return `${basePrompt}\n\n${safeguardInstructions(safeguards)}`;
}

/** Pretty-prints a structured input object into the user prompt as labeled JSON, keeping it readable for the model without hand-rolling per-field templating in every service. */
export function formatStructuredInput(input: unknown): string {
  return JSON.stringify(input, null, 2);
}
