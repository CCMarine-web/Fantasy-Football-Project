// Content service: weekly power rankings commentary (ArticleSectionType.POWER_RANKINGS).

import { ArticleType } from "@/generated/prisma/client";
import { logGeneration } from "../log-generation";
import { formatStructuredInput } from "../prompt-helpers";
import { buildVoicedSystemPrompt } from "../voice";
import { generateVoiced } from "../voiced-generate";
import type { ContentSafeguards } from "../types";

export const POWER_RANKINGS_PROMPT_VERSION = "power-rankings-v1";

export interface PowerRankingEntry {
  rank: number;
  teamName: string;
  managerName: string;
  record: string; // e.g. "7-2"
  pointsFor: number;
  /** Rank movement since last week, or a plain description like "up 2", "steady", "down 1". */
  trend: string;
}

export interface PowerRankingsInput {
  week: number;
  season: number;
  rankings: PowerRankingEntry[];
}

export interface PowerRankingsResult {
  /** Null when the generation was mock output and therefore not logged. */
  generationId: string | null;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper. Write this week's power rankings commentary using the structured ranked list below. For each team (in rank order), write one short line of commentary that references their record, points, and trend. Write in plain prose (a short paragraph or line per team is fine), not JSON.`;

export async function generatePowerRankings(
  input: PowerRankingsInput,
  safeguards: ContentSafeguards
): Promise<PowerRankingsResult> {
  const systemPrompt = buildVoicedSystemPrompt(SYSTEM_PROMPT, "power-ranking", safeguards);
  const userPrompt = `Structured power rankings data:\n${formatStructuredInput(input)}`;

  const result = await generateVoiced({
    promptVersion: POWER_RANKINGS_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.WEEKLY_ISSUE,
    promptVersion: POWER_RANKINGS_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation?.id ?? null, text: result.text };
}
