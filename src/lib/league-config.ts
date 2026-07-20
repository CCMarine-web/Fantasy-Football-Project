/**
 * League-wide config values you'll want to tweak by hand. Kept separate from
 * branding and env so non-secret, human-edited settings live in one obvious place.
 */
export const LEAGUE_CONFIG = {
  /**
   * ▼▼▼ CHANGE THIS to your real draft date/time. ▼▼▼
   * ISO 8601 with a timezone offset so the countdown is correct everywhere.
   * Example (7:00 PM US Central on Aug 28, 2026): "2026-08-28T19:00:00-05:00".
   * This is a PLACEHOLDER until you set the real one.
   */
  draftDate: "2026-08-28T19:00:00-05:00",

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
