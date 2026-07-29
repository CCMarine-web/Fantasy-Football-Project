import { unstable_cache } from "next/cache";

/**
 * Server-side caching for the site's expensive, impersonal derivations.
 *
 * ── Why not route-segment caching ─────────────────────────────────────────
 * Almost every page here reads either `searchParams` (a week picker, a season
 * filter, an active/retired tab) or `cookies` via `auth()`, and both make a
 * route dynamic. `export const revalidate` is silently inert on a dynamic
 * route, so relying on it would have looked like caching without being any.
 *
 * Caching at the DATA layer works regardless: the page still renders per
 * request, but the ten-second pile of aggregate queries behind it is computed
 * once and reused. Cache Components / `use cache` is the successor to this API,
 * but it is opt-in behind the `cacheComponents` flag and turning it on changes
 * rendering semantics for every route in the app — a larger change than this
 * one needs.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Only ever wrap functions whose result depends on nothing but the database.
 * Anything that reads cookies, headers or the session must stay outside: a
 * cached admin view would be served to the public.
 */

/** Cache tags, so a sync can invalidate exactly what it changed. */
export const CACHE_TAGS = {
  /** Anything derived from matchups, scores or standings. */
  league: "league-data",
  /** Manager-level aggregates: careers, luck, rivalries. */
  managers: "manager-data",
  /** Persisted AI copy: blurbs, articles, summaries. */
  content: "generated-content",
} as const;

/** An hour. Long enough to matter, short enough that a manual sync shows up. */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * Wraps a zero-argument, database-only loader in the Next data cache.
 *
 * `keyParts` must be unique per loader — the function source is part of the
 * key, but two loaders that happen to compile identically would otherwise
 * collide.
 */
export function cached<T>(
  loader: () => Promise<T>,
  keyParts: string[],
  options: { tags?: string[]; revalidate?: number } = {},
): () => Promise<T> {
  const wrapped = unstable_cache(loader, keyParts, {
    tags: options.tags ?? [CACHE_TAGS.league],
    revalidate: options.revalidate ?? DEFAULT_TTL_SECONDS,
  });

  return async () => {
    try {
      return await wrapped();
    } catch (err) {
      /*
       * The maintenance scripts under scripts/ import these repositories
       * directly and run under plain tsx, where there is no Next request
       * context and therefore no incremental cache. `unstable_cache` throws
       * "Invariant: incrementalCache missing" in that situation, which took out
       * every script that touched a cached function — the manager-profile
       * regeneration, the blurb backfill and the audits all died on the first
       * call. Outside a Next runtime there is nothing to cache, so the honest
       * behaviour is simply to run the loader.
       */
      if (err instanceof Error && /incrementalCache missing/i.test(err.message)) {
        return loader();
      }
      throw err;
    }
  };
}
