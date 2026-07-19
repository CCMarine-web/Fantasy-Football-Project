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
} as const;
