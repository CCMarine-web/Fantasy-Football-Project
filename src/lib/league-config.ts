/**
 * League-wide config values you'll want to tweak by hand. Kept separate from
 * branding and env so non-secret, human-edited settings live in one obvious place.
 */
export interface LeagueConfig {
  /**
   * The next draft, ISO 8601 with an explicit offset, or null when it has not
   * been scheduled. It only counts for the season whose year it falls in, so
   * last year's date left in place reads as "Draft date TBD", never as a
   * countdown to the past (see src/lib/draft-date.ts).
   */
  draftDate: string | null;
  /** IANA zone the draft time is quoted in — used to label the countdown. */
  draftTimeZone: string;
  /**
   * Show the homepage countdown: to the draft in the offseason, to the next
   * week's kickoff in the regular season, and to the championship in the
   * playoffs (see src/lib/season-countdown.ts).
   */
  showDraftCountdown: boolean;
  /**
   * FALLBACK ONLY. The Wednesday that opens NFL week 1. The live value comes
   * from Sleeper's `/state/nfl` (`season_start_date`) — this is used only when
   * that request fails, and only for the season whose year it falls in.
   */
  nflSeasonStartDate: string;
  shameCounter: { enabled: boolean; managerName: string; eventLabel: string; sinceDate: string };
  /**
   * The voice of every AI-written piece (see src/server/ai/voice.ts and
   * VOICE-GUIDE.md).
   *   mode: "classic" is the voice that has been live all along; "unhinged" is
   *         the new one. Stays "classic" until the samples in VOICE-GUIDE.md
   *         are approved — the weekly cron publishes in whatever this says.
   *   spiceLevel: for the unhinged voice — 1 = PG-13, 2 = R, 3 = unhinged.
   * AI_VOICE and SPICE_LEVEL env vars override both (used to write samples).
   */
  voice: { mode: "classic" | "unhinged"; spiceLevel: 1 | 2 | 3 };
}

export const LEAGUE_CONFIG: LeagueConfig = {
  /**
   * Draft: 5:00 PM America/Chicago on September 5, 2026.
   * ISO 8601 with an explicit offset so the countdown is identical for every
   * viewer regardless of their local timezone. Early September is inside US
   * daylight saving time, so Chicago is CDT (UTC-5) on this date.
   * Set to next year's draft once it is scheduled, or null.
   */
  draftDate: "2026-09-05T17:00:00-05:00",

  draftTimeZone: "America/Chicago",

  showDraftCountdown: true,

  nflSeasonStartDate: "2026-09-09",

  /**
   * "Days since…" shame counter shown on the Championship Belt page. A bit of
   * good-natured trash talk: a live-updating tally of how long it's been since
   * some manager did (or failed to do) a notable thing.
   *
   * ▼▼▼ CHANGE THESE to your real target. ▼▼▼ These are PLACEHOLDERS.
   * Example rendered line: "1,284 days since Anthony last won a playoff game".
   *   - managerName: whose drought this is (display only — not a DB lookup).
   *   - eventLabel:  the rest of the sentence after the manager's name.
   *   - sinceDate:   ISO 8601 date the clock counts up from.
   * Set `enabled: false` to hide the card entirely.
   */
  shameCounter: {
    enabled: false,
    managerName: "Someone",
    eventLabel: "last won a playoff game",
    sinceDate: "2021-12-27T00:00:00Z",
  },

  voice: { mode: "classic", spiceLevel: 3 },
};
