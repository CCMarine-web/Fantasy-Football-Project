import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { draftDateFor } from "@/lib/draft-date";
import { LEAGUE_CONFIG } from "@/lib/league-config";
import { nflSeasonStartDate } from "@/lib/nfl-schedule";
import { getNflCalendar } from "@/server/nfl-calendar";
import { resolveLeagueClock, type LeagueClock } from "./league-clock-core";

export type { LeagueClock, LeaguePhase } from "./league-clock-core";

/**
 * Loads every input the league clock needs and resolves it. The one place a
 * page or job should ask "what week is it?".
 *
 * Sleeper is read through the Next fetch cache (15 minutes for league
 * settings, an hour for the NFL calendar) with short timeouts; when it is
 * unreachable the clock falls back to our stored data and the calendar
 * arithmetic, never to a guess.
 */

interface SleeperLeagueState {
  status: string | null;
  lastScoredLeg: number | null;
  playoffWeekStart: number | null;
}

async function fetchSleeperLeague(leagueId: string | null | undefined): Promise<SleeperLeagueState | null> {
  if (!leagueId) return null;
  try {
    const res = await fetch(`${getEnv().SLEEPER_API_BASE_URL}/league/${leagueId}`, {
      next: { revalidate: 900, tags: ["sleeper-league"] },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const league = (await res.json()) as {
      status?: string;
      settings?: { last_scored_leg?: number; playoff_week_start?: number };
    };
    return {
      status: league.status ?? null,
      lastScoredLeg: league.settings?.last_scored_leg ?? null,
      playoffWeekStart: league.settings?.playoff_week_start ?? null,
    };
  } catch {
    return null;
  }
}

export async function getLeagueClock(nowMs: number = Date.now()): Promise<LeagueClock | null> {
  const season =
    (await prisma.season.findFirst({ where: { isCurrent: true } })) ??
    (await prisma.season.findFirst({ orderBy: { year: "desc" } }));
  if (!season) return null;

  const [lastFinal, draft, maxWeek, calendar, league] = await Promise.all([
    prisma.matchup.findFirst({
      where: { seasonId: season.id, status: "FINAL", teams: { some: { score: { not: null } } } },
      orderBy: { week: "desc" },
      select: { week: true },
    }),
    prisma.draft.findFirst({ where: { seasonId: season.id }, select: { _count: { select: { picks: true } } } }),
    prisma.matchup.findFirst({ where: { seasonId: season.id }, orderBy: { week: "desc" }, select: { week: true } }),
    getNflCalendar(),
    fetchSleeperLeague(season.sleeperLeagueId ?? process.env.SLEEPER_LEAGUE_ID),
  ]);

  return resolveLeagueClock({
    nowMs,
    seasonYear: season.year,
    seasonStatus: season.status,
    regularSeasonWeeks: season.regularSeasonWeeks,
    playoffWeekStart: season.playoffStartWeek,
    // The championship week: the last scheduled week, or three playoff rounds.
    lastWeek: Math.max(maxWeek?.week ?? 0, season.playoffStartWeek + 2),
    lastStoredFinalWeek: lastFinal?.week ?? null,
    draftPickCount: draft?._count.picks ?? 0,
    draftIso: draftDateFor(season.year),
    leagueTimeZone: LEAGUE_CONFIG.draftTimeZone,
    sleeperLeague: league,
    nflState:
      calendar.source === "sleeper"
        ? { season: calendar.season, seasonType: calendar.seasonType, leg: calendar.week, seasonStartDate: calendar.seasonStartDate }
        : null,
    fallbackSeasonStartDate: nflSeasonStartDate(season.year),
  });
}

/**
 * The database learns that a week has kicked off only at the next sync, so a
 * live week's matchups are still stored SCHEDULED. Cards take their status
 * from the clock instead: the current week reads IN_PROGRESS once kickoff has
 * passed. A FINAL status is never downgraded.
 */
export function withClockStatus<T extends { week: number; status: string }>(
  cards: T[],
  clock: LeagueClock | null,
): T[] {
  if (!clock || clock.currentWeek == null) return cards;
  return cards.map((card) =>
    card.week === clock.currentWeek && card.status === "SCHEDULED" && clock.currentWeekState === "IN_PROGRESS"
      ? { ...card, status: "IN_PROGRESS" }
      : card,
  );
}
