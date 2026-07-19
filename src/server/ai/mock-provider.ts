// Zero-dependency, zero-network provider so the whole site works with no
// OPENAI_API_KEY configured. Output is clearly labeled as mock and varies
// believably based on the prompt content so pages have realistic-looking
// copy to render and QA against while wiring things up.

import type { AIGenerationRequest, AIGenerationResult, AIProvider } from "./types";

const MOCK_MODEL = "mock-v1";

/** Pulls a handful of short, quotable fragments out of the user prompt so the
 *  mock output visibly reflects the actual structured input instead of being
 *  totally generic boilerplate. Deliberately simple string heuristics — this
 *  never has to be "smart", just recognizably tied to its input. */
function extractHighlights(userPrompt: string): string[] {
  const lines = userPrompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const highlights: string[] = [];
  for (const line of lines) {
    // Lines from formatStructuredInput's JSON look like `"key": "value"` or `"key": 123`.
    const match = line.match(/^"?([A-Za-z][\w]*)"?\s*:\s*"?([^"{}[\]]+?)"?,?$/);
    if (match) {
      const [, key, value] = match;
      const trimmedValue = value.trim();
      if (trimmedValue.length > 0 && !["{", "}", "[", "]"].includes(trimmedValue)) {
        highlights.push(`${key}: ${trimmedValue}`);
      }
    }
    if (highlights.length >= 6) break;
  }
  return highlights;
}

function humorLabel(humorLevel: number): string {
  if (humorLevel <= 1) return "dry/factual";
  if (humorLevel === 2) return "lightly teasing";
  if (humorLevel === 3) return "balanced";
  if (humorLevel === 4) return "spicy";
  return "full roast";
}

export class MockAIProvider implements AIProvider {
  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const highlights = extractHighlights(request.userPrompt);
    const humor = humorLabel(request.humorLevel);

    const bulletBlock =
      highlights.length > 0
        ? highlights.map((h) => `  - ${h}`).join("\n")
        : "  - (no structured facts detected in the prompt)";

    const text = [
      "[MOCK AI CONTENT]",
      `This is placeholder text generated locally (no OPENAI_API_KEY configured) for the "${request.promptVersion}" prompt template, at a ${humor} humor setting (${request.humorLevel}/5).`,
      "",
      "Key facts pulled from the structured input:",
      bulletBlock,
      "",
      "Once a real OPENAI_API_KEY is configured, this section will be replaced with model-generated copy that weaves the above facts into an actual article. This mock output exists so pages, layouts, and the approval workflow can be built and QA'd against realistic-looking content.",
    ].join("\n");

    return {
      text,
      providerName: "mock",
      model: MOCK_MODEL,
    };
  }
}
