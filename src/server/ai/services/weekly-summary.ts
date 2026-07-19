// Content service: the top-of-issue weekly summary blurb for a WEEKLY_ISSUE
// article (see ArticleSectionType.INTRO in prisma/schema.prisma).

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const WEEKLY_SUMMARY_PROMPT_VERSION = "weekly-summary-v1";

export interface WeeklySummaryMatchupResult {
  teamAName: string;
  teamBName: string;
  teamAScore: number;
  teamBScore: number;
}

export interface WeeklySummaryInput {
  week: number;
  season: number;
  matchupResults: WeeklySummaryMatchupResult[];
  topScorer: {
    teamName: string;
    managerName: string;
    points: number;
  };
  notableUpsets: string[]; // plain-language facts, e.g. "Team C (2-7) beat Team D (7-2)"
}

export interface WeeklySummaryResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "Gridiron Gazette", a fantasy football league's own newspaper. Write the opening "week in review" summary (4-6 sentences) for this week's issue, using the structured data below. Cover the overall shape of the week, call out the top scorer, and mention any notable upsets. Write in plain prose paragraphs, not bullet points or JSON.`;

export async function generateWeeklySummary(
  input: WeeklySummaryInput,
  safeguards: ContentSafeguards
): Promise<WeeklySummaryResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured week data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: WEEKLY_SUMMARY_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.WEEKLY_ISSUE,
    promptVersion: WEEKLY_SUMMARY_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
