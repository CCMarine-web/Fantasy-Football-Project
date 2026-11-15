import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * INDEXING POLICY — one allowlist (Nov 2026).
 *
 * The site carries real names, photos and a punishment gallery, so search is
 * opened deliberately, page by page. Only these paths may be indexed, and only
 * on the www host, and only without a query string. Everything else is
 * `noindex, follow` (crawlable links, not listed). The proxy sends the
 * matching X-Robots-Tag header and the canonical Link header; indexable pages
 * also carry the tags in their HTML (see `pageMetadata`).
 *
 * To open another page to search, add it here — nothing else needs to change.
 */
export const INDEXABLE_PATHS = [
  "/",
  "/about",
  "/standings",
  "/power-rankings",
  "/history",
  "/records",
  "/championship-belt",
] as const;

export function siteHost(): string {
  return new URL(siteUrl()).host;
}

export function isIndexablePath(pathname: string): boolean {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (INDEXABLE_PATHS as readonly string[]).includes(clean);
}

/**
 * The X-Robots-Tag value for a request, or null when the page may be indexed.
 *   - any host but the site's (deployment and preview URLs): noindex, nofollow
 *   - an allowlisted path with no query string: indexable
 *   - everything else, including query variants: noindex, follow
 */
export function robotsHeaderFor(req: { host: string | null; pathname: string; search: string }): string | null {
  if (!req.host || req.host.toLowerCase() !== siteHost()) return "noindex, nofollow";
  if (isIndexablePath(req.pathname) && !req.search) return null;
  return "noindex, follow";
}

/** Absolute, query-free canonical URL for a path. */
export function canonicalUrl(pathname: string): string {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  return `${siteUrl()}${clean === "/" ? "/" : clean}`;
}

/**
 * Page metadata with the canonical, Open Graph URL and robots tag that the
 * allowlist implies. Titles go through the root template
 * ("%s | Rat Trap Fantasy Football") unless `absoluteTitle` is set.
 */
export function pageMetadata(
  path: string,
  { title, description, absoluteTitle }: { title: string; description: string; absoluteTitle?: boolean },
): Metadata {
  const indexable = isIndexablePath(path);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: canonicalUrl(path) },
    // Page-level openGraph replaces the root one, so the site name goes here too.
    openGraph: { url: canonicalUrl(path), title, description, siteName: "Rat Trap Fantasy Football", type: "website", locale: "en_US" },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
  };
}
