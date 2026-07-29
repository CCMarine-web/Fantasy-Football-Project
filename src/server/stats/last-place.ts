/**
 * Who finished last in a season.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The league runs a consolation bracket (the "Toilet Bowl") after the regular
 * season. It is postseason filler: the teams in it are already eliminated, half
 * of them stop setting lineups, and which of them loses the final placement
 * game is decided by two more weeks of nothing. The site used to read last
 * place off that bracket — `finalRank` — which meant the manager the league
 * remembers as having had the worst year and the manager the site called last
 * were routinely different people. In 2025 Logan Javier went 2-12 and the site
 * named Blake Mire, who went 7-7.
 *
 * Last place is therefore the bottom of the REGULAR-SEASON standings. Nothing
 * that happens in a consolation game moves it.
 *
 * ── The tiebreaker ────────────────────────────────────────────────────────
 * When the platform recorded its own standings order (`regularSeasonRank`),
 * that order is used verbatim — it is the league's real tiebreaker, whatever it
 * was. When it did not, the fallback is win percentage and then points scored,
 * and the result is labelled as a fallback so the page can say so rather than
 * implying an authority it does not have.
 */

/** How last place was decided for a given season. */
export type LastPlaceBasis = "LEAGUE_STANDINGS" | "POINTS_FALLBACK";

/** One team's regular-season line, as stored on FantasyTeam. */
export interface SeasonStandingTeam {
  managerId: string;
  managerName: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** The platform's own standings position, when it recorded one. */
  regularSeasonRank: number | null;
}

export interface LastPlaceFinish {
  year: number;
  managerId: string;
  managerName: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  /** e.g. "2-12". */
  record: string;
  pointsFor: number;
  pointsAgainst: number;
  winPct: number;
  /** How many teams the season had, so "10th of 10" can be stated. */
  teamsInSeason: number;
  basis: LastPlaceBasis;
}

export function winPercentage(t: Pick<SeasonStandingTeam, "wins" | "losses" | "ties">): number {
  const games = t.wins + t.losses + t.ties;
  return games === 0 ? 0 : (t.wins + 0.5 * t.ties) / games;
}

export function formatRecord(t: Pick<SeasonStandingTeam, "wins" | "losses" | "ties">): string {
  return `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
}

/**
 * The regular-season last-place team, or null when the season has no played
 * games. A season where the platform ranked every team is decided by that
 * ranking; otherwise by record then points, flagged as a fallback.
 */
export function findLastPlace(year: number, teams: SeasonStandingTeam[]): LastPlaceFinish | null {
  const played = teams.filter((t) => t.wins + t.losses + t.ties > 0);
  if (played.length === 0) return null;

  // The platform's order only counts if it ranked EVERY team that played —
  // a partially-ranked season would otherwise be decided by whichever teams
  // happened to carry a number.
  const fullyRanked = played.every((t) => t.regularSeasonRank != null && t.regularSeasonRank > 0);

  const basis: LastPlaceBasis = fullyRanked ? "LEAGUE_STANDINGS" : "POINTS_FALLBACK";
  const worst = fullyRanked
    ? played.reduce((a, b) => ((b.regularSeasonRank ?? 0) > (a.regularSeasonRank ?? 0) ? b : a))
    : [...played].sort(
        (a, b) => winPercentage(a) - winPercentage(b) || a.pointsFor - b.pointsFor,
      )[0];

  return {
    year,
    managerId: worst.managerId,
    managerName: worst.managerName,
    teamName: worst.teamName,
    wins: worst.wins,
    losses: worst.losses,
    ties: worst.ties,
    record: formatRecord(worst),
    pointsFor: worst.pointsFor,
    pointsAgainst: worst.pointsAgainst,
    winPct: Number(winPercentage(worst).toFixed(3)),
    teamsInSeason: played.length,
    basis,
  };
}

/** The sentence every surface that shows last place must carry. */
export const LAST_PLACE_METHODOLOGY =
  "Last place is determined by the regular-season standings, not consolation or Toilet Bowl results.";

/** The extra clause added when a season had no platform standings order. */
export const LAST_PLACE_FALLBACK_NOTE =
  "No league standings order was recorded for this season, so last place falls back to record and then points scored.";
