import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { ContentSafeguards } from "@/server/ai/types";

/**
 * Builds the AI content safeguards from league config + manager opt-outs:
 * humor level (League.defaultHumorLevel, else env default), sensitive-topic
 * exclusions (League.sensitiveTopics), and the display names of managers who
 * have set `noRoast`. Every AI generation call should pass these so no-roast
 * managers are never the butt of a joke and excluded topics never surface.
 * Falls back to safe defaults if the database is unavailable.
 */
export async function getContentSafeguards(): Promise<ContentSafeguards> {
  try {
    const [league, noRoast] = await Promise.all([
      prisma.league.findFirst({ select: { defaultHumorLevel: true, sensitiveTopics: true } }),
      prisma.manager.findMany({ where: { noRoast: true }, select: { displayName: true } }),
    ]);
    return {
      humorLevel: league?.defaultHumorLevel ?? getEnv().DEFAULT_HUMOR_LEVEL,
      sensitiveTopics: league?.sensitiveTopics ?? [],
      noRoastManagerNames: noRoast.map((m) => m.displayName),
    };
  } catch {
    return { humorLevel: 3, sensitiveTopics: [], noRoastManagerNames: [] };
  }
}
