/**
 * POST-RUN SYNC-STAMP CHECK.
 *
 * The Nov 2026 audit found half the site saying "synced Nov 15, 7:33 AM" and
 * the other half "Nov 14, 8:32 PM" after a run that reached "revalidate". Every
 * stamp reads the same row, so the drift was cache: a path revalidated from a
 * route handler is only rebuilt on its NEXT visit, and that visit can still be
 * served the old page while the new one renders.
 *
 * So after revalidating, the pipeline visits every data route (which starts
 * the rebuild), waits, and reads each page's `data-synced-at` until they all
 * agree with the database — or reports which routes still disagree.
 */

/** Every data route that prints the sync stamp. */
export const STAMPED_ROUTES = [
  "/",
  "/standings",
  "/power-rankings",
  "/matchups",
  "/managers",
  "/rivalries",
  "/draft-report-cards",
  "/trade-tribunal",
  "/transactions",
  "/hall-of-shame",
  "/news",
  "/records",
  "/history",
  "/championship-belt",
  "/predictions",
] as const;

/** The `data-synced-at` value on a page, or null when it has none. */
export function parseSyncedAt(html: string): string | null {
  const m = html.match(/data-synced-at="([^"]*)"/);
  return m ? m[1] || null : null;
}

export interface StampComparison {
  ok: boolean;
  /** Routes whose stamp differs from the expected one (or is missing). */
  mismatched: { route: string; stamp: string | null }[];
}

export function compareStamps(stamps: Record<string, string | null>, expected: string | null): StampComparison {
  const mismatched = Object.entries(stamps)
    .filter(([, stamp]) => stamp !== expected)
    .map(([route, stamp]) => ({ route, stamp }));
  return { ok: mismatched.length === 0, mismatched };
}

export interface StampCheckResult extends StampComparison {
  passes: number;
  detail: string;
}

export async function checkSyncStamps(options: {
  base: string;
  expected: string | null;
  routes?: readonly string[];
  passes?: number;
  delayMs?: number;
  fetcher?: (url: string) => Promise<string | null>;
}): Promise<StampCheckResult> {
  const routes = options.routes ?? STAMPED_ROUTES;
  const passes = options.passes ?? 3;
  const delayMs = options.delayMs ?? 8000;
  const fetcher =
    options.fetcher ??
    (async (url: string) => {
      try {
        const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(20_000) });
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    });

  let last: StampComparison = { ok: false, mismatched: [] };
  for (let pass = 1; pass <= passes; pass += 1) {
    const pages = await Promise.all(routes.map(async (r) => [r, await fetcher(new URL(r, options.base).toString())] as const));
    const stamps = Object.fromEntries(pages.map(([r, html]) => [r, html == null ? null : parseSyncedAt(html)]));
    last = compareStamps(stamps, options.expected);
    if (last.ok) {
      return { ...last, passes: pass, detail: `All ${routes.length} routes report the same sync time (pass ${pass}).` };
    }
    if (pass < passes) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return {
    ...last,
    passes,
    detail: `${last.mismatched.length} of ${routes.length} routes still show a different sync time: ${last.mismatched
      .map((m) => `${m.route} (${m.stamp ?? "none"})`)
      .join(", ")}.`,
  };
}
