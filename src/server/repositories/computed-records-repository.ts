import { prisma } from "@/lib/db";
import { longestLosingStreak, longestWinningStreak } from "@/server/stats";
import type { GameResult } from "@/server/stats/types";

export interface RecordEntry {
  key: string;
  label: string;
  value: string;
  holderName: string;
  holderManagerId: string | null;
  detail: string;
}

interface Mt {
  fantasyTeamId: string;
  managerId: string;
  managerName: string;
  score: number;
  isWinner: boolean | null;
  week: number;
  year: number;
  isPlayoff: boolean;
  seasonId: string;
  opponentTeamId: string;
  opponentName: string;
  opponentScore: number;
}

/**
 * Computes every league record live from the synced matchup data (works across
 * all seasons regardless of source). Each entry carries the holder, value, and
 * where/against-whom context. Returns [] when there are no scored games.
 */
export async function getComputedRecords(): Promise<RecordEntry[]> {
  const rows = await prisma.matchupTeam.findMany({
    where: { score: { not: null } },
    include: {
      fantasyTeam: { select: { managerId: true, manager: { select: { displayName: true } } } },
      matchup: {
        select: {
          week: true,
          isPlayoff: true,
          seasonId: true,
          season: { select: { year: true } },
          teams: {
            select: {
              fantasyTeamId: true,
              score: true,
              fantasyTeam: { select: { manager: { select: { displayName: true } } } },
            },
          },
        },
      },
    },
  });

  const games: Mt[] = [];
  for (const r of rows) {
    if (r.score == null) continue;
    const opp = r.matchup.teams.find((t) => t.fantasyTeamId !== r.fantasyTeamId);
    if (!opp || opp.score == null) continue;
    games.push({
      fantasyTeamId: r.fantasyTeamId,
      managerId: r.fantasyTeam.managerId,
      managerName: r.fantasyTeam.manager.displayName,
      score: r.score,
      isWinner: r.isWinner,
      week: r.matchup.week,
      year: r.matchup.season.year,
      isPlayoff: r.matchup.isPlayoff,
      seasonId: r.matchup.seasonId,
      opponentTeamId: opp.fantasyTeamId,
      opponentName: opp.fantasyTeam.manager.displayName,
      opponentScore: opp.score,
    });
  }
  if (games.length === 0) return [];

  const entries: RecordEntry[] = [];
  const where = (g: Mt) => `Week ${g.week}, ${g.year}`;
  const vs = (g: Mt) => `vs ${g.opponentName} · ${where(g)}`;

  // Highest / lowest single-game score.
  const highest = games.reduce((a, b) => (b.score > a.score ? b : a));
  const lowest = games.reduce((a, b) => (b.score < a.score ? b : a));
  entries.push({ key: "high-game", label: "Highest Single-Game Score", value: highest.score.toFixed(1), holderName: highest.managerName, holderManagerId: highest.managerId, detail: vs(highest) });
  entries.push({ key: "low-game", label: "Lowest Single-Game Score", value: lowest.score.toFixed(1), holderName: lowest.managerName, holderManagerId: lowest.managerId, detail: vs(lowest) });

  // Highest scoring loss / lowest scoring win.
  const losses = games.filter((g) => g.isWinner === false);
  const wins = games.filter((g) => g.isWinner === true);
  if (losses.length) {
    const hl = losses.reduce((a, b) => (b.score > a.score ? b : a));
    entries.push({ key: "high-loss", label: "Highest Score in a Loss", value: hl.score.toFixed(1), holderName: hl.managerName, holderManagerId: hl.managerId, detail: `lost ${hl.score.toFixed(1)}–${hl.opponentScore.toFixed(1)} to ${hl.opponentName} · ${where(hl)}` });
  }
  if (wins.length) {
    const lw = wins.reduce((a, b) => (b.score < a.score ? b : a));
    entries.push({ key: "low-win", label: "Lowest Score in a Win", value: lw.score.toFixed(1), holderName: lw.managerName, holderManagerId: lw.managerId, detail: `won ${lw.score.toFixed(1)}–${lw.opponentScore.toFixed(1)} over ${lw.opponentName} · ${where(lw)}` });
  }

  // Biggest blowout / closest game (from the winner's perspective, decided games).
  const decidedWins = wins.filter((g) => g.score !== g.opponentScore);
  if (decidedWins.length) {
    const blow = decidedWins.reduce((a, b) => (b.score - b.opponentScore > a.score - a.opponentScore ? b : a));
    const close = decidedWins.reduce((a, b) => (b.score - b.opponentScore < a.score - a.opponentScore ? b : a));
    entries.push({ key: "blowout", label: "Biggest Blowout", value: `${(blow.score - blow.opponentScore).toFixed(1)} pts`, holderName: blow.managerName, holderManagerId: blow.managerId, detail: `${blow.score.toFixed(1)}–${blow.opponentScore.toFixed(1)} over ${blow.opponentName} · ${where(blow)}` });
    entries.push({ key: "closest", label: "Closest Game", value: `${(close.score - close.opponentScore).toFixed(2)} pts`, holderName: close.managerName, holderManagerId: close.managerId, detail: `${close.score.toFixed(1)}–${close.opponentScore.toFixed(1)} over ${close.opponentName} · ${where(close)}` });
  }

  // Single-week league-wide scoring record (most total points in one week).
  const weekTotals = new Map<string, { year: number; week: number; total: number }>();
  for (const g of games) {
    const key = `${g.year}-${g.week}`;
    const cur = weekTotals.get(key) ?? { year: g.year, week: g.week, total: 0 };
    cur.total += g.score;
    weekTotals.set(key, cur);
  }
  const topWeek = [...weekTotals.values()].reduce((a, b) => (b.total > a.total ? b : a));
  entries.push({ key: "league-week", label: "Highest-Scoring Week (League-Wide)", value: topWeek.total.toFixed(1), holderName: "The whole league", holderManagerId: null, detail: `Week ${topWeek.week}, ${topWeek.year}` });

  // Season records: most points in a season, best / worst record.
  const teams = await prisma.fantasyTeam.findMany({
    where: { OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }, { pointsFor: { gt: 0 } }] },
    include: { manager: { select: { id: true, displayName: true } }, season: { select: { year: true } } },
  });
  if (teams.length) {
    const mostPts = teams.reduce((a, b) => (b.pointsFor > a.pointsFor ? b : a));
    entries.push({ key: "season-points", label: "Most Points in a Season", value: mostPts.pointsFor.toFixed(1), holderName: mostPts.manager.displayName, holderManagerId: mostPts.manager.id, detail: `${mostPts.season.year} season` });
    const pct = (t: (typeof teams)[number]) => {
      const g = t.wins + t.losses + t.ties;
      return g ? (t.wins + 0.5 * t.ties) / g : 0;
    };
    const best = teams.reduce((a, b) => (pct(b) > pct(a) ? b : a));
    const worst = teams.reduce((a, b) => (pct(b) < pct(a) ? b : a));
    entries.push({ key: "best-record", label: "Best Season Record", value: `${best.wins}-${best.losses}${best.ties ? `-${best.ties}` : ""}`, holderName: best.manager.displayName, holderManagerId: best.manager.id, detail: `${best.season.year} · ${best.pointsFor.toFixed(0)} PF` });
    entries.push({ key: "worst-record", label: "Worst Season Record", value: `${worst.wins}-${worst.losses}${worst.ties ? `-${worst.ties}` : ""}`, holderName: worst.manager.displayName, holderManagerId: worst.manager.id, detail: `${worst.season.year} · ${worst.pointsFor.toFixed(0)} PF` });
  }

  // Longest win / loss streaks all-time (per manager, across career).
  const logByManager = new Map<string, { name: string; games: GameResult[] }>();
  for (const g of games) {
    const e = logByManager.get(g.managerId) ?? { name: g.managerName, games: [] };
    e.games.push({ week: g.week, season: g.year, isPlayoff: g.isPlayoff, pointsFor: g.score, pointsAgainst: g.opponentScore, opponentId: g.opponentTeamId, result: g.isWinner === true ? "W" : g.isWinner === false ? "L" : "T" });
    logByManager.set(g.managerId, e);
  }
  let bestWin = { id: "", name: "", len: 0 };
  let bestLoss = { id: "", name: "", len: 0 };
  for (const [id, e] of logByManager) {
    const w = longestWinningStreak(e.games);
    const l = longestLosingStreak(e.games);
    if (w > bestWin.len) bestWin = { id, name: e.name, len: w };
    if (l > bestLoss.len) bestLoss = { id, name: e.name, len: l };
  }
  if (bestWin.len) entries.push({ key: "win-streak", label: "Longest Win Streak", value: `${bestWin.len} games`, holderName: bestWin.name, holderManagerId: bestWin.id, detail: "all-time" });
  if (bestLoss.len) entries.push({ key: "loss-streak", label: "Longest Losing Streak", value: `${bestLoss.len} games`, holderName: bestLoss.name, holderManagerId: bestLoss.id, detail: "all-time" });

  // Championships + championship-game records + best low-seed run.
  const championships = await prisma.championship.findMany({
    include: {
      championManager: { select: { id: true, displayName: true } },
      championFantasyTeam: { select: { id: true, regularSeasonRank: true } },
      runnerUpFantasyTeam: { select: { id: true } },
      season: { select: { year: true } },
    },
  });
  if (championships.length) {
    const titleCounts = new Map<string, { name: string; count: number }>();
    for (const c of championships) {
      const e = titleCounts.get(c.championManagerId) ?? { name: c.championManager.displayName, count: 0 };
      e.count += 1;
      titleCounts.set(c.championManagerId, e);
    }
    const topTitles = [...titleCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    entries.push({ key: "most-titles", label: "Most Championships", value: `${topTitles[1].count}`, holderName: topTitles[1].name, holderManagerId: topTitles[0], detail: "all-time" });

    // Highest-scoring championship game: the playoff matchup pairing champion & runner-up.
    let bestChampGame: { total: number; year: number; a: string; b: string; managerId: string } | null = null;
    for (const c of championships) {
      if (!c.runnerUpFantasyTeamId) continue;
      const champGame = games.find(
        (g) =>
          g.isPlayoff &&
          g.seasonId === c.seasonId &&
          ((g.fantasyTeamId === c.championFantasyTeamId && g.opponentTeamId === c.runnerUpFantasyTeamId) ||
            (g.fantasyTeamId === c.runnerUpFantasyTeamId && g.opponentTeamId === c.championFantasyTeamId)),
      );
      if (champGame) {
        const total = champGame.score + champGame.opponentScore;
        if (!bestChampGame || total > bestChampGame.total) {
          bestChampGame = { total, year: c.season.year, a: champGame.managerName, b: champGame.opponentName, managerId: c.championManagerId };
        }
      }
    }
    if (bestChampGame) {
      entries.push({ key: "champ-game", label: "Highest-Scoring Championship", value: `${bestChampGame.total.toFixed(1)} combined`, holderName: `${bestChampGame.a} vs ${bestChampGame.b}`, holderManagerId: bestChampGame.managerId, detail: `${bestChampGame.year} final` });
    }

    // Best playoff run by a low seed: champion with the worst (highest) regular-season rank.
    const lowSeedChamp = championships
      .filter((c) => c.championFantasyTeam.regularSeasonRank != null)
      .sort((a, b) => (b.championFantasyTeam.regularSeasonRank ?? 0) - (a.championFantasyTeam.regularSeasonRank ?? 0))[0];
    if (lowSeedChamp && (lowSeedChamp.championFantasyTeam.regularSeasonRank ?? 1) > 1) {
      entries.push({ key: "low-seed", label: "Best Low-Seed Title Run", value: `#${lowSeedChamp.championFantasyTeam.regularSeasonRank} seed`, holderName: lowSeedChamp.championManager.displayName, holderManagerId: lowSeedChamp.championManagerId, detail: `won the ${lowSeedChamp.season.year} title` });
    }
  }

  return entries;
}
