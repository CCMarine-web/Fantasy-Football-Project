import { LEAGUE_CONFIG } from "./league-config";

/**
 * The configured draft date, if it belongs to `seasonYear`.
 *
 * LEAGUE_CONFIG.draftDate is edited by hand once a year. Left alone after the
 * draft, it would make next offseason's countdown run to a date already passed
 * and lock next season's predictions the moment that season exists. Matching
 * it to the season year makes a stale date behave exactly like an unset one:
 * "Draft date TBD".
 */
export function draftDateFor(seasonYear: number, configured: string | null = LEAGUE_CONFIG.draftDate): string | null {
  if (!configured) return null;
  const ms = Date.parse(configured);
  if (Number.isNaN(ms)) return null;
  const year = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: LEAGUE_CONFIG.draftTimeZone, year: "numeric" }).format(new Date(ms)),
  );
  return year === seasonYear ? configured : null;
}
