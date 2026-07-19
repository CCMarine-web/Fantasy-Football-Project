// Content service: post-game matchup recap article copy.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const MATCHUP_RECAP_PROMPT_VERSION = "matchup-recap-v1";

export interface MatchupRecapInput {
  week: number;
  season: number;
  teamA: {
    teamName: string;
    managerName: string;
    finalScore: number;
  };
  teamB: {
    teamName: string;
    managerName: string;
    finalScore: number;
  };
  keyPerformances: string[]; // e.g. ["CMC dropped 34 for Team A", "..."]
  /** How to frame the game: a nail-biter, a blowout, a comeback, etc. */
  framing: "blowout" | "nail-biter" | "comeback" | "upset" | "chalk";
}

export interface MatchupRecapResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper. Write a short recap (3-5 sentences) of the completed matchup described in the structured data below. Open with the result, reference the final score and the "framing" of the game (blowout/nail-biter/comeback/upset/chalk), and call out the key performances that decided it. Write in plain prose paragraphs, not bullet points or JSON.`;

export async function generateMatchupRecap(
  input: MatchupRecapInput,
  safeguards: ContentSafeguards
): Promise<MatchupRecapResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured matchup result data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: MATCHUP_RECAP_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.MATCHUP_RECAP,
    promptVersion: MATCHUP_RECAP_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
