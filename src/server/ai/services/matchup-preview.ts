// Content service: matchup preview article copy.
//
// Callers already have this data from their own Prisma queries (season,
// fantasy teams, managers, standings) — this function just turns it into a
// prompt, generates, logs, and hands back text + the log row id.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const MATCHUP_PREVIEW_PROMPT_VERSION = "matchup-preview-v1";

export interface MatchupPreviewInput {
  /** Optional link back to the Matchup so generated content can be retrieved. */
  matchupId?: string;
  week: number;
  season: number;
  teamA: {
    teamName: string;
    managerName: string;
    record: string; // e.g. "6-3"
    recentForm: string; // e.g. "won 3 of last 4"
    keyPlayers: string[]; // e.g. ["Justin Jefferson (WR1)", "..."]
  };
  teamB: {
    teamName: string;
    managerName: string;
    record: string;
    recentForm: string;
    keyPlayers: string[];
  };
  headToHeadSummary: string; // e.g. "Series tied 2-2 all-time, Team A won the last meeting"
}

export interface MatchupPreviewResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper. Write a short, engaging matchup preview (3-5 sentences) for the upcoming game described in the structured data below. Build anticipation, reference the records/recent form/head-to-head history, and call out a key player or two to watch. Write in plain prose paragraphs, not bullet points or JSON.`;

export async function generateMatchupPreview(
  input: MatchupPreviewInput,
  safeguards: ContentSafeguards
): Promise<MatchupPreviewResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured matchup data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: MATCHUP_PREVIEW_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.MATCHUP_PREVIEW,
    promptVersion: MATCHUP_PREVIEW_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
