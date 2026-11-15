import { prisma } from "@/lib/db";
import { computeRankingHistory } from "@/server/repositories/power-rankings-repository";

/**
 * Stores the power ranking after each completed week.
 *
 * Weeks already snapshotted are history and are left alone — except the most
 * recent week, which is rewritten on every run so a stat correction lands. A
 * week that was never snapshotted (everything before this pipeline existed) is
 * backfilled by recomputing the model as of that week. `onlyWeek` limits the
 * write to one week (a manual backfill of a specific week).
 */
export async function snapshotPowerRankings(seasonId: string, seasonYear: number, onlyWeek?: number): Promise<number> {
  const history = await computeRankingHistory(seasonId, seasonYear);
  if (history.length === 0) return 0;
  const latest = history[history.length - 1].week;
  const existing = new Set(
    (
      await prisma.powerRankingSnapshot.findMany({
        where: { seasonYear },
        distinct: ["week"],
        select: { week: true },
      })
    ).map((r) => r.week),
  );

  let written = 0;
  for (const { week, rows } of history) {
    if (onlyWeek != null && week !== onlyWeek) continue;
    if (onlyWeek == null && existing.has(week) && week !== latest) continue;
    for (const r of rows) {
      await prisma.powerRankingSnapshot.upsert({
        where: { seasonYear_week_fantasyTeamId: { seasonYear, week, fantasyTeamId: r.fantasyTeamId } },
        create: { seasonId, seasonYear, week, fantasyTeamId: r.fantasyTeamId, rank: r.rank, score: r.score },
        update: { rank: r.rank, score: r.score, capturedAt: new Date() },
      });
      written += 1;
    }
  }
  return written;
}

/** Stored history for the rank-by-week chart, oldest week first. */
export async function getRankingHistory(seasonYear: number) {
  return prisma.powerRankingSnapshot.findMany({
    where: { seasonYear },
    orderBy: [{ week: "asc" }, { rank: "asc" }],
    select: { week: true, fantasyTeamId: true, rank: true, score: true },
  });
}
