import { getDataFreshness } from "@/server/repositories/freshness-repository";
import { readServerClock } from "@/server/clock";
import { skipAtDatabaselessBuild } from "@/server/build-guard";

/** In season, data older than this gets a site-wide banner. */
export const STALE_AFTER_DAYS = 8;

/**
 * A small site-wide notice when the data has stopped updating. During the
 * season the pipeline syncs every day, so a last-success older than eight days
 * means something is broken — and every number on the site is wrong in the
 * same direction. Outside the season nothing is expected to change, so it never
 * shows.
 */
export async function StalenessBanner() {
  if (await skipAtDatabaselessBuild()) return null;
  const [f, now] = await Promise.all([getDataFreshness(), readServerClock()]);
  if (!f.lastSyncAt || f.seasonComplete || f.throughWeek == null) return null;
  const ageMs = now - Date.parse(f.lastSyncAt);
  if (ageMs < STALE_AFTER_DAYS * 86_400_000) return null;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(f.lastSyncAt));
  return (
    <div role="status" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-foreground">
      Data last updated {date}.
    </div>
  );
}
