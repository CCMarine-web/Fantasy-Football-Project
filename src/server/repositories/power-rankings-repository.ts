import { prisma } from "@/lib/db";
import {
  computeWeeklyPowerRankings,
  draftCapitalScore,
  type PowerRankingRow,
  type PowerRankingsResult,
  type TeamRankingInput,
  type WeeklyLine,
} from "@/server/stats/weekly-power-rankings";
import { getBlurbs, hashInputs } from "@/server/ai/blurb-cache";

/**
 * Power rankings for the league's CURRENT season — a running measure of team
 * quality that updates every week, not a retrospective on a finished year.
 *
 * Two deliberate properties, unchanged from before:
 *  - The numbers come from the pure, unit-tested formula in
 *    server/stats/weekly-power-rankings.ts. Nothing here ranks anything.
 *  - Commentary is READ from AIBlurbCache. This function never calls a model,
 *    so the page renders in one round of queries. Blurbs are written by
 *    scripts/ai/backfill-blurbs.ts; a missing one simply renders nothing.
 *
 * What changed: the old version ranked the last COMPLETED season and gave 30%
 * of the score to postseason finish and 26% to win/loss record. That answered
 * "who did best last year", which is what the standings and the championship
 * pages are for. This answers "who is good right now".
 */

export interface PowerRankingView extends PowerRankingRow {
  avatarUrl: string | null;
  /** Actual W-L, shown for context only — it is not a scoring input. */
  record: string;
  /** Persisted AI commentary, or null when none has been generated. */
  blurb: string | null;
}

export interface PowerRankingsView {
  seasonYear: number;
  mode: PowerRankingsResult["mode"];
  /** 0 in preseason. */
  throughWeek: number;
  weeksCounted: number;
  rows: PowerRankingView[];
  weights: PowerRankingsResult["weights"];
  notes: string[];
}

/**
 * Builds the ranking inputs for one season. Exported so the homepage preview
 * and the full page cannot drift apart — they call the same function and show
 * the same numbers in the same order.
 */
async function buildRankings(seasonId: string, seasonYear: number): Promise<PowerRankingsView> {
  const [teams, matchupTeams, rosters, draftPicks] = await Promise.all([
    prisma.fantasyTeam.findMany({
      where: { seasonId },
      select: {
        id: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        manager: { select: { id: true, displayName: true, photoUrl: true, avatarUrl: true } },
      },
    }),
    // Regular season only: playoff teams play more games, so including the
    // postseason would quietly reward having made it.
    prisma.matchupTeam.findMany({
      where: { matchup: { seasonId, isPlayoff: false }, score: { not: null } },
      select: {
        score: true,
        fantasyTeamId: true,
        matchup: {
          select: { week: true, teams: { select: { fantasyTeamId: true, score: true } } },
        },
      },
    }),
    prisma.roster.findMany({
      where: { fantasyTeam: { seasonId } },
      select: {
        fantasyTeamId: true,
        week: true,
        playerScores: { select: { isStarter: true, points: true } },
      },
    }),
    prisma.draftPick.findMany({
      where: { draft: { seasonId } },
      select: { fantasyTeamId: true, pickNumber: true },
    }),
  ]);

  // Weekly lines, keyed by team then week.
  const linesByTeam = new Map<string, Map<number, WeeklyLine>>();
  for (const team of teams) linesByTeam.set(team.id, new Map());
  for (const mt of matchupTeams) {
    if (mt.score == null) continue;
    const opponent = mt.matchup.teams.find((t) => t.fantasyTeamId !== mt.fantasyTeamId);
    if (!opponent || opponent.score == null) continue;
    linesByTeam.get(mt.fantasyTeamId)?.set(mt.matchup.week, {
      week: mt.matchup.week,
      pointsFor: mt.score,
      pointsAgainst: opponent.score,
    });
  }

  // Player-level detail, where it exists. A roster whose scores are not all
  // recorded (the ESPN era stores membership without weekly points) is skipped
  // rather than treated as a zero-point lineup.
  const STARTER_SLOTS = 9;
  for (const roster of rosters) {
    const line = linesByTeam.get(roster.fantasyTeamId)?.get(roster.week);
    if (!line || roster.playerScores.length === 0) continue;
    const scored = roster.playerScores.filter((p): p is typeof p & { points: number } => p.points != null);
    if (scored.length !== roster.playerScores.length) continue;

    const starters = scored.filter((p) => p.isStarter);
    const bench = scored.filter((p) => !p.isStarter);
    const starterCount = starters.length || STARTER_SLOTS;
    line.starterPoints = starters.reduce((sum, p) => sum + p.points, 0);
    line.optimalPoints = [...scored]
      .sort((a, b) => b.points - a.points)
      .slice(0, starterCount)
      .reduce((sum, p) => sum + p.points, 0);
    line.benchPoints = bench.reduce((sum, p) => sum + p.points, 0);
  }

  // Preseason fallbacks: draft capital, bench depth, and the manager's own
  // scoring baseline from earlier seasons.
  const picksByTeam = new Map<string, number[]>();
  for (const pick of draftPicks) {
    const list = picksByTeam.get(pick.fantasyTeamId) ?? [];
    list.push(pick.pickNumber);
    picksByTeam.set(pick.fantasyTeamId, list);
  }
  const rosterSizeByTeam = new Map<string, number>();
  for (const roster of rosters) {
    rosterSizeByTeam.set(roster.fantasyTeamId, Math.max(rosterSizeByTeam.get(roster.fantasyTeamId) ?? 0, roster.playerScores.length));
  }

  const managerIds = teams.map((t) => t.manager?.id).filter((id): id is string => !!id);
  const priorScores = await prisma.matchupTeam.findMany({
    where: {
      score: { not: null },
      matchup: { isPlayoff: false, season: { year: { lt: seasonYear } } },
      fantasyTeam: { managerId: { in: managerIds } },
    },
    select: { score: true, fantasyTeam: { select: { managerId: true } } },
  });
  const priorByManager = new Map<string, number[]>();
  for (const row of priorScores) {
    if (row.score == null) continue;
    const list = priorByManager.get(row.fantasyTeam.managerId) ?? [];
    list.push(row.score);
    priorByManager.set(row.fantasyTeam.managerId, list);
  }
  const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sdOf = (xs: number[]) => {
    if (xs.length < 2) return null;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
  };

  const inputs: TeamRankingInput[] = teams.map((team) => {
    const prior = team.manager?.id ? (priorByManager.get(team.manager.id) ?? []) : [];
    const picks = picksByTeam.get(team.id) ?? [];
    const rosterSize = rosterSizeByTeam.get(team.id) ?? 0;
    return {
      fantasyTeamId: team.id,
      managerId: team.manager?.id ?? null,
      managerName: team.manager?.displayName ?? "Unknown",
      teamName: team.teamName,
      weeks: [...(linesByTeam.get(team.id)?.values() ?? [])].sort((a, b) => a.week - b.week),
      draftCapital: picks.length > 0 ? draftCapitalScore(picks) : null,
      rosterDepth: rosterSize > 0 ? Math.max(0, rosterSize - STARTER_SLOTS) : null,
      historicalPointsPerGame: meanOf(prior),
      historicalStdDev: sdOf(prior),
    };
  });

  const result = computeWeeklyPowerRankings(inputs);

  // One query for all commentary. The hash covers the numbers the copy is
  // written from, so a blurb is invalidated the moment the ranking moves.
  const blurbs = await getBlurbs(
    "POWER_RANKING",
    result.rows.map((r) => ({
      subjectKey: `${seasonYear}:${r.fantasyTeamId}`,
      inputHash: hashInputs({
        rank: r.rank,
        score: r.score,
        ppg: r.weightedPointsPerGame,
        allPlay: r.allPlayPct,
        exp: r.expectedWins,
        week: result.throughWeek,
        mode: result.mode,
      }),
    })),
  );

  const teamById = new Map(teams.map((t) => [t.id, t]));

  return {
    seasonYear,
    mode: result.mode,
    throughWeek: result.throughWeek,
    weeksCounted: result.weeksCounted,
    weights: result.weights,
    notes: result.notes,
    rows: result.rows.map((row) => {
      const team = teamById.get(row.fantasyTeamId);
      return {
        ...row,
        avatarUrl: team?.manager?.photoUrl ?? team?.manager?.avatarUrl ?? null,
        record: `${team?.wins ?? 0}-${team?.losses ?? 0}${team?.ties ? `-${team.ties}` : ""}`,
        blurb: blurbs.get(`${seasonYear}:${row.fantasyTeamId}`)?.text ?? null,
      };
    }),
  };
}

/**
 * Picks the season to rank: the one in progress, else the most recent season
 * that has any teams. An UPCOMING season is included on purpose — that is what
 * produces the preseason projection rather than an empty page.
 */
export async function getPowerRankings(): Promise<PowerRankingsView | null> {
  const season =
    (await prisma.season.findFirst({ where: { isCurrent: true }, select: { id: true, year: true } })) ??
    (await prisma.season.findFirst({
      where: { fantasyTeams: { some: {} } },
      orderBy: { year: "desc" },
      select: { id: true, year: true },
    }));
  if (!season) return null;
  return buildRankings(season.id, season.year);
}

/**
 * The homepage preview. Deliberately the same computation as the full page,
 * just truncated — the preview used to list the standings by points, which
 * disagreed with the actual rankings both in order and in the numbers shown.
 */
export async function getPowerRankingsPreview(limit = 5): Promise<PowerRankingsView | null> {
  const full = await getPowerRankings();
  if (!full) return null;
  return { ...full, rows: full.rows.slice(0, limit) };
}
