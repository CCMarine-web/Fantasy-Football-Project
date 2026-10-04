import { draftDateFor } from "./draft-date";
import { nextKickoff, weekKickoffMs } from "./nfl-schedule";

/**
 * What the homepage counts down to, by where the season is:
 *
 *   offseason / before the draft   the draft (or "Draft date TBD")
 *   regular season                 the next week's Thursday-night kickoff
 *   fantasy playoffs               the championship week's kickoff
 *   championship week under way    "live" until the season is marked complete
 *
 * Pure: the caller supplies the clock, the calendar and the league's state.
 */

export interface SeasonCountdown {
  kind: "draft" | "draft-tbd" | "kickoff" | "championship";
  /** Target instant, ISO. Null only for "draft-tbd". */
  isoDate: string | null;
  heading: string;
  passedHeading: string;
  passedMessage: string;
  /** Shown in place of the timer when there is no date. */
  tbdMessage?: string;
}

export interface SeasonCountdownInput {
  nowMs: number;
  /** The league season on record as current. */
  seasonYear: number;
  /** Sleeper has marked that season complete — the offseason has begun. */
  seasonComplete: boolean;
  /** That season's draft has happened (or its date has passed). */
  drafted: boolean;
  /** LEAGUE_CONFIG.draftDate as configured, possibly stale or null. */
  configuredDraftDate: string | null;
  /** Week-1 start date for `seasonYear`, from Sleeper or the fallback. */
  seasonStartDate: string | null;
  playoffStartWeek: number;
  championshipWeek: number;
}

function draftCountdown(iso: string | null, nowMs: number, seasonYear: number): SeasonCountdown {
  if (iso && Date.parse(iso) > nowMs) {
    return {
      kind: "draft",
      isoDate: iso,
      heading: `Countdown to the ${seasonYear} Draft`,
      passedHeading: "Draft is here",
      passedMessage: "It's draft time — good luck.",
    };
  }
  return {
    kind: "draft-tbd",
    isoDate: null,
    heading: `${seasonYear} Draft`,
    passedHeading: `${seasonYear} Draft`,
    passedMessage: "",
    tbdMessage: "Draft date TBD",
  };
}

export function chooseSeasonCountdown(input: SeasonCountdownInput): SeasonCountdown | null {
  const { nowMs, seasonYear, seasonComplete, drafted, configuredDraftDate, seasonStartDate, playoffStartWeek, championshipWeek } = input;

  if (seasonComplete) {
    const next = seasonYear + 1;
    return draftCountdown(draftDateFor(next, configuredDraftDate), nowMs, next);
  }
  if (!drafted) return draftCountdown(draftDateFor(seasonYear, configuredDraftDate), nowMs, seasonYear);
  if (!seasonStartDate) return null;

  const upcoming = nextKickoff(seasonStartDate, nowMs, championshipWeek);
  if (upcoming && upcoming.week < playoffStartWeek) {
    return {
      kind: "kickoff",
      isoDate: new Date(upcoming.kickoffMs).toISOString(),
      heading: `Countdown to Week ${upcoming.week} Kickoff`,
      passedHeading: `Week ${upcoming.week} is live`,
      passedMessage: "Games are under way.",
    };
  }

  const championshipMs = weekKickoffMs(seasonStartDate, championshipWeek);
  if (Number.isNaN(championshipMs)) return null;
  return {
    kind: "championship",
    isoDate: new Date(championshipMs).toISOString(),
    heading: "Countdown to the Championship",
    passedHeading: "Championship week",
    passedMessage: "The title is on the line.",
  };
}
