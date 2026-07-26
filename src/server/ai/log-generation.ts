// Thin wrapper around prisma.aIContentGeneration.create — every AI call in
// this module goes through here so there is exactly one place that writes
// the generation log (status always defaults to GENERATED, i.e. nothing
// published here auto-publishes).

import { prisma } from "@/lib/db";
import type { AIContentGeneration, ArticleType, Prisma } from "@/generated/prisma/client";

export interface LogGenerationInput {
  contentType: ArticleType;
  relatedArticleId?: string;
  promptVersion: string;
  humorLevel: number;
  providerName: string;
  model: string;
  /** Structured facts the prompt was built from — never a raw DB dump. Stored as-is in the Json column for audit/regeneration. */
  inputSummary: unknown;
  outputText: string;
}

/**
 * Persisting mock output is how the site ended up serving "[MOCK AI CONTENT]"
 * indefinitely: the generate-once-reuse lookups treat any stored row as done,
 * so a placeholder written before a key was configured is never replaced.
 * Refusing it here covers every service in one place.
 */
export function isMockOutput(providerName: string, outputText: string): boolean {
  return providerName === "mock" || outputText.includes("[MOCK AI CONTENT]");
}

export async function logGeneration(input: LogGenerationInput): Promise<AIContentGeneration | null> {
  if (isMockOutput(input.providerName, input.outputText)) return null;

  return prisma.aIContentGeneration.create({
    data: {
      contentType: input.contentType,
      relatedArticleId: input.relatedArticleId,
      promptVersion: input.promptVersion,
      humorLevel: input.humorLevel,
      providerName: input.providerName,
      model: input.model,
      inputSummary: input.inputSummary as Prisma.InputJsonValue,
      outputText: input.outputText,
      // status intentionally omitted — Prisma schema default is GENERATED,
      // i.e. never auto-published; manual approval is a separate workflow.
    },
  });
}
