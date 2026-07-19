// Content service: end-of-season retrospective article.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const SEASON_SUMMARY_PROMPT_VERSION = "season-summary-v1";

export interface SeasonSummaryInput {
  seasonYear: number;
  champion: {
    teamName: string;
    managerName: string;
  };
  /** Plain-language final-standings recap, e.g. "Team A finished 12-2 atop the regular season but fell in the semis". */
  standingsSummary: string;
  /** Plain factual storylines from the season, e.g. "Team B's 9-game win streak", "The three-team trade in week 6 that reshaped the league". */
  storylines: string[];
}

export interface SeasonSummaryResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "Gridiron Gazette", a fantasy football league's own newspaper, writing the season-ending retrospective. Using the structured facts below, write a season summary (5-8 sentences) that crowns the champion, recaps the standings, and touches on the season's storylines. Write in plain prose paragraphs, not bullet points or JSON.`;

export async function generateSeasonSummary(
  input: SeasonSummaryInput,
  safeguards: ContentSafeguards
): Promise<SeasonSummaryResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured season data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: SEASON_SUMMARY_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.SEASON_SUMMARY,
    promptVersion: SEASON_SUMMARY_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
