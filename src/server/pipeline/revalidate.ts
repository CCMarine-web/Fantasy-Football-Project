import { revalidatePath, revalidateTag } from "next/cache";
import { getEnv } from "@/lib/env";
import { CACHE_TAGS } from "@/server/cache";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/site-url";
import { checkSyncStamps } from "./sync-stamp-check";

/**
 * Cache refresh after a pipeline run.
 *
 * Two layers are cleared:
 *   1. the data cache — every `cached()` loader, by tag (`{ expire: 0 }`, so
 *      the next request rebuilds rather than being served last week's numbers
 *      while revalidating in the background);
 *   2. the pre-rendered (ISR) pages — every route, via the root layout.
 *
 * Both only work inside a Next.js server runtime (the cron route, an admin
 * action). A CLI run has no Next cache to touch, so it asks the deployed site
 * to do it instead (POST /api/cron/revalidate), when SITE_URL and CRON_SECRET
 * are available; otherwise the hour-long TTLs pick the change up.
 */

export const ALL_TAGS = [...Object.values(CACHE_TAGS), "sleeper-league"];

export function revalidateEverything(): string {
  for (const tag of ALL_TAGS) revalidateTag(tag, { expire: 0 });
  // Every page under the root layout — the ISR pages and their data.
  revalidatePath("/", "layout");
  return `Invalidated ${ALL_TAGS.length} cache tags and every pre-rendered page.`;
}

/** True when this code is running inside a Next.js request/route context. */
function inNextRuntime(): boolean {
  return Boolean(process.env.NEXT_RUNTIME) || process.env.__NEXT_PRIVATE_ORIGIN != null;
}

/**
 * Revalidates, then checks that every data route reports the same sync time.
 *
 * When the site's URL and CRON_SECRET are known, the revalidation runs in its
 * own request to the live site (GET /api/cron/revalidate), so it is committed
 * before the check starts; a revalidation called inside the long-running cron
 * request would only take effect when that request ends.
 */
export async function revalidateAndCheck(): Promise<{ ok: boolean; partial: boolean; detail: string }> {
  const { SITE_URL, CRON_SECRET } = getEnv();
  const base = SITE_URL || siteUrl();
  let revalidated: { ok: boolean; detail: string } | null = null;
  if (CRON_SECRET) {
    try {
      const res = await fetch(new URL("/api/cron/revalidate", base), {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) revalidated = { ok: true, detail: "Cleared the live site's caches." };
    } catch {
      // Fall back to the local path below.
    }
  }
  if (!revalidated) revalidated = await revalidateFromAnywhere();
  if (!revalidated.ok || !CRON_SECRET) return { ...revalidated, partial: false };

  const sync = await prisma.dataSyncLog.findFirst({
    where: { syncType: "FULL_LEAGUE", status: "SUCCESS", finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  const check = await checkSyncStamps({ base, expected: sync?.finishedAt?.toISOString() ?? null });
  return { ok: true, partial: !check.ok, detail: `${revalidated.detail} ${check.detail}` };
}

export async function revalidateFromAnywhere(): Promise<{ ok: boolean; detail: string }> {
  if (inNextRuntime()) {
    try {
      return { ok: true, detail: revalidateEverything() };
    } catch (err) {
      // Fall through to the remote path below.
      void err;
    }
  }
  const { SITE_URL, CRON_SECRET } = getEnv();
  if (!SITE_URL || !CRON_SECRET) {
    return {
      ok: true,
      detail:
        "Run outside the web server, and SITE_URL/CRON_SECRET aren't set here, so the live site's caches weren't cleared directly; they expire within an hour, or on the next scheduled run.",
    };
  }
  const res = await fetch(new URL("/api/cron/revalidate", SITE_URL), {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(20_000),
  });
  return res.ok
    ? { ok: true, detail: "Asked the live site to clear its caches." }
    : { ok: false, detail: `The live site's revalidate endpoint answered ${res.status}.` };
}
