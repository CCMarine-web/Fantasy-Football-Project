/**
 * STANDINGS ORDER — one ranker for every table, card and AI fact.
 *
 * The league runs on Sleeper's defaults: no custom tiebreaker is set in the
 * league settings, and Sleeper's default orders the table by record, then by
 * points for. So:
 *
 *   1. win percentage (a tie counts as half a win)
 *   2. points for
 *   3. points against, fewer first (only reachable on identical PF — never yet)
 *   4. team name, so the order is reproducible rather than database-dependent
 *
 * A finished season keeps the rank the platform recorded (`storedRank`), which
 * already reflects the league's own resolution; positions are computed only
 * while a season is in progress.
 */

export interface RankableTeam {
  id: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** The platform's recorded final regular-season rank, when there is one. */
  storedRank?: number | null;
}

export const STANDINGS_TIEBREAKERS = ["Win %", "Points for", "Points against (fewer)", "Team name"] as const;

export function winPct(t: Pick<RankableTeam, "wins" | "losses" | "ties">): number {
  const games = t.wins + t.losses + t.ties;
  return games === 0 ? 0 : (t.wins + 0.5 * t.ties) / games;
}

export function compareStandings(a: RankableTeam, b: RankableTeam): number {
  return (
    winPct(b) - winPct(a) ||
    b.pointsFor - a.pointsFor ||
    a.pointsAgainst - b.pointsAgainst ||
    a.name.localeCompare(b.name)
  );
}

export interface RankedTeam<T extends RankableTeam> {
  team: T;
  rank: number;
  /**
   * Which tiebreaker separated this team from the one directly above it, when
   * their win percentage was equal — so the table can say "on points for"
   * rather than leaving two identical records unexplained.
   */
  separatedBy: (typeof STANDINGS_TIEBREAKERS)[number] | null;
}

/**
 * Ranks teams 1..n. When every team has a stored rank (a completed season) the
 * stored order is used; otherwise the tiebreak order above.
 */
export function rankStandings<T extends RankableTeam>(teams: T[]): RankedTeam<T>[] {
  const useStored = teams.length > 0 && teams.every((t) => t.storedRank != null && t.storedRank > 0);
  const sorted = [...teams].sort((a, b) =>
    useStored ? (a.storedRank as number) - (b.storedRank as number) : compareStandings(a, b),
  );
  return sorted.map((team, i) => {
    const above = sorted[i - 1];
    let separatedBy: RankedTeam<T>["separatedBy"] = null;
    if (above && !useStored && winPct(above) === winPct(team)) {
      separatedBy =
        above.pointsFor !== team.pointsFor
          ? "Points for"
          : above.pointsAgainst !== team.pointsAgainst
            ? "Points against (fewer)"
            : "Team name";
    }
    return { team, rank: i + 1, separatedBy };
  });
}

/** True when a rank is inside the playoff field. */
export function isInPlayoffField(rank: number, playoffTeams: number): boolean {
  return rank >= 1 && rank <= playoffTeams;
}
