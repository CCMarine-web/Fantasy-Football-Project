/**
 * The NFL week calendar, as plain arithmetic both the server and the client
 * can call.
 *
 * Sleeper anchors each season on `season_start_date` (from `/state/nfl`): the
 * Wednesday that opens week 1. Every week after that is the same seven-day
 * window shifted along:
 *
 *   Wednesday   the week opens (waivers have just cleared)
 *   Thursday    Thursday Night Football, 8:15 PM Eastern — the week's kickoff
 *   Monday      Monday Night Football, the last game
 *   Tuesday     scoring has settled; the week is final
 *
 * The week is treated as final at 10:00 UTC on Tuesday — after the latest
 * Monday night finish and before the 12:00 UTC weekly cron, so the cron can
 * recap the week that has just ended.
 */

const EASTERN = "America/New_York";
const KICKOFF_HOUR_ET = 20;
const KICKOFF_MINUTE_ET = 15;
const FINAL_HOUR_UTC = 10;
const DAY_MS = 86_400_000;

/** UTC midnight of a `YYYY-MM-DD` date, or NaN when it does not parse. */
function utcMidnight(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Minutes the Eastern zone is offset from UTC at an instant (-240 in EDT, -300 in EST). */
function easternOffsetMinutes(atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - atMs) / 60_000);
}

/**
 * Thursday 8:15 PM Eastern of `week`, in epoch ms. Daylight saving is resolved
 * per week, so a kickoff after the November clock change is still 8:15 local.
 */
export function weekKickoffMs(seasonStartDate: string, week: number): number {
  const thursday = utcMidnight(seasonStartDate) + (7 * (week - 1) + 1) * DAY_MS;
  if (Number.isNaN(thursday)) return Number.NaN;
  const wallClock = thursday + (KICKOFF_HOUR_ET * 60 + KICKOFF_MINUTE_ET) * 60_000;
  // Wall-clock Eastern -> UTC: subtract the offset in force at (roughly) that time.
  return wallClock - easternOffsetMinutes(wallClock) * 60_000;
}

/** Tuesday 10:00 UTC after `week`'s Monday night game, in epoch ms. */
export function weekFinalMs(seasonStartDate: string, week: number): number {
  const tuesday = utcMidnight(seasonStartDate) + (7 * (week - 1) + 6) * DAY_MS;
  return tuesday + FINAL_HOUR_UTC * 3_600_000;
}

export type WeekStatus = "SCHEDULED" | "IN_PROGRESS" | "FINAL";

export interface WeekStatusInput {
  week: number;
  nowMs: number;
  /** True once Sleeper reports the league `complete`: every week is final. */
  leagueComplete: boolean;
  /** Sleeper league `settings.last_scored_leg`: weeks up to here are scored. */
  lastScoredLeg?: number | null;
  /** Sleeper `/state/nfl` `season_start_date`, when it is for this season. */
  seasonStartDate?: string | null;
  /** Sleeper's current week (`/state/nfl` `leg`), when it is for this season. */
  currentLeg?: number | null;
}

/**
 * Whether a week is unplayed, under way, or settled. Any one source saying
 * "final" is enough — Sleeper's own scored-leg marker, the league being
 * complete, or the calendar having passed Tuesday morning — because the cost
 * of calling a finished week unfinished is only a day's delay, while the cost
 * of calling an unplayed week final is a 0-0 "result" in the record books.
 */
export function deriveWeekStatus(input: WeekStatusInput): WeekStatus {
  const { week, nowMs, leagueComplete, lastScoredLeg, seasonStartDate, currentLeg } = input;
  if (leagueComplete) return "FINAL";
  if (lastScoredLeg != null && week <= lastScoredLeg) return "FINAL";
  if (seasonStartDate) {
    const finalAt = weekFinalMs(seasonStartDate, week);
    if (!Number.isNaN(finalAt)) {
      if (nowMs >= finalAt) return "FINAL";
      // Games in a week start before Thursday night in rare cases (a
      // Wednesday opener, an international Friday) — the Wednesday the week
      // opens is a safe lower bound for "under way".
      const opensAt = utcMidnight(seasonStartDate) + 7 * (week - 1) * DAY_MS;
      return nowMs >= opensAt ? "IN_PROGRESS" : "SCHEDULED";
    }
  }
  if (currentLeg != null) return week < currentLeg ? "FINAL" : week === currentLeg ? "IN_PROGRESS" : "SCHEDULED";
  return "SCHEDULED";
}

/** The first week whose kickoff is still ahead of `nowMs`, or null past `lastWeek`. */
export function nextKickoff(
  seasonStartDate: string,
  nowMs: number,
  lastWeek: number,
): { week: number; kickoffMs: number } | null {
  for (let week = 1; week <= lastWeek; week += 1) {
    const kickoffMs = weekKickoffMs(seasonStartDate, week);
    if (Number.isNaN(kickoffMs)) return null;
    if (kickoffMs > nowMs) return { week, kickoffMs };
  }
  return null;
}

/**
 * The Wednesday that opens week 1 of an NFL season: two days after Labor Day
 * (the first Monday in September). Matches Sleeper's season_start_date for
 * the seasons it reports (2025-09-03, 2026-09-09), and works for past seasons
 * Sleeper's calendar no longer describes.
 */
export function nflSeasonStartDate(year: number): string {
  const sept1 = new Date(Date.UTC(year, 8, 1));
  const laborDay = 1 + ((8 - sept1.getUTCDay()) % 7);
  const start = new Date(Date.UTC(year, 8, laborDay + 2));
  return start.toISOString().slice(0, 10);
}

/** Early Tuesday (04:00 UTC) after `week`'s Monday night game — when that week's last result is in. */
export function weekEndMs(seasonStartDate: string, week: number): number {
  return utcMidnight(seasonStartDate) + (7 * (week - 1) + 6) * DAY_MS + 4 * 3_600_000;
}
