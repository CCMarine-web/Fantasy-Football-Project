// Content service: weekly awards commentary (Manager of the Week, Worst
// Decision, Bad Beat, Fraud Win — see AwardType in prisma/schema.prisma).
// Candidates arrive as plain facts; the model supplies the commentary/picks
// the winner, it never invents facts of its own.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const WEEKLY_AWARDS_PROMPT_VERSION = "weekly-awards-v1";

export interface AwardCandidate {
  managerName: string;
  teamName: string;
  /** Plain facts only, no commentary — e.g. "Scored 178.4, a season high" or "Started a bye-week player at FLEX". */
  facts: string[];
}

export interface WeeklyAwardsInput {
  week: number;
  season: number;
  managerOfWeekCandidates: AwardCandidate[];
  worstDecisionCandidates: AwardCandidate[];
  badBeatCandidates: AwardCandidate[];
  fraudWinCandidates: AwardCandidate[];
}

export interface WeeklyAwardsResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper, writing the weekly awards section. There are four awards: Manager of the Week, Worst Decision of the Week, Bad Beat of the Week, and Fraud Win of the Week. For each award, you are given a list of candidates with plain facts (not commentary). Pick the strongest candidate for each award based solely on the facts given, and write 1-3 sentences of commentary explaining the pick. Write in plain prose, organized under a short heading per award, not JSON.`;

export async function generateWeeklyAwards(
  input: WeeklyAwardsInput,
  safeguards: ContentSafeguards
): Promise<WeeklyAwardsResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured award candidate data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: WEEKLY_AWARDS_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.WEEKLY_ISSUE,
    promptVersion: WEEKLY_AWARDS_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
