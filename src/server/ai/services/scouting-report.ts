// AI scouting report for a manager, derived from their real transaction
// history, draft tendencies, and results. Logs to AIContentGeneration
// (MANAGER_PROFILE) so it can be generate-once-reused. Mock without a key.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const SCOUTING_REPORT_PROMPT_VERSION = "scouting-report-v1";

export interface ScoutingReportInput {
  managerId: string;
  managerName: string;
  careerRecord: string;
  championships: number;
  tradeCount: number;
  waiverClaims: number;
  freeAgentPickups: number;
  faabSpent: number | null;
  firstRoundPositions: string[]; // positions taken in round 1 across seasons
  bestFinish: number | null;
  worstFinish: number | null;
}

export interface ScoutingReportResult {
  generationId: string;
  text: string;
  providerName: string;
}

const SYSTEM_PROMPT = `You are a fantasy football scout writing a manager "scouting report" for "The Rat Trap" league newspaper. From the structured facts below, characterize this manager's ARCHETYPE and tendencies (aggressive trader, waiver-wire addict, draft-and-hold, sets-lineup-Sunday-morning, FAAB spendthrift, etc.) in 3-5 punchy sentences with attitude. Base every claim on the facts provided; don't invent specifics. Respect the safeguards.`;

export async function generateScoutingReport(
  input: ScoutingReportInput,
  safeguards: ContentSafeguards,
): Promise<ScoutingReportResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Manager scouting facts:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: SCOUTING_REPORT_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.MANAGER_PROFILE,
    promptVersion: SCOUTING_REPORT_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text, providerName: result.providerName };
}
