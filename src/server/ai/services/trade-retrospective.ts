// Content service: "how did that trade age" retrospective article.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const TRADE_RETROSPECTIVE_PROMPT_VERSION = "trade-retrospective-v1";

export interface TradeRetrospectiveInput {
  season: number;
  week: number;
  teamA: {
    teamName: string;
    managerName: string;
    assetsSent: string[]; // e.g. ["Christian McCaffrey", "2024 1st round pick"]
  };
  teamB: {
    teamName: string;
    managerName: string;
    assetsSent: string[];
  };
  /** Plain facts about how it's played out so far, e.g. "CMC has scored 220 points for Team B since the trade; the pick Team A got became the 4th overall selection." */
  outcomeSoFarFacts: string[];
}

export interface TradeRetrospectiveResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper, writing a trade retrospective. Using the structured facts below, describe the trade, then assess how it has aged so far based only on the outcome facts provided. Write in plain prose paragraphs (4-6 sentences), not bullet points or JSON. Do not declare a final "winner" beyond what the facts support — hedge if the outcome is still unclear.`;

export async function generateTradeRetrospective(
  input: TradeRetrospectiveInput,
  safeguards: ContentSafeguards
): Promise<TradeRetrospectiveResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured trade data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: TRADE_RETROSPECTIVE_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.TRADE_RETROSPECTIVE,
    promptVersion: TRADE_RETROSPECTIVE_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
