import { prisma } from "@/lib/db";
import { WeeklyAwardType } from "@/generated/prisma/client";

export interface WeeklyAwardView {
  type: WeeklyAwardType;
  label: string;
  managerId: string;
  managerName: string;
  value: number | null;
  description: string;
}

export const WEEKLY_AWARD_LABELS: Record<WeeklyAwardType, string> = {
  BOOM_OF_WEEK: "Boom of the Week",
  BUST_OF_WEEK: "Bust of the Week",
  BENCH_BLUNDER: "Bench Blunder",
  LUCKIEST_WIN: "Luckiest Win",
  UNLUCKIEST_LOSS: "Unluckiest Loss",
};

/**
 * Computes and stores the deterministic weekly awards for one week. Boom/Bust/
 * Luckiest/Unluckiest come from team scores; Bench Blunder needs player-level
 * data and is skipped for weeks without it. Idempotent via upsert on
 * (seasonId, week, type).
 */
export async function computeWeeklyAwards(seasonId: string, week: number): Promise<number> {
  const teams = await prisma.matchupTeam.findMany({
    where: { matchup: { seasonId, week, isPlayoff: false }, score: { not: null } },
    include: { fantasyTeam: { select: { id: true, managerId: true, manager: { select: { displayName: true } } } } },
  });
  if (teams.length === 0) return 0;

  const rows: { type: WeeklyAwardType; managerId: string; value: number; description: string }[] = [];

  const boom = teams.reduce((a, b) => (b.score! > a.score! ? b : a));
  rows.push({ type: "BOOM_OF_WEEK", managerId: boom.fantasyTeam.managerId, value: boom.score!, description: `Led the week with ${boom.score!.toFixed(1)} points.` });

  const bust = teams.reduce((a, b) => (b.score! < a.score! ? b : a));
  rows.push({ type: "BUST_OF_WEEK", managerId: bust.fantasyTeam.managerId, value: bust.score!, description: `Dead last with just ${bust.score!.toFixed(1)} points.` });

  const winners = teams.filter((t) => t.isWinner === true);
  if (winners.length) {
    const lucky = winners.reduce((a, b) => (b.score! < a.score! ? b : a));
    rows.push({ type: "LUCKIEST_WIN", managerId: lucky.fantasyTeam.managerId, value: lucky.score!, description: `Won with only ${lucky.score!.toFixed(1)} points — the week's lowest-scoring winner.` });
  }
  const losers = teams.filter((t) => t.isWinner === false);
  if (losers.length) {
    const unlucky = losers.reduce((a, b) => (b.score! > a.score! ? b : a));
    rows.push({ type: "UNLUCKIEST_LOSS", managerId: unlucky.fantasyTeam.managerId, value: unlucky.score!, description: `Scored ${unlucky.score!.toFixed(1)} and still lost — the week's highest-scoring loser.` });
  }

  // Bench Blunder (needs player-level data).
  const teamIds = teams.map((t) => t.fantasyTeam.id);
  const rosters = await prisma.roster.findMany({
    where: { fantasyTeamId: { in: teamIds }, week },
    include: { fantasyTeam: { select: { managerId: true, manager: { select: { displayName: true } } } }, playerScores: { select: { isStarter: true, points: true } } },
  });
  let worstBench: { managerId: string; value: number } | null = null;
  for (const r of rosters) {
    if (r.playerScores.length === 0) continue;
    const starters = r.playerScores.filter((p) => p.isStarter);
    const n = starters.length || 9;
    const actual = starters.reduce((a, p) => a + p.points, 0);
    const optimal = [...r.playerScores].sort((a, b) => b.points - a.points).slice(0, n).reduce((a, p) => a + p.points, 0);
    const left = optimal - actual;
    if (!worstBench || left > worstBench.value) worstBench = { managerId: r.fantasyTeam.managerId, value: left };
  }
  if (worstBench && worstBench.value > 0.5) {
    rows.push({ type: "BENCH_BLUNDER", managerId: worstBench.managerId, value: worstBench.value, description: `Left ${worstBench.value.toFixed(1)} points on the bench.` });
  }

  for (const row of rows) {
    await prisma.weeklyAward.upsert({
      where: { seasonId_week_type: { seasonId, week, type: row.type } },
      update: { managerId: row.managerId, value: row.value, description: row.description },
      create: { seasonId, week, type: row.type, managerId: row.managerId, value: row.value, description: row.description },
    });
  }
  return rows.length;
}

/** Backfills weekly awards for every week of every season that has scores. */
export async function backfillAllWeeklyAwards(): Promise<number> {
  const weeks = await prisma.matchup.findMany({
    where: { isPlayoff: false, teams: { some: { score: { not: null } } } },
    distinct: ["seasonId", "week"],
    select: { seasonId: true, week: true },
  });
  let total = 0;
  for (const w of weeks) total += await computeWeeklyAwards(w.seasonId, w.week);
  return total;
}

export async function getWeeklyAwards(seasonId: string, week: number): Promise<WeeklyAwardView[]> {
  const rows = await prisma.weeklyAward.findMany({
    where: { seasonId, week },
    include: { manager: { select: { id: true, displayName: true } } },
  });
  const order: WeeklyAwardType[] = ["BOOM_OF_WEEK", "BUST_OF_WEEK", "BENCH_BLUNDER", "LUCKIEST_WIN", "UNLUCKIEST_LOSS"];
  return rows
    .map((r) => ({ type: r.type, label: WEEKLY_AWARD_LABELS[r.type], managerId: r.manager.id, managerName: r.manager.displayName, value: r.value, description: r.description }))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

export interface AwardTally {
  type: WeeklyAwardType;
  label: string;
  count: number;
}

/** Season-long weekly-award counts for one manager (shown on their profile). */
export async function getManagerAwardTally(managerId: string): Promise<AwardTally[]> {
  const rows = await prisma.weeklyAward.groupBy({
    by: ["type"],
    where: { managerId },
    _count: { type: true },
  });
  const byType = new Map(rows.map((r) => [r.type, r._count.type]));
  const order: WeeklyAwardType[] = ["BOOM_OF_WEEK", "BUST_OF_WEEK", "BENCH_BLUNDER", "LUCKIEST_WIN", "UNLUCKIEST_LOSS"];
  return order
    .map((type) => ({ type, label: WEEKLY_AWARD_LABELS[type], count: byType.get(type) ?? 0 }))
    .filter((t) => t.count > 0);
}
