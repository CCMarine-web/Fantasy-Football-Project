/**
 * League/site branding — the single source of truth for all user-facing names
 * and taglines. Change these and the whole site (header, footer, page titles,
 * homepage hero, metadata) updates. Kept separate from the synced `League`
 * record so the masthead always renders even when the database is unavailable.
 */
export const BRAND = {
  /** Main masthead / brand name. */
  name: "The Rat Trap",
  /** Short subtitle shown under the masthead. */
  tagline: "Fantasy Football League",
  /** Inline lowercase name for use inside sentences. */
  longName: "The Rat Trap fantasy football league",
  /** One-line description used in the footer, homepage, and page metadata. */
  description:
    "The permanent record of The Rat Trap — every score, every trade, every rivalry, and every questionable lineup decision, since founding.",
} as const;
