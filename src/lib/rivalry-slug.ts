import { slugify } from "@/lib/slug";

/**
 * Readable rivalry URLs: "/rivalries/gavin-detillier-vs-anthony-cibilich".
 * The two names go in the order the rivalry record stores them (manager A,
 * then manager B); the reversed order still resolves, by redirect.
 */
export function rivalrySlug(managerAName: string, managerBName: string): string {
  return `${slugify(managerAName)}-vs-${slugify(managerBName)}`;
}

/** The page URL for a rivalry, by its two managers' display names. */
export function rivalryPath(managerAName: string, managerBName: string): string {
  return `/rivalries/${rivalrySlug(managerAName, managerBName)}`;
}

export interface RivalrySlugEntry {
  id: string;
  managerAName: string;
  managerBName: string;
}

export interface ResolvedRivalryParam {
  id: string;
  /** The canonical slug (A-vs-B order). */
  slug: string;
  /**
   * True when the param was not the canonical slug — an old opaque id, or the
   * names in B-vs-A order — so the page should permanently redirect to `slug`.
   */
  shouldRedirect: boolean;
}

/**
 * Resolves a /rivalries/[param] segment against every rivalry: the canonical
 * slug, the same pair named the other way round, or the rivalry's id from links
 * shared before slugs existed.
 */
export function resolveRivalryParam(entries: RivalrySlugEntry[], param: string): ResolvedRivalryParam | null {
  const wanted = param.toLowerCase();
  const indexed = entries.map((e) => ({
    id: e.id,
    slug: rivalrySlug(e.managerAName, e.managerBName),
    reversed: rivalrySlug(e.managerBName, e.managerAName),
  }));
  const exact = indexed.find((e) => e.slug === wanted);
  if (exact) return { id: exact.id, slug: exact.slug, shouldRedirect: false };
  const reversed = indexed.find((e) => e.reversed === wanted);
  if (reversed) return { id: reversed.id, slug: reversed.slug, shouldRedirect: true };
  const byId = indexed.find((e) => e.id === param);
  return byId ? { id: byId.id, slug: byId.slug, shouldRedirect: true } : null;
}
