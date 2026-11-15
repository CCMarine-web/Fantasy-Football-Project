import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { cached, CACHE_TAGS } from "@/server/cache";
import type { LeagueClock } from "@/server/league-clock";
import type { MatchupCardData } from "@/types/view-models";

/**
 * LIVE SCORES — in-progress points for the week being played, straight from
 * Sleeper's matchups endpoint, refreshed at most every 10 minutes and stamped
 * with the time they were fetched.
 *
 * They are NEVER written to the database: stored scores exist only for final
 * weeks (that rule is what keeps an unplayed week from becoming a 0-0 result),
 * and a live number is display-only. A card shows "LIVE" only with a score and
 * an "as of" time.
 */

const LIVE_TTL_SECONDS = 600;

interface LiveSnapshot {
  asOf: string;
  /** Sleeper roster id -> points so far. */
  points: Record<string, number>;
}

async function fetchLive(leagueId: string, week: number): Promise<LiveSnapshot | null> {
  try {
    const res = await fetch(`${getEnv().SLEEPER_API_BASE_URL}/league/${leagueId}/matchups/${week}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { roster_id: number; points?: number; custom_points?: number | null }[];
    const points: Record<string, number> = {};
    for (const r of rows) points[String(r.roster_id)] = Math.round((r.custom_points ?? r.points ?? 0) * 100) / 100;
    return { asOf: new Date().toISOString(), points };
  } catch {
    return null;
  }
}

/** Live points for the current week, or null outside a live week. */
export async function getLiveScores(clock: LeagueClock | null): Promise<(LiveSnapshot & { week: number }) | null> {
  if (!clock || clock.currentWeekState !== "IN_PROGRESS" || clock.currentWeek == null) return null;
  const season = await prisma.season.findFirst({ where: { isCurrent: true }, select: { sleeperLeagueId: true } });
  if (!season?.sleeperLeagueId) return null;
  const week = clock.currentWeek;
  const snap = await cached(() => fetchLive(season.sleeperLeagueId as string, week), ["live-scores", String(week)], {
    revalidate: LIVE_TTL_SECONDS,
    tags: [CACHE_TAGS.league],
  })();
  return snap ? { ...snap, week } : null;
}

/**
 * Attaches live points to the current week's cards. Cards for other weeks, and
 * every card when there is no live snapshot, are returned unchanged.
 */
export async function withLiveScores(cards: MatchupCardData[], clock: LeagueClock | null): Promise<MatchupCardData[]> {
  const live = await getLiveScores(clock);
  if (!live || !cards.some((c) => c.week === live.week)) return cards;
  const teams = await prisma.fantasyTeam.findMany({
    where: { id: { in: cards.flatMap((c) => c.teams.map((t) => t.fantasyTeamId)) } },
    select: { id: true, sleeperRosterId: true },
  });
  const rosterOf = new Map(teams.map((t) => [t.id, t.sleeperRosterId]));
  return cards.map((c) =>
    c.week !== live.week || c.status === "FINAL"
      ? c
      : {
          ...c,
          status: "IN_PROGRESS",
          liveAsOf: live.asOf,
          teams: c.teams.map((t) => ({ ...t, liveScore: live.points[rosterOf.get(t.fantasyTeamId) ?? ""] ?? null })) as MatchupCardData["teams"],
        },
  );
}
