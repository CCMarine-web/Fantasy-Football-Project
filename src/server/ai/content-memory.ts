// Content memory — prevents the AI writer from repeating the same jokes,
// descriptions, and league-knowledge material across generated content.
//
// Two halves:
//   recordContentUsage(...)  — after a generation, log which LeagueKnowledge
//                              records and/or fact keys it leaned on.
//   getRecentlyUsedMaterial(...) — before a generation, fetch what's already
//                              been used so it can be injected into the prompt
//                              as an "avoid repeating these" block.
//
// Backed by the ContentUsage table (see prisma/schema.prisma). Everything here
// is deterministic bookkeeping — no AI calls.

import { prisma } from "@/lib/db";

export interface RecordUsageInput {
  /** The AIContentGeneration.id this usage belongs to (if logged). */
  generationId?: string;
  /** LeagueKnowledge ids the generation drew on. */
  knowledgeIds?: string[];
  /** Free-form fact keys the generation used (e.g. "manager:<id>:championships"). */
  factKeys?: string[];
  /** ArticleType-ish label for scoping later lookups (e.g. "MANAGER_PROFILE"). */
  articleType?: string;
}

/** Records what a generation used. No-op when there's nothing to record. */
export async function recordContentUsage(input: RecordUsageInput): Promise<number> {
  const rows: {
    generationId?: string;
    knowledgeId?: string;
    factKey?: string;
    articleType?: string;
  }[] = [];

  for (const knowledgeId of input.knowledgeIds ?? []) {
    rows.push({ generationId: input.generationId, knowledgeId, articleType: input.articleType });
  }
  for (const factKey of input.factKeys ?? []) {
    rows.push({ generationId: input.generationId, factKey, articleType: input.articleType });
  }
  if (rows.length === 0) return 0;

  await prisma.contentUsage.createMany({ data: rows });
  return rows.length;
}

export interface UsedMaterial {
  /** Titles of LeagueKnowledge already used (deduped). */
  knowledgeTitles: string[];
  /** Fact keys already used (deduped). */
  factKeys: string[];
}

/**
 * Returns material already used in recent generations, optionally scoped by
 * articleType. Bounded so it can be safely injected into a prompt.
 */
export async function getRecentlyUsedMaterial(
  opts: { articleType?: string; limit?: number } = {},
): Promise<UsedMaterial> {
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
  const usages = await prisma.contentUsage.findMany({
    where: { ...(opts.articleType ? { articleType: opts.articleType } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { knowledge: { select: { title: true } } },
  });

  const titles = new Set<string>();
  const facts = new Set<string>();
  for (const u of usages) {
    if (u.knowledge?.title) titles.add(u.knowledge.title);
    if (u.factKey) facts.add(u.factKey);
  }
  return { knowledgeTitles: [...titles], factKeys: [...facts] };
}

/**
 * Builds a short instruction block listing already-used material, to append to
 * a system/user prompt so the writer varies its jokes and descriptions. Returns
 * "" when there's nothing to avoid (so callers can append unconditionally).
 */
export function avoidRepetitionInstruction(used: UsedMaterial): string {
  if (used.knowledgeTitles.length === 0) return "";
  const items = used.knowledgeTitles.slice(0, 40).map((t) => `- ${t}`).join("\n");
  return `The following angles/jokes/material have ALREADY been used in recent content. Do NOT repeat them — find fresh angles:\n${items}`;
}
