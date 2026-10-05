// Content service: a manager's career profile article.

import { ArticleType } from "@/generated/prisma/client";
import { logGeneration } from "../log-generation";
import { formatStructuredInput } from "../prompt-helpers";
import { buildVoicedSystemPrompt } from "../voice";
import { generateVoiced } from "../voiced-generate";
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
  /** Null when the generation was mock output and therefore not logged. */
  generationId: string | null;
  text: string;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper, writing a manager career profile. Using the structured career facts below, write a short profile (4-6 sentences) covering their tenure, career record, championships, and one or two notable moments. Write in plain prose paragraphs, not bullet points or JSON. IMPORTANT: if this specific manager is listed as no-roast below, this entire profile must stay strictly factual and warm/neutral in tone — a plain career retrospective, not a roast.`;

export async function generateManagerProfile(
  input: ManagerProfileInput,
  safeguards: ContentSafeguards
): Promise<ManagerProfileResult> {
  const systemPrompt = buildVoicedSystemPrompt(SYSTEM_PROMPT, "manager-profile", safeguards);
  const userPrompt = `Structured manager career data:\n${formatStructuredInput(input)}`;

  const result = await generateVoiced({
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

  return { generationId: generation?.id ?? null, text: result.text };
}
