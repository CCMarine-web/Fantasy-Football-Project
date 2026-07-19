import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { longestLosingStreak, longestWinningStreak } from "@/server/stats";
import type { GameResult } from "@/server/stats/types";

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Populates LeagueRecord by querying the data this seed script just
 * generated — every value here is real, not hand-authored.
 */
export async function computeLeagueRecords(prisma: PrismaClient): Promise<void> {
  const rows: Prisma.LeagueRecordCreateManyInput[] = [];

  const matchupTeams = await prisma.matchupTeam.findMany({
    where: { score: { not: null } },
    include: {
      fantasyTeam: { select: { managerId: true, teamName: true, seasonId: true } },
      matchup: { select: { id: true, week: true, season: { select: { id: true, year: true } } } },
    },
  });

  const byMatchup = new Map<string, typeof matchupTeams>();
  for (const mt of matchupTeams) {
    const list = byMatchup.get(mt.matchupId) ?? [];
    list.push(mt);
    byMatchup.set(mt.matchupId, list);
  }

  let highest = matchupTeams[0]!;
  let lowest = matchupTeams[0]!;
  let highestInLoss: (typeof matchupTeams)[number] | null = null;
  let lowestInWin: (typeof matchupTeams)[number] | null = null;
  let mostBench = matchupTeams[0]!;

  for (const mt of matchupTeams) {
    if (mt.score! > highest.score!) highest = mt;
    if (mt.score! < lowest.score!) lowest = mt;
    if (mt.isWinner === false && (!highestInLoss || mt.score! > highestInLoss.score!)) highestInLoss = mt;
    if (mt.isWinner === true && (!lowestInWin || mt.score! < lowestInWin.score!)) lowestInWin = mt;
    if ((mt.benchPoints ?? 0) > (mostBench.benchPoints ?? 0)) mostBench = mt;
  }

  rows.push({
    id: newId(),
    category: "HIGHEST_WEEKLY_SCORE",
    value: highest.score!,
    managerId: highest.fantasyTeam.managerId,
    seasonId: highest.matchup.season.id,
    week: highest.matchup.week,
    description: `${highest.score!.toFixed(1)} points in Week ${highest.matchup.week}, ${highest.matchup.season.year}.`,
  });
  rows.push({
    id: newId(),
    category: "LOWEST_WEEKLY_SCORE",
    value: lowest.score!,
    managerId: lowest.fantasyTeam.managerId,
    seasonId: lowest.matchup.season.id,
    week: lowest.matchup.week,
    description: `Just ${lowest.score!.toFixed(1)} points in Week ${lowest.matchup.week}, ${lowest.matchup.season.year}.`,
  });
  if (highestInLoss) {
    rows.push({
      id: newId(),
      category: "HIGHEST_SCORE_IN_LOSS",
      value: highestInLoss.score!,
      managerId: highestInLoss.fantasyTeam.managerId,
      seasonId: highestInLoss.matchup.season.id,
      week: highestInLoss.matchup.week,
      description: `${highestInLoss.score!.toFixed(1)} points and still lost — Week ${highestInLoss.matchup.week}, ${highestInLoss.matchup.season.year}.`,
    });
  }
  if (lowestInWin) {
    rows.push({
      id: newId(),
      category: "LOWEST_SCORE_IN_WIN",
      value: lowestInWin.score!,
      managerId: lowestInWin.fantasyTeam.managerId,
      seasonId: lowestInWin.matchup.season.id,
      week: lowestInWin.matchup.week,
      description: `Won with only ${lowestInWin.score!.toFixed(1)} points — Week ${lowestInWin.matchup.week}, ${lowestInWin.matchup.season.year}.`,
    });
  }
  rows.push({
    id: newId(),
    category: "MOST_BENCH_POINTS",
    value: mostBench.benchPoints ?? 0,
    managerId: mostBench.fantasyTeam.managerId,
    seasonId: mostBench.matchup.season.id,
    week: mostBench.matchup.week,
    description: `${(mostBench.benchPoints ?? 0).toFixed(1)} points left on the bench — Week ${mostBench.matchup.week}, ${mostBench.matchup.season.year}.`,
  });

  // Blowout / closest game — decided matchups only.
  let biggestBlowout: { margin: number; winner: (typeof matchupTeams)[number]; season: { id: string; year: number }; week: number } | null = null;
  let closestGame: { margin: number; winner: (typeof matchupTeams)[number]; season: { id: string; year: number }; week: number } | null = null;
  for (const teams of byMatchup.values()) {
    if (teams.length !== 2) continue;
    const [a, b] = teams;
    if (a!.score == null || b!.score == null || a!.score === b!.score) continue;
    const margin = Math.abs(a!.score - b!.score);
    const winner = a!.score > b!.score ? a! : b!;
    const season = winner.matchup.season;
    const week = winner.matchup.week;
    if (!biggestBlowout || margin > biggestBlowout.margin) biggestBlowout = { margin, winner, season, week };
    if (!closestGame || margin < closestGame.margin) closestGame = { margin, winner, season, week };
  }
  if (biggestBlowout) {
    rows.push({
      id: newId(),
      category: "LARGEST_BLOWOUT",
      value: biggestBlowout.margin,
      managerId: biggestBlowout.winner.fantasyTeam.managerId,
      seasonId: biggestBlowout.season.id,
      week: biggestBlowout.week,
      description: `A ${biggestBlowout.margin.toFixed(1)}-point demolition in Week ${biggestBlowout.week}, ${biggestBlowout.season.year}.`,
    });
  }
  if (closestGame) {
    rows.push({
      id: newId(),
      category: "CLOSEST_GAME",
      value: closestGame.margin,
      managerId: closestGame.winner.fantasyTeam.managerId,
      seasonId: closestGame.season.id,
      week: closestGame.week,
      description: `Decided by just ${closestGame.margin.toFixed(1)} points in Week ${closestGame.week}, ${closestGame.season.year}.`,
    });
  }

  // Most points in a season (single-season pointsFor).
  const teamsBySeason = await prisma.fantasyTeam.findMany({
    include: { season: true, manager: true },
  });
  let mostSeasonPoints = teamsBySeason[0]!;
  for (const t of teamsBySeason) {
    if (t.pointsFor > mostSeasonPoints.pointsFor) mostSeasonPoints = t;
  }
  rows.push({
    id: newId(),
    category: "MOST_POINTS_SEASON",
    value: mostSeasonPoints.pointsFor,
    managerId: mostSeasonPoints.managerId,
    seasonId: mostSeasonPoints.seasonId,
    description: `${mostSeasonPoints.pointsFor.toFixed(1)} total points in ${mostSeasonPoints.season.year}.`,
  });

  // Most championships / playoff appearances.
  const championships = await prisma.championship.findMany();
  const champCounts = new Map<string, number>();
  for (const c of championships) champCounts.set(c.championManagerId, (champCounts.get(c.championManagerId) ?? 0) + 1);
  const topChamp = [...champCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topChamp) {
    rows.push({
      id: newId(),
      category: "MOST_CHAMPIONSHIPS",
      value: topChamp[1],
      managerId: topChamp[0],
      description: `${topChamp[1]} league championship${topChamp[1] > 1 ? "s" : ""}.`,
    });
  }

  const playoffCounts = new Map<string, number>();
  for (const t of teamsBySeason) {
    if (t.madePlayoffs) playoffCounts.set(t.managerId, (playoffCounts.get(t.managerId) ?? 0) + 1);
  }
  const topPlayoff = [...playoffCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topPlayoff) {
    rows.push({
      id: newId(),
      category: "MOST_PLAYOFF_APPEARANCES",
      value: topPlayoff[1],
      managerId: topPlayoff[0],
      description: `${topPlayoff[1]} playoff appearances.`,
    });
  }

  // Win/loss streaks per manager, using the shared stats engine.
  const managerGames = new Map<string, GameResult[]>();
  for (const teams of byMatchup.values()) {
    if (teams.length !== 2) continue;
    const [a, b] = teams;
    if (a!.score == null || b!.score == null) continue;
    const result = (mt: (typeof teams)[number], other: (typeof teams)[number]): GameResult => ({
      week: mt.matchup.week,
      season: mt.matchup.season.year,
      isPlayoff: false,
      pointsFor: mt.score!,
      pointsAgainst: other.score!,
      opponentId: other.fantasyTeam.managerId,
      result: mt.score! > other.score! ? "W" : mt.score! < other.score! ? "L" : "T",
    });
    for (const [mt, other] of [
      [a!, b!],
      [b!, a!],
    ] as const) {
      const key = mt.fantasyTeam.managerId;
      const list = managerGames.get(key) ?? [];
      list.push(result(mt, other));
      managerGames.set(key, list);
    }
  }

  let bestWinStreak = { managerId: "", value: 0 };
  let bestLossStreak = { managerId: "", value: 0 };
  for (const [managerId, games] of managerGames) {
    const win = longestWinningStreak(games);
    const loss = longestLosingStreak(games);
    if (win > bestWinStreak.value) bestWinStreak = { managerId, value: win };
    if (loss > bestLossStreak.value) bestLossStreak = { managerId, value: loss };
  }
  if (bestWinStreak.managerId) {
    rows.push({
      id: newId(),
      category: "LONGEST_WIN_STREAK",
      value: bestWinStreak.value,
      managerId: bestWinStreak.managerId,
      description: `${bestWinStreak.value} consecutive wins.`,
    });
  }
  if (bestLossStreak.managerId) {
    rows.push({
      id: newId(),
      category: "LONGEST_LOSS_STREAK",
      value: bestLossStreak.value,
      managerId: bestLossStreak.managerId,
      description: `${bestLossStreak.value} consecutive losses.`,
    });
  }

  // Lineup efficiency: optimalPoints approximated as the sum of the
  // top-9 point totals among that week's full roster (starters + bench),
  // ignoring position-eligibility constraints — a reasonable proxy for
  // "points left on the bench" without needing full position-slot logic.
  const rosters = await prisma.roster.findMany({
    include: {
      fantasyTeam: { select: { managerId: true, seasonId: true, season: { select: { year: true } } } },
      playerScores: true,
    },
  });
  let bestEff: { value: number; managerId: string; seasonId: string; week: number } | null = null;
  let worstEff: { value: number; managerId: string; seasonId: string; week: number } | null = null;
  for (const roster of rosters) {
    const starterPoints = roster.playerScores.filter((p) => p.isStarter).reduce((a, p) => a + p.points, 0);
    const top9 = [...roster.playerScores].sort((a, b) => b.points - a.points).slice(0, 9);
    const optimalPoints = top9.reduce((a, p) => a + p.points, 0);
    if (optimalPoints <= 0) continue;
    const efficiency = starterPoints / optimalPoints;
    const entry = {
      value: efficiency,
      managerId: roster.fantasyTeam.managerId,
      seasonId: roster.fantasyTeam.seasonId,
      week: roster.week,
    };
    if (!bestEff || efficiency > bestEff.value) bestEff = entry;
    if (!worstEff || efficiency < worstEff.value) worstEff = entry;
  }
  if (bestEff) {
    rows.push({
      id: newId(),
      category: "BEST_LINEUP_EFFICIENCY",
      value: Number((bestEff.value * 100).toFixed(1)),
      managerId: bestEff.managerId,
      seasonId: bestEff.seasonId,
      week: bestEff.week,
      description: `${(bestEff.value * 100).toFixed(1)}% of possible lineup points started, Week ${bestEff.week}.`,
    });
  }
  if (worstEff) {
    rows.push({
      id: newId(),
      category: "WORST_LINEUP_EFFICIENCY",
      value: Number((worstEff.value * 100).toFixed(1)),
      managerId: worstEff.managerId,
      seasonId: worstEff.seasonId,
      week: worstEff.week,
      description: `Only ${(worstEff.value * 100).toFixed(1)}% of possible lineup points started, Week ${worstEff.week}.`,
    });
  }

  await prisma.leagueRecord.createMany({ data: rows });
}
