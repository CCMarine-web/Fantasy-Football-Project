// Content service: a manager's career profile article.

import { ArticleType } from "@/generated/prisma/client";
import { getAIProvider } from "../get-ai-provider";
import { logGeneration } from "../log-generation";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const MANAGER_PROFILE_PROMPT_VERSION = "manager-profile-v1";

export interface ManagerProfileInput {
  managerName: string;
  joinedYear: number;
  careerRecord: string; // e.g. "58-42-1"
  championships: number;
  /** Plain factual descriptions, e.g. "Won it all in 2021 after an 0-3 start", "Traded away a #1 pick for a kicker in 2019". */
  notableMoments: string[];
}

export interface ManagerProfileResult {
  generationId: string;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "Gridiron Gazette", a fantasy football league's own newspaper, writing a manager career profile. Using the structured career facts below, write a short profile (4-6 sentences) covering their tenure, career record, championships, and one or two notable moments. Write in plain prose paragraphs, not bullet points or JSON. IMPORTANT: if this specific manager is listed as no-roast below, this entire profile must stay strictly factual and warm/neutral in tone — a plain career retrospective, not a roast.`;

export async function generateManagerProfile(
  input: ManagerProfileInput,
  safeguards: ContentSafeguards
): Promise<ManagerProfileResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured manager career data:\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: MANAGER_PROFILE_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const generation = await logGeneration({
    contentType: ArticleType.MANAGER_PROFILE,
    promptVersion: MANAGER_PROFILE_PROMPT_VERSION,
    humorLevel: safeguards.humorLevel,
    providerName: result.providerName,
    model: result.model,
    inputSummary: input,
    outputText: result.text,
  });

  return { generationId: generation.id, text: result.text };
}
