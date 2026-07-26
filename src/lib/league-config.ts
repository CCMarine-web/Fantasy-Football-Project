/**
 * League-wide config values you'll want to tweak by hand. Kept separate from
 * branding and env so non-secret, human-edited settings live in one obvious place.
 */
export const LEAGUE_CONFIG = {
  /**
   * Draft: 5:00 PM America/Chicago on September 5, 2026.
   * ISO 8601 with an explicit offset so the countdown is identical for every
   * viewer regardless of their local timezone. Early September is inside US
   * daylight saving time, so Chicago is CDT (UTC-5) on this date.
   */
  draftDate: "2026-09-05T17:00:00-05:00",

  /** IANA zone the draft time is quoted in — used to label the countdown. */
  draftTimeZone: "America/Chicago",

  /** Set false to hide the draft countdown once the draft has passed / season is live. */
  showDraftCountdown: true,

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
} as const;
