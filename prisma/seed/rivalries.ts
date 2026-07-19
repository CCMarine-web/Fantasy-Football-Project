import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

function newId(): string {
  return crypto.randomUUID();
}

interface GameRow {
  managerAId: string;
  managerBId: string;
  scoreA: number;
  scoreB: number;
  isPlayoff: boolean;
  playedAt: Date;
}

/**
 * Computes Rivalry rows purely from the matchups actually simulated —
 * every manager pair that met 3+ times across league history. Must run
 * after every season has been simulated and persisted.
 */
export async function computeRivalries(prisma: PrismaClient): Promise<void> {
  const matchupTeams = await prisma.matchupTeam.findMany({
    where: { score: { not: null } },
    include: {
      fantasyTeam: { select: { managerId: true } },
      matchup: { select: { id: true, isPlayoff: true, createdAt: true, season: { select: { year: true, id: true } } } },
    },
  });

  const byMatchup = new Map<string, typeof matchupTeams>();
  for (const mt of matchupTeams) {
    const list = byMatchup.get(mt.matchupId) ?? [];
    list.push(mt);
    byMatchup.set(mt.matchupId, list);
  }

  const games: GameRow[] = [];
  for (const teams of byMatchup.values()) {
    if (teams.length !== 2) continue;
    const [a, b] = teams;
    if (a!.score == null || b!.score == null) continue;
    games.push({
      managerAId: a!.fantasyTeam.managerId,
      managerBId: b!.fantasyTeam.managerId,
      scoreA: a!.score,
      scoreB: b!.score,
      isPlayoff: a!.matchup.isPlayoff,
      playedAt: new Date(Date.UTC(a!.matchup.season.year, 8, 1)),
    });
  }

  const pairKey = (x: string, y: string) => [x, y].sort().join("::");
  const byPair = new Map<string, GameRow[]>();
  for (const g of games) {
    const key = pairKey(g.managerAId, g.managerBId);
    const list = byPair.get(key) ?? [];
    list.push(g);
    byPair.set(key, list);
  }

  const rows: Prisma.RivalryCreateManyInput[] = [];
  for (const [key, pairGames] of byPair) {
    if (pairGames.length < 3) continue;
    const [managerAId, managerBId] = key.split("::") as [string, string];

    let aWins = 0;
    let bWins = 0;
    let ties = 0;
    let playoffMeetings = 0;
    let closest = Infinity;
    let largest = -Infinity;
    let streakManager: string | null = null;
    let streakCount = 0;

    for (const g of pairGames) {
      const isAFirst = g.managerAId === managerAId;
      const scoreForA = isAFirst ? g.scoreA : g.scoreB;
      const scoreForB = isAFirst ? g.scoreB : g.scoreA;
      const margin = Math.abs(scoreForA - scoreForB);
      if (scoreForA !== scoreForB) {
        closest = Math.min(closest, margin);
        largest = Math.max(largest, margin);
      }
      if (g.isPlayoff) playoffMeetings += 1;

      let winner: string | null = null;
      if (scoreForA > scoreForB) {
        aWins += 1;
        winner = managerAId;
      } else if (scoreForB > scoreForA) {
        bWins += 1;
        winner = managerBId;
      } else {
        ties += 1;
      }

      if (winner) {
        if (winner === streakManager) streakCount += 1;
        else {
          streakManager = winner;
          streakCount = 1;
        }
      } else {
        streakManager = null;
        streakCount = 0;
      }
    }

    const lastMeeting = pairGames[pairGames.length - 1]!;

    // Rivalry score: weight raw volume of meetings plus a bonus for playoff
    // stakes and for how closely-contested the series has been overall.
    const rivalryScore =
      pairGames.length * 2 + playoffMeetings * 5 + (closest !== Infinity ? Math.max(0, 20 - closest) : 0);

    rows.push({
      id: newId(),
      managerAId,
      managerBId,
      gamesPlayed: pairGames.length,
      managerAWins: aWins,
      managerBWins: bWins,
      ties,
      playoffMeetings,
      closestGameMargin: closest === Infinity ? null : closest,
      largestBlowoutMargin: largest === -Infinity ? null : largest,
      currentStreakManagerId: streakManager,
      currentStreakCount: streakCount,
      rivalryScore,
      lastMeetingAt: lastMeeting.playedAt,
    });
  }

  await prisma.rivalry.createMany({ data: rows });
}
