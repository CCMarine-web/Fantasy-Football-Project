import { prisma } from "@/lib/db";
import { slugify } from "@/lib/slug";
import { cached, CACHE_TAGS } from "@/server/cache";

/**
 * Resolves a /managers/[param] segment: a readable slug ("anthony-cibilich")
 * or, for links shared before slugs existed, the manager's id — which the page
 * then permanently redirects to the slug.
 */
const managerIndex = cached(
  async () => (await prisma.manager.findMany({ where: { deletedAt: null }, select: { id: true, displayName: true } })).map((m) => ({ id: m.id, slug: slugify(m.displayName) })),
  ["manager-slug-index"],
  { tags: [CACHE_TAGS.managers] },
);

export async function resolveManagerParam(param: string): Promise<{ id: string; slug: string; isLegacyId: boolean } | null> {
  const index = await managerIndex();
  const bySlug = index.find((m) => m.slug === param.toLowerCase());
  if (bySlug) return { ...bySlug, isLegacyId: false };
  const byId = index.find((m) => m.id === param);
  return byId ? { ...byId, isLegacyId: true } : null;
}

export async function allManagerSlugs(): Promise<string[]> {
  return (await managerIndex()).map((m) => m.slug);
}
