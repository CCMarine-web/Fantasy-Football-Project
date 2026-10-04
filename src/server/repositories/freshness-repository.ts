import { prisma } from "@/lib/db";
import { cached, CACHE_TAGS } from "@/server/cache";

/**
 * How current the site's numbers are, for the "Updated through Week N" line on
 * every data page.
 *
 * Read from what is actually stored — the latest week with final scores and
 * the last sync that succeeded — never from the calendar, so a cron that stops
 * running shows up as a line that stops moving rather than as numbers quietly
 * going stale.
 */
export interface DataFreshness {
  seasonYear: number | null;
  seasonComplete: boolean;
  /** Latest week of the current season with final scores, or null before week 1. */
  throughWeek: number | null;
  /** True when that week is a postseason week. */
  throughPlayoffs: boolean;
  /** When the last successful Sleeper sync finished, ISO. */
  lastSyncAt: string | null;
}

async function loadFreshness(): Promise<DataFreshness> {
  const season =
    (await prisma.season.findFirst({ where: { isCurrent: true }, select: { id: true, year: true, status: true, playoffStartWeek: true } })) ??
    (await prisma.season.findFirst({ orderBy: { year: "desc" }, select: { id: true, year: true, status: true, playoffStartWeek: true } }));

  const [latest, sync] = await Promise.all([
    season
      ? prisma.matchup.findFirst({
          where: { seasonId: season.id, status: "FINAL", teams: { some: { score: { not: null } } } },
          orderBy: { week: "desc" },
          select: { week: true },
        })
      : null,
    prisma.dataSyncLog.findFirst({
      where: { syncType: "FULL_LEAGUE", status: "SUCCESS", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  return {
    seasonYear: season?.year ?? null,
    seasonComplete: season?.status === "COMPLETE",
    throughWeek: latest?.week ?? null,
    throughPlayoffs: latest != null && season != null && latest.week >= season.playoffStartWeek,
    lastSyncAt: sync?.finishedAt?.toISOString() ?? null,
  };
}

export const getDataFreshness = cached(loadFreshness, ["data-freshness"], { tags: [CACHE_TAGS.league] });

/** "Updated through Week 3, 2026" — or the honest alternative before week 1 / after the final. */
export function freshnessLabel(f: DataFreshness): string {
  if (f.seasonYear == null) return "No season on record yet";
  if (f.seasonComplete) return `${f.seasonYear} season complete`;
  if (f.throughWeek == null) return `${f.seasonYear} season: no games played yet`;
  return `Updated through Week ${f.throughWeek}${f.throughPlayoffs ? " (playoffs)" : ""}, ${f.seasonYear}`;
}
