import { prisma } from "@/lib/db";
import { expectedWins, scheduleLuck, seasonAllPlayTotals, weeklyAllPlay } from "@/server/stats";
import type { WeeklyScore } from "@/server/stats/types";
import type { StandingsRow } from "@/types/view-models";

/**
 * ── Which games count ──────────────────────────────────────────────────────
 * All-play, expected wins and schedule luck are built from VERIFIED regular-
 * season scores only, matching every other statistic on the site. Without the
 * `verifiedScore` filter an abandoned team's run of zeros counted as nine
 * all-play losses for them and nine free wins for everyone else, so the
 * schedule-luck column disagreed with the Luck Score on the same manager's page.
 *
 * ── Before the first game ──────────────────────────────────────────────────
 * There are no standings before week 1, and pretending otherwise was a real
 * defect: every team is 0-0 with no recorded rank, the sort fell through to
 * points (all zero), and the table printed positions 1 to 10 from whatever order
 * the database happened to return. Ten managers were being told where they
 * stood, in a season nobody had played, on the strength of nothing.
 *
 * So the ordering is now explicit and stated. Actual standings the moment a
 * game is final; until then, last season's finish (which is real information),
 * falling back to alphabetical when there is no previous season to draw on.
 * `ordering` tells the page which it is looking at so it can say so and drop the
 * position column.
 */

export type StandingsOrdering = "STANDINGS" | "PRIOR_SEASON_FINISH" | "ALPHABETICAL";

export interface StandingsView {
  rows: StandingsRow[];
  ordering: StandingsOrdering;
  /** True once at least one regular-season game has a verified result. */
  hasPlayedGames: boolean;
  /** What the order means, for the table caption. */
  orderingLabel: string;
}

export async function getStandingsView(seasonId: string): Promise<StandingsView> {
  const [teams, regularSeasonMatchupTeams, season] = await Promise.all([
    prisma.fantasyTeam.findMany({ where: { seasonId }, include: { manager: true } }),
    prisma.matchupTeam.findMany({
      where: {
        matchup: { seasonId, isPlayoff: false },
        score: { not: null },
        verifiedScore: true,
      },
      include: { matchup: { select: { week: true } } },
    }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { year: true } }),
  ]);

  const weeks = new Map<number, WeeklyScore[]>();
  for (const mt of regularSeasonMatchupTeams) {
    const week = mt.matchup.week;
    const list = weeks.get(week) ?? [];
    list.push({ teamId: mt.fantasyTeamId, points: mt.score ?? 0 });
    weeks.set(week, list);
  }

  const allPlayByTeam = new Map<string, ReturnType<typeof weeklyAllPlay>>();
  for (const [week, scores] of weeks) {
    const records = weeklyAllPlay(scores, week, 0);
    for (const record of records) {
      const list = allPlayByTeam.get(record.teamId) ?? [];
      list.push(record);
      allPlayByTeam.set(record.teamId, list);
    }
  }

  const recentFormByTeam = new Map<string, ("W" | "L" | "T")[]>();
  for (const team of teams) {
    const games = regularSeasonMatchupTeams
      .filter((mt) => mt.fantasyTeamId === team.id)
      .sort((a, b) => b.matchup.week - a.matchup.week)
      .slice(0, 5)
      .map((mt): "W" | "L" | "T" => (mt.isWinner === true ? "W" : mt.isWinner === false ? "L" : "T"));
    recentFormByTeam.set(team.id, games.reverse());
  }

  const hasPlayedGames = teams.some((t) => t.wins + t.losses + t.ties > 0) || weeks.size > 0;

  /*
   * Last season's finishing order, by manager, used only as the pre-season
   * listing. `regularSeasonRank` is the league's own recorded order; a season
   * that never recorded one contributes nothing rather than a guess.
   */
  let priorFinish = new Map<string, number>();
  if (!hasPlayedGames && season) {
    const previous = await prisma.fantasyTeam.findMany({
      where: {
        season: { year: { lt: season.year }, status: { not: "UPCOMING" } },
        regularSeasonRank: { not: null },
      },
      orderBy: { season: { year: "desc" } },
      select: { managerId: true, regularSeasonRank: true, season: { select: { year: true } } },
    });
    const mostRecentYear = previous[0]?.season.year;
    if (mostRecentYear != null) {
      priorFinish = new Map(
        previous
          .filter((t) => t.season.year === mostRecentYear)
          .map((t) => [t.managerId, t.regularSeasonRank as number]),
      );
    }
  }

  const rows: StandingsRow[] = teams.map((team) => {
    const records = allPlayByTeam.get(team.id) ?? [];
    const totals = seasonAllPlayTotals(records);
    const expected = expectedWins(records);
    const luck = scheduleLuck(team.wins, records);
    const allPlayTotal = totals[0];

    return {
      fantasyTeamId: team.id,
      managerId: team.managerId,
      // Zero means "no position to report", which the table renders as a dash
      // rather than inventing one from the row index.
      rank: hasPlayedGames ? (team.regularSeasonRank ?? 0) : 0,
      teamName: team.teamName,
      managerName: team.manager.displayName,
      avatarUrl: team.manager.photoUrl ?? team.manager.avatarUrl,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      allPlayRecord: allPlayTotal
        ? `${allPlayTotal.wins}-${allPlayTotal.losses}${allPlayTotal.ties ? `-${allPlayTotal.ties}` : ""}`
        : undefined,
      expectedWins: records.length > 0 ? Number(expected.toFixed(1)) : undefined,
      scheduleLuck: records.length > 0 ? Number(luck.toFixed(1)) : undefined,
      playoffProbability: null,
      recentForm: recentFormByTeam.get(team.id) ?? [],
    };
  });

  if (hasPlayedGames) {
    rows.sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.pointsFor - a.pointsFor;
    });
    return {
      rows,
      ordering: "STANDINGS",
      hasPlayedGames: true,
      orderingLabel: "Current standings",
    };
  }

  const usePrior = priorFinish.size > 0;
  if (usePrior) {
    // A manager with no recorded finish last season (a new entrant) sorts after
    // everyone who has one, then alphabetically among themselves.
    rows.sort((a, b) => {
      const rankA = priorFinish.get(a.managerId) ?? Number.POSITIVE_INFINITY;
      const rankB = priorFinish.get(b.managerId) ?? Number.POSITIVE_INFINITY;
      return rankA - rankB || a.managerName.localeCompare(b.managerName);
    });
  } else {
    rows.sort((a, b) => a.managerName.localeCompare(b.managerName));
  }

  return {
    rows,
    ordering: usePrior ? "PRIOR_SEASON_FINISH" : "ALPHABETICAL",
    hasPlayedGames: false,
    orderingLabel: usePrior
      ? "Listed by last season's regular-season finish — not a ranking for this season"
      : "Listed alphabetically — no games have been played",
  };
}

/**
 * Rows only, for callers that just need each team's figures (the featured
 * matchup's standings positions, the hub's table). Ordering-aware callers should
 * use `getStandingsView`.
 */
export async function getStandingsForSeason(seasonId: string): Promise<StandingsRow[]> {
  return (await getStandingsView(seasonId)).rows;
}
