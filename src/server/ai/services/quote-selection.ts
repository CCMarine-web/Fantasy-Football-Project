// Content service: "Quote of the Week" selection (ArticleSectionType.QUOTE_OF_WEEK).
// Candidate quotes come from HistoricalQuote rows the caller already
// fetched/approved; this service just picks and briefly justifies a selection
// as free text. No structured JSON output is required for this initial build.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const QUOTE_SELECTION_PROMPT_VERSION = "quote-selection-v1";

export interface CandidateQuote {
  managerName: string;
  text: string;
  /** Where/when it was said, e.g. "Week 4 group chat, after a blowout loss". */
  context: string;
}

export interface QuoteSelectionInput {
  candidates: CandidateQuote[];
  /** e.g. "trash talk", "bad beats", "draft day regret" */
  theme: string;
  /** How many quotes to select. */
  targetCount: number;
}

export interface QuoteSelectionResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "Gridiron Gazette", a fantasy football league's own newspaper, curating this issue's "Quote of the Week" section. You are given a list of candidate quotes (with the manager who said it and its context) and a target theme and count. Select the best quotes matching the theme, quote them verbatim with attribution, and write one short line of commentary on why each was chosen. Only select from the candidates provided — never invent a quote. Write in plain prose, not JSON.`;

export async function selectQuotes(
  input: QuoteSelectionInput,
  safeguards: ContentSafeguards
): Promise<QuoteSelectionResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured candidate quote data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: QUOTE_SELECTION_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.WEEKLY_ISSUE,
    promptVersion: QUOTE_SELECTION_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
