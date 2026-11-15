import { weekKickoffMs, weekFinalMs } from "@/lib/nfl-schedule";

/**
 * THE LEAGUE CLOCK — pure resolution of "where is the league right now".
 *
 * Every page, card, job and AI fact that chooses a week goes through
 * `resolveLeagueClock` (via `getLeagueClock` in league-clock.ts). Three separate
 * derivations used to disagree: the homepage read the highest FINAL week and
 * called the next one "Upcoming" while it was being played; the countdown read
 * Sleeper's calendar; the season phase read the highest scored week.
 *
 * ── Inputs, in order of trust ─────────────────────────────────────────────
 *   Sleeper league      status (pre_draft / drafting / in_season / complete),
 *                       last_scored_leg, playoff_week_start
 *   Sleeper /state/nfl  season, season_type, leg, season_start_date
 *   Our database        the last week with final scores stored, draft picks
 *   Config              the draft date, the season-start fallback
 *
 * ── Phases ────────────────────────────────────────────────────────────────
 *   OFFSEASON       the last season is done and the next draft isn't close
 *   PRE_DRAFT       the new season exists; the draft hasn't happened
 *   DRAFT_DAY       the draft is today (league time) or Sleeper says drafting
 *   REGULAR_SEASON  drafted; current week is before playoff_week_start
 *   PLAYOFFS        current week is a playoff week
 *   COMPLETE        the championship is final (until the NFL offseason)
 */

export type LeaguePhase = "OFFSEASON" | "PRE_DRAFT" | "DRAFT_DAY" | "REGULAR_SEASON" | "PLAYOFFS" | "COMPLETE";

export interface LeagueClockInput {
  nowMs: number;
  seasonYear: number;
  /** Our season row's status. */
  seasonStatus: "UPCOMING" | "IN_PROGRESS" | "COMPLETE";
  regularSeasonWeeks: number;
  playoffWeekStart: number;
  /** Last week of the fantasy season (the championship week). */
  lastWeek: number;
  /** Highest week with FINAL scores stored in our database, or null. */
  lastStoredFinalWeek: number | null;
  draftPickCount: number;
  /** ISO draft date for this season, or null when none is scheduled. */
  draftIso: string | null;
  /** IANA zone the league lives in (US Central). */
  leagueTimeZone: string;
  sleeperLeague?: {
    status?: string | null;
    lastScoredLeg?: number | null;
    playoffWeekStart?: number | null;
  } | null;
  nflState?: {
    season: number;
    seasonType: string;
    leg: number | null;
    seasonStartDate: string | null;
  } | null;
  /** Wednesday that opens week 1 when Sleeper can't say. */
  fallbackSeasonStartDate: string | null;
}

export type WeekState = "UPCOMING" | "IN_PROGRESS";

export interface LeagueClock {
  seasonYear: number;
  phase: LeaguePhase;
  /** The last week whose games are all final, per Sleeper or our data. */
  lastCompletedWeek: number | null;
  /** The last completed week whose scores are actually stored (what pages can show). */
  lastStoredWeek: number | null;
  /** True when Sleeper has scored a week we haven't synced yet. */
  syncBehind: boolean;
  /** The week being played or next to be played; null outside the season. */
  currentWeek: number | null;
  currentWeekState: WeekState | null;
  /** Kickoff of `currentWeek`, epoch ms, when the calendar is known. */
  currentWeekKickoffMs: number | null;
  regularSeasonWeeks: number;
  playoffWeekStart: number;
  lastWeek: number;
  /** Regular-season weeks still to be completed (0 once the regular season is over). */
  regularWeeksRemaining: number;
  /** The week the homepage and the Matchups hub should open on. */
  focusWeek: number | null;
  /** What focusWeek shows: this week's slate, or last week's results. */
  focus: "SLATE" | "RESULTS" | null;
  seasonStartDate: string | null;
  /** Human label, e.g. "Week 10 · in progress", "Draft day". */
  label: string;
  nowMs: number;
}

function sameLocalDay(aMs: number, bMs: number, timeZone: string): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(aMs)) === f.format(new Date(bMs));
}

export function resolveLeagueClock(input: LeagueClockInput): LeagueClock {
  const {
    nowMs,
    seasonYear,
    seasonStatus,
    regularSeasonWeeks,
    lastWeek,
    lastStoredFinalWeek,
    draftPickCount,
    draftIso,
    leagueTimeZone,
    sleeperLeague,
    nflState,
  } = input;
  const playoffWeekStart = sleeperLeague?.playoffWeekStart ?? input.playoffWeekStart;
  const nflIsThisSeason = nflState != null && nflState.season === seasonYear;
  const seasonStartDate = (nflIsThisSeason ? nflState?.seasonStartDate : null) ?? input.fallbackSeasonStartDate;

  // ── Last completed week: any trustworthy source saying "final" is enough.
  let lastCompleted = lastStoredFinalWeek ?? 0;
  if (sleeperLeague?.lastScoredLeg != null && sleeperLeague.lastScoredLeg > 0) {
    lastCompleted = Math.max(lastCompleted, Math.min(sleeperLeague.lastScoredLeg, lastWeek));
  }
  if (seasonStartDate) {
    for (let w = lastCompleted + 1; w <= lastWeek; w += 1) {
      const finalAt = weekFinalMs(seasonStartDate, w);
      if (Number.isNaN(finalAt) || nowMs < finalAt) break;
      lastCompleted = w;
    }
  }
  const leagueComplete = sleeperLeague?.status === "complete" || seasonStatus === "COMPLETE";
  if (leagueComplete) lastCompleted = Math.max(lastCompleted, lastStoredFinalWeek ?? 0);
  const lastCompletedWeek = lastCompleted > 0 ? lastCompleted : null;

  const drafted = draftPickCount > 0 || (sleeperLeague?.status != null && ["in_season", "complete"].includes(sleeperLeague.status));

  // ── Current week: the one after the last completed, until the season ends.
  let currentWeek: number | null = null;
  let currentWeekState: WeekState | null = null;
  let currentWeekKickoffMs: number | null = null;
  const seasonOver = leagueComplete || (lastCompletedWeek != null && lastCompletedWeek >= lastWeek);
  if (!seasonOver && (drafted || (lastCompletedWeek ?? 0) > 0)) {
    currentWeek = Math.min((lastCompletedWeek ?? 0) + 1, lastWeek);
    if (seasonStartDate) {
      const kickoff = weekKickoffMs(seasonStartDate, currentWeek);
      currentWeekKickoffMs = Number.isNaN(kickoff) ? null : kickoff;
      currentWeekState = currentWeekKickoffMs != null && nowMs >= currentWeekKickoffMs ? "IN_PROGRESS" : "UPCOMING";
    } else if (nflIsThisSeason && nflState?.leg != null) {
      currentWeekState = nflState.leg >= currentWeek ? "IN_PROGRESS" : "UPCOMING";
    } else {
      currentWeekState = "UPCOMING";
    }
  }

  // ── Phase.
  let phase: LeaguePhase;
  if (seasonOver) {
    // COMPLETE through the NFL postseason; OFFSEASON once the NFL is off too.
    const nflStillPlaying = nflIsThisSeason && (nflState?.seasonType === "post" || nflState?.seasonType === "regular");
    const lastFinalMs = seasonStartDate ? weekFinalMs(seasonStartDate, lastWeek) : Number.NaN;
    const recentlyDone = !Number.isNaN(lastFinalMs) && nowMs - lastFinalMs < 45 * 86_400_000;
    phase = nflStillPlaying || recentlyDone || Number.isNaN(lastFinalMs) ? "COMPLETE" : "OFFSEASON";
  } else if (!drafted && (lastCompletedWeek ?? 0) === 0) {
    const draftMs = draftIso ? Date.parse(draftIso) : Number.NaN;
    if (sleeperLeague?.status === "drafting" || (!Number.isNaN(draftMs) && sameLocalDay(nowMs, draftMs, leagueTimeZone))) {
      phase = "DRAFT_DAY";
    } else if (sleeperLeague?.status === "pre_draft" || (!Number.isNaN(draftMs) && draftMs > nowMs) || seasonStatus === "UPCOMING") {
      phase = "PRE_DRAFT";
    } else {
      phase = "OFFSEASON";
    }
  } else {
    phase = currentWeek != null && currentWeek >= playoffWeekStart ? "PLAYOFFS" : "REGULAR_SEASON";
  }

  // ── What a hub should open on: the live slate while games are being
  // played; last week's results from the moment MNF is final until the next
  // kickoff; week 1's slate before the season starts.
  let focusWeek: number | null = null;
  let focus: LeagueClock["focus"] = null;
  if (phase === "REGULAR_SEASON" || phase === "PLAYOFFS") {
    if (currentWeekState === "IN_PROGRESS" || lastCompletedWeek == null) {
      focusWeek = currentWeek;
      focus = "SLATE";
    } else {
      // Results can only be shown once they're stored; if Sleeper is a sync
      // ahead of us, show the last week we actually have.
      focusWeek = lastStoredFinalWeek ?? lastCompletedWeek;
      focus = "RESULTS";
    }
  } else if (phase === "COMPLETE" && lastCompletedWeek != null) {
    focusWeek = lastStoredFinalWeek ?? lastCompletedWeek;
    focus = "RESULTS";
  }

  const regularWeeksRemaining = Math.max(0, regularSeasonWeeks - Math.min(lastCompletedWeek ?? 0, regularSeasonWeeks));

  const label =
    phase === "REGULAR_SEASON" || phase === "PLAYOFFS"
      ? `Week ${currentWeek}${currentWeekState === "IN_PROGRESS" ? " · in progress" : " · up next"}`
      : phase === "DRAFT_DAY"
        ? "Draft day"
        : phase === "PRE_DRAFT"
          ? `${seasonYear} pre-draft`
          : phase === "COMPLETE"
            ? `${seasonYear} season complete`
            : `${seasonYear} offseason`;

  return {
    seasonYear,
    phase,
    lastCompletedWeek,
    lastStoredWeek: lastStoredFinalWeek,
    syncBehind: lastCompletedWeek != null && (lastStoredFinalWeek ?? 0) < lastCompletedWeek,
    currentWeek,
    currentWeekState,
    currentWeekKickoffMs,
    regularSeasonWeeks,
    playoffWeekStart,
    lastWeek,
    regularWeeksRemaining,
    focusWeek,
    focus,
    seasonStartDate,
    label,
    nowMs,
  };
}
