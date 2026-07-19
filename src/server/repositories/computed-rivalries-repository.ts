import { prisma } from "@/lib/db";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { generateRivalryBlurb } from "@/server/ai/services/rivalry-blurb";

export interface RivalryView {
  key: string;
  managerAId: string;
  managerAName: string;
  managerBId: string;
  managerBName: string;
  gamesPlayed: number;
  aWins: number;
  bWins: number;
  ties: number;
  aPoints: number;
  bPoints: number;
  avgMargin: number;
  playoffMeetings: number;
  closest: { margin: number; year: number; week: number; winner: string } | null;
  biggest: { margin: number; year: number; week: number; winner: string } | null;
  currentStreak: string;
  rivalryScore: number;
  blurb: string;
}

const MIN_MEETINGS = 3;

interface PairGame {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aScore: number;
  bScore: number;
  year: number;
  week: number;
  isPlayoff: boolean;
}

/**
 * Computes rivalries live from synced matchups for every manager pairing with
 * at least MIN_MEETINGS games. Sorted by a rivalry score that rewards volume,
 * closeness, and playoff stakes so the most meaningful rivalries surface first.
 */
export async function getComputedRivalries(): Promise<RivalryView[]> {
  const rows = await prisma.matchupTeam.findMany({
    where: { score: { not: null } },
    include: {
      fantasyTeam: { select: { managerId: true, manager: { select: { displayName: true } } } },
      matchup: {
        select: {
          week: true,
          isPlayoff: true,
          season: { select: { year: true } },
          teams: {
            select: { fantasyTeamId: true, score: true, fantasyTeam: { select: { managerId: true, manager: { select: { displayName: true } } } } },
          },
        },
      },
    },
  });

  // Build one record per matchup (dedupe the two MatchupTeam rows) keyed by pair.
  const seenMatchup = new Set<string>();
  const byPair = new Map<string, PairGame[]>();
  for (const r of rows) {
    const teams = r.matchup.teams;
    if (teams.length !== 2 || teams.some((t) => t.score == null)) continue;
    const [t1, t2] = teams;
    const matchupKey = [t1.fantasyTeamId, t2.fantasyTeamId, r.matchup.season.year, r.matchup.week].sort().join("|");
    if (seenMatchup.has(matchupKey)) continue;
    seenMatchup.add(matchupKey);

    const m1 = t1.fantasyTeam.managerId;
    const m2 = t2.fantasyTeam.managerId;
    if (m1 === m2) continue;
    const [aId, bId] = [m1, m2].sort();
    const aIsT1 = aId === m1;
    const game: PairGame = {
      aId,
      bId,
      aName: (aIsT1 ? t1 : t2).fantasyTeam.manager.displayName,
      bName: (aIsT1 ? t2 : t1).fantasyTeam.manager.displayName,
      aScore: (aIsT1 ? t1 : t2).score!,
      bScore: (aIsT1 ? t2 : t1).score!,
      year: r.matchup.season.year,
      week: r.matchup.week,
      isPlayoff: r.matchup.isPlayoff,
    };
    const key = `${aId}::${bId}`;
    const list = byPair.get(key) ?? [];
    list.push(game);
    byPair.set(key, list);
  }

  const safeguards = await getContentSafeguards();

  const views = await Promise.all(
    [...byPair.entries()]
      .filter(([, games]) => games.length >= MIN_MEETINGS)
      .map(async ([key, games]) => {
        games.sort((x, y) => x.year - y.year || x.week - y.week);
        let aWins = 0;
        let bWins = 0;
        let ties = 0;
        let aPoints = 0;
        let bPoints = 0;
        let playoffMeetings = 0;
        let marginSum = 0;
        let closest: RivalryView["closest"] = null;
        let biggest: RivalryView["biggest"] = null;
        let streakName: string | null = null;
        let streakCount = 0;

        const { aName, bName } = games[0];
        for (const g of games) {
          aPoints += g.aScore;
          bPoints += g.bScore;
          if (g.isPlayoff) playoffMeetings += 1;
          const margin = Math.abs(g.aScore - g.bScore);
          marginSum += margin;
          const winnerName = g.aScore > g.bScore ? aName : g.bScore > g.aScore ? bName : null;
          if (g.aScore > g.bScore) aWins += 1;
          else if (g.bScore > g.aScore) bWins += 1;
          else ties += 1;
          if (winnerName) {
            if (winnerName === streakName) streakCount += 1;
            else {
              streakName = winnerName;
              streakCount = 1;
            }
          } else {
            streakName = null;
            streakCount = 0;
          }
          if (g.aScore !== g.bScore) {
            if (!closest || margin < closest.margin) closest = { margin: Number(margin.toFixed(1)), year: g.year, week: g.week, winner: winnerName! };
            if (!biggest || margin > biggest.margin) biggest = { margin: Number(margin.toFixed(1)), year: g.year, week: g.week, winner: winnerName! };
          }
        }

        const leader = aWins > bWins ? aName : bWins > aWins ? bName : null;
        const record = leader
          ? `${leader} leads ${Math.max(aWins, bWins)}-${Math.min(aWins, bWins)}${ties ? `-${ties}` : ""}`
          : `Dead even ${aWins}-${bWins}${ties ? `-${ties}` : ""}`;
        const currentStreak = streakName ? `${streakName} has won ${streakCount} straight` : "no active streak";
        const avgMargin = games.length ? marginSum / games.length : 0;
        // Rivalry score: volume + playoff stakes + closeness (tight series score higher).
        const rivalryScore = games.length * 3 + playoffMeetings * 6 + Math.max(0, 25 - avgMargin);

        const blurb = await generateRivalryBlurb(
          {
            managerA: aName,
            managerB: bName,
            record,
            gamesPlayed: games.length,
            playoffMeetings,
            closestMargin: closest?.margin ?? 0,
            biggestMargin: biggest?.margin ?? 0,
            currentStreak,
          },
          safeguards,
        );

        return {
          key,
          managerAId: games[0].aId,
          managerAName: aName,
          managerBId: games[0].bId,
          managerBName: bName,
          gamesPlayed: games.length,
          aWins,
          bWins,
          ties,
          aPoints: Number(aPoints.toFixed(1)),
          bPoints: Number(bPoints.toFixed(1)),
          avgMargin: Number(avgMargin.toFixed(1)),
          playoffMeetings,
          closest,
          biggest,
          currentStreak,
          rivalryScore: Number(rivalryScore.toFixed(1)),
          blurb,
        } satisfies RivalryView;
      }),
  );

  return views.sort((a, b) => b.rivalryScore - a.rivalryScore);
}
