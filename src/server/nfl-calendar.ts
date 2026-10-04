import { getEnv } from "@/lib/env";
import { LEAGUE_CONFIG } from "@/lib/league-config";

/**
 * Where the NFL calendar is, from Sleeper's `/state/nfl`, so the season start
 * date and current week no longer need editing by hand each year.
 *
 * Cached for an hour in the Next data cache — the calendar moves once a week —
 * and bounded by a short timeout, because the homepage reads it and must not
 * wait on Sleeper. If the request fails, the hand-set
 * LEAGUE_CONFIG.nflSeasonStartDate stands in, for its own season only.
 */

export interface NflCalendar {
  /** The NFL season Sleeper is on, e.g. 2026. */
  season: number;
  /** Sleeper's season_type: "pre", "regular", "post" or "off". "unknown" on fallback. */
  seasonType: string;
  /** Sleeper's current week (leg), when known. */
  week: number | null;
  /** `YYYY-MM-DD`, the Wednesday that opens week 1 of `season`. */
  seasonStartDate: string | null;
  source: "sleeper" | "config";
}

const TIMEOUT_MS = 2500;

function configFallback(): NflCalendar {
  const start = LEAGUE_CONFIG.nflSeasonStartDate;
  return {
    season: Number(start.slice(0, 4)),
    seasonType: "unknown",
    week: null,
    seasonStartDate: start,
    source: "config",
  };
}

export async function getNflCalendar(): Promise<NflCalendar> {
  try {
    const response = await fetch(`${getEnv().SLEEPER_API_BASE_URL}/state/nfl`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return configFallback();
    const state = (await response.json()) as {
      season?: string;
      season_type?: string;
      leg?: number;
      week?: number;
      season_start_date?: string | null;
    };
    const season = Number.parseInt(state.season ?? "", 10);
    if (!Number.isFinite(season)) return configFallback();
    return {
      season,
      seasonType: state.season_type ?? "unknown",
      week: state.leg ?? state.week ?? null,
      seasonStartDate: state.season_start_date ?? null,
      source: "sleeper",
    };
  } catch {
    return configFallback();
  }
}

/**
 * The week-1 start date for a league season: Sleeper's when it is for that
 * season, else the configured fallback when that is for that season, else null.
 */
export function seasonStartDateFor(calendar: NflCalendar, seasonYear: number): string | null {
  if (calendar.season === seasonYear && calendar.seasonStartDate) return calendar.seasonStartDate;
  const fallback = LEAGUE_CONFIG.nflSeasonStartDate;
  return Number(fallback.slice(0, 4)) === seasonYear ? fallback : null;
}
