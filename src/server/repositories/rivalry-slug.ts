import { prisma } from "@/lib/db";
import { resolveRivalryParam, type ResolvedRivalryParam } from "@/lib/rivalry-slug";
import { cached, CACHE_TAGS } from "@/server/cache";

/**
 * Resolves a /rivalries/[param] segment: a readable slug
 * ("gavin-detillier-vs-anthony-cibilich"), the same pair in reverse order, or —
 * for links shared before slugs existed — the rivalry's id. The page
 * permanently redirects anything but the canonical slug to it.
 */
const rivalryIndex = cached(
  async () =>
    (
      await prisma.rivalry.findMany({
        where: { gamesPlayed: { gt: 0 } },
        select: { id: true, managerA: { select: { displayName: true } }, managerB: { select: { displayName: true } } },
      })
    ).map((r) => ({ id: r.id, managerAName: r.managerA.displayName, managerBName: r.managerB.displayName })),
  ["rivalry-slug-index"],
  { tags: [CACHE_TAGS.league, CACHE_TAGS.managers] },
);

export async function resolveRivalrySlugParam(param: string): Promise<ResolvedRivalryParam | null> {
  return resolveRivalryParam(await rivalryIndex(), param);
}
