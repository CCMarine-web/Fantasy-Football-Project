import { prisma } from "@/lib/db";
import { cached, CACHE_TAGS } from "@/server/cache";
import { replacementLevels, type ReplacementLevels } from "@/server/stats/position-value";

/**
 * Replacement level per position for one season, from every player-week with a
 * score — the same pool the Trade Tribunal builds its line from.
 */
async function load(seasonId: string): Promise<ReplacementLevels> {
  const [totals, teamCount] = await Promise.all([
    prisma.weeklyPlayerScore.groupBy({
      by: ["playerId"],
      where: { roster: { fantasyTeam: { seasonId } }, points: { not: null } },
      _sum: { points: true },
      _count: { _all: true },
    }),
    prisma.fantasyTeam.count({ where: { seasonId } }),
  ]);
  if (totals.length === 0) return {};
  const players = await prisma.fantasyPlayer.findMany({
    where: { id: { in: totals.map((t) => t.playerId) } },
    select: { id: true, position: true },
  });
  const positionOf = new Map(players.map((p) => [p.id, p.position ?? "?"]));
  return replacementLevels(
    totals.map((t) => ({ position: positionOf.get(t.playerId) ?? "?", points: t._sum.points ?? 0, games: t._count._all })),
    teamCount || 10,
  );
}

export function getReplacementLevels(seasonId: string): Promise<ReplacementLevels> {
  return cached(() => load(seasonId), ["replacement-levels", seasonId], { tags: [CACHE_TAGS.league] })();
}
