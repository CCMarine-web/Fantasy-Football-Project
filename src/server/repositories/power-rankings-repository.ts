import { prisma } from "@/lib/db";
import {
  computeWeeklyPowerRankings,
  draftCapitalScore,
  type PowerRankingRow,
  type PowerRankingsResult,
  type TeamRankingInput,
  type WeeklyLine,
} from "@/server/stats/weekly-power-rankings";
import { getBlurbs, hashInputs, POWER_BLURB_VERSION } from "@/server/ai/blurb-cache";
import { cached, CACHE_TAGS } from "@/server/cache";

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
    // postseason would quietly reward having made it. Verified scores only, so
    // a week a team abandoned neither drags its own ranking nor inflates the
    // opponent who was scheduled against it.
    prisma.matchupTeam.findMany({
      where: { matchup: { seasonId, isPlayoff: false }, score: { not: null }, verifiedScore: true },
      select: {
        score: true,
        fantasyTeamId: true,
        matchup: {
          select: {
            week: true,
            teams: { select: { fantasyTeamId: true, score: true, verifiedScore: true } },
          },
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
      select: {
        fantasyTeamId: true,
        pickNumber: true,
        isKeeper: true,
        playerId: true,
        player: { select: { id: true, position: true } },
      },
    }),
  ]);

  // Weekly lines, keyed by team then week.
  const linesByTeam = new Map<string, Map<number, WeeklyLine>>();
  for (const team of teams) linesByTeam.set(team.id, new Map());
  for (const mt of matchupTeams) {
    if (mt.score == null) continue;
    const opponent = mt.matchup.teams.find((t) => t.fantasyTeamId !== mt.fantasyTeamId);
    if (!opponent || opponent.score == null || !opponent.verifiedScore) continue;
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
      verifiedScore: true,
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

  /*
   * Career all-play rate per manager: how often they would have beaten a
   * randomly chosen opponent in a randomly chosen prior week. It is the
   * schedule-free way to say how good a manager has been, which is a different
   * question from how much they scored — a high scorer in a weak era and a
   * modest scorer in a strong one look identical on points per game.
   */
  const priorWeekly = await prisma.matchupTeam.findMany({
    where: {
      score: { not: null },
      verifiedScore: true,
      matchup: { isPlayoff: false, season: { year: { lt: seasonYear } } },
    },
    select: {
      score: true,
      fantasyTeam: { select: { managerId: true } },
      matchup: { select: { week: true, season: { select: { year: true } } } },
    },
  });
  const weeklyBuckets = new Map<string, { managerId: string; points: number }[]>();
  for (const row of priorWeekly) {
    if (row.score == null || !row.fantasyTeam.managerId) continue;
    const key = `${row.matchup.season.year}-${row.matchup.week}`;
    const list = weeklyBuckets.get(key) ?? [];
    list.push({ managerId: row.fantasyTeam.managerId, points: row.score });
    weeklyBuckets.set(key, list);
  }
  const allPlayTally = new Map<string, { w: number; l: number; t: number }>();
  for (const bucket of weeklyBuckets.values()) {
    for (const a of bucket) {
      const rec = allPlayTally.get(a.managerId) ?? { w: 0, l: 0, t: 0 };
      for (const b of bucket) {
        if (b.managerId === a.managerId) continue;
        if (a.points > b.points) rec.w += 1;
        else if (a.points < b.points) rec.l += 1;
        else rec.t += 1;
      }
      allPlayTally.set(a.managerId, rec);
    }
  }
  const allPlayRate = new Map<string, number>();
  for (const [managerId, rec] of allPlayTally) {
    const games = rec.w + rec.l + rec.t;
    if (games > 0) allPlayRate.set(managerId, (rec.w + 0.5 * rec.t) / games);
  }

  /*
   * Per-player scoring history, used for starter quality and bench depth after
   * a draft. Deliberately NOT derived from pick position: where a player went
   * records what a draft room believed on the night, so ranking rosters by it
   * would just restate the draft order under a new name.
   */
  const draftedPlayerIds = [
    ...new Set(draftPicks.map((p) => p.playerId).filter((id): id is string => !!id)),
  ];
  const playerHistory = draftedPlayerIds.length
    ? await prisma.weeklyPlayerScore.findMany({
        where: {
          playerId: { in: draftedPlayerIds },
          points: { not: null },
          roster: { fantasyTeam: { season: { year: { lt: seasonYear } } } },
        },
        select: { playerId: true, points: true },
      })
    : [];
  const playerPoints = new Map<string, number[]>();
  for (const row of playerHistory) {
    if (row.points == null) continue;
    const list = playerPoints.get(row.playerId) ?? [];
    list.push(row.points);
    playerPoints.set(row.playerId, list);
  }
  const playerPpg = new Map<string, number>();
  for (const [playerId, points] of playerPoints) {
    const avg = meanOf(points);
    if (avg != null) playerPpg.set(playerId, avg);
  }

  /** Slots a lineup has to fill, and how many bodies count as real cover. */
  const REQUIRED_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 };

  const picksByTeamFull = new Map<string, typeof draftPicks>();
  for (const pick of draftPicks) {
    const list = picksByTeamFull.get(pick.fantasyTeamId) ?? [];
    list.push(pick);
    picksByTeamFull.set(pick.fantasyTeamId, list);
  }

  /**
   * Splits a drafted roster into the players who will start and the rest, by
   * production rather than by pick order, and reports how well the required
   * slots are covered.
   */
  function rosterShape(teamId: string) {
    const picks = picksByTeamFull.get(teamId) ?? [];
    if (picks.length === 0) {
      return { starterQuality: null, benchQuality: null, positionalBalance: null, keeperValue: null };
    }

    const withPpg = picks
      .map((p) => ({
        position: p.player?.position ?? "UNK",
        ppg: p.playerId ? (playerPpg.get(p.playerId) ?? null) : null,
        isKeeper: p.isKeeper,
      }))
      .filter((p) => p.ppg != null) as { position: string; ppg: number; isKeeper: boolean }[];

    const byPosition = new Map<string, number[]>();
    for (const p of withPpg) {
      const list = byPosition.get(p.position) ?? [];
      list.push(p.ppg);
      byPosition.set(p.position, list);
    }
    for (const list of byPosition.values()) list.sort((a, b) => b - a);

    const starters: number[] = [];
    let slotsCovered = 0;
    let slotsWithBackup = 0;
    let slotsRequired = 0;
    for (const [position, count] of Object.entries(REQUIRED_SLOTS)) {
      slotsRequired += count;
      const available = byPosition.get(position) ?? [];
      starters.push(...available.slice(0, count));
      slotsCovered += Math.min(count, available.length);
      if (available.length > count) slotsWithBackup += count;
    }

    // Whatever is left once the starting slots are filled is the bench.
    const bench = withPpg
      .map((p) => p.ppg)
      .sort((a, b) => b - a)
      .slice(starters.length);

    const keeperPoints = withPpg.filter((p) => p.isKeeper).reduce((sum, p) => sum + p.ppg, 0);

    return {
      starterQuality: starters.length > 0 ? meanOf(starters) : null,
      benchQuality: bench.length > 0 ? meanOf(bench) : null,
      // Covered slots count for most of it; a backup behind a slot is the
      // difference between depth and one injury from a hole.
      positionalBalance:
        slotsRequired > 0
          ? (slotsCovered / slotsRequired) * 0.7 + (slotsWithBackup / slotsRequired) * 0.3
          : null,
      keeperValue: withPpg.some((p) => p.isKeeper) ? keeperPoints : null,
    };
  }

  const inputs: TeamRankingInput[] = teams.map((team) => {
    const prior = team.manager?.id ? (priorByManager.get(team.manager.id) ?? []) : [];
    const picks = picksByTeam.get(team.id) ?? [];
    const rosterSize = rosterSizeByTeam.get(team.id) ?? 0;
    const shape = rosterShape(team.id);
    const draftedCount = picksByTeamFull.get(team.id)?.length ?? 0;
    return {
      fantasyTeamId: team.id,
      managerId: team.manager?.id ?? null,
      managerName: team.manager?.displayName ?? "Unknown",
      teamName: team.teamName,
      weeks: [...(linesByTeam.get(team.id)?.values() ?? [])].sort((a, b) => a.week - b.week),
      draftCapital: picks.length > 0 ? draftCapitalScore(picks) : null,
      // Before a draft there is no weekly roster either, so fall back to the
      // drafted squad size; both are null pre-draft, which is the point.
      rosterDepth:
        rosterSize > 0
          ? Math.max(0, rosterSize - STARTER_SLOTS)
          : draftedCount > 0
            ? Math.max(0, draftedCount - STARTER_SLOTS)
            : null,
      historicalPointsPerGame: meanOf(prior),
      historicalStdDev: sdOf(prior),
      managerAllPlayRate: team.manager?.id ? (allPlayRate.get(team.manager.id) ?? null) : null,
      keeperValue: shape.keeperValue,
      starterQuality: shape.starterQuality,
      benchQuality: shape.benchQuality,
      positionalBalance: shape.positionalBalance,
      // Neither platform's archived data carries published preseason
      // projections, so this stays null and its weight is redistributed.
      projectedPoints: null,
    };
  });

  const result = computeWeeklyPowerRankings(inputs);

  // One query for all commentary. The hash covers the numbers the copy is
  // written from, so a blurb is invalidated the moment the ranking moves.
  const blurbs = await getBlurbs(
    "POWER_RANKING",
    result.rows.map((r) => ({
      subjectKey: `${seasonYear}:${r.fantasyTeamId}`,
      // Must stay identical to the hash in scripts/ai/backfill-blurbs.ts, or
      // every blurb reads as stale and nothing is ever shown.
      inputHash: hashInputs({
        promptVersion: POWER_BLURB_VERSION,
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
export const getPowerRankings = cached(buildCurrentPowerRankings, ["power-rankings"], {
  tags: [CACHE_TAGS.league, CACHE_TAGS.content],
});

async function buildCurrentPowerRankings(): Promise<PowerRankingsView | null> {
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
