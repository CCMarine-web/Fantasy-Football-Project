import { prisma } from "@/lib/db";
import { longestLosingStreak } from "@/server/stats";
import type { GameResult } from "@/server/stats/types";

export interface ShameEntry {
  key: string;
  label: string;
  value: string;
  holderName: string;
  holderManagerId: string | null;
  detail: string;
}

export interface ToiletBowlEntry {
  year: number;
  managerId: string;
  managerName: string;
  teamName: string;
  record: string;
  pointsFor: number;
}

export interface HallOfShame {
  entries: ShameEntry[];
  toiletBowl: ToiletBowlEntry[];
  benchYearsCovered: number[]; // seasons that have player-level data for bench calc
  allYears: number[];
}

interface Mt {
  managerId: string;
  managerName: string;
  score: number;
  isWinner: boolean | null;
  week: number;
  year: number;
  opponentName: string;
  opponentScore: number;
}

/**
 * The inverse of the records tab. Computes shame records from synced data.
 * Bench-points ("most left on the bench") needs player-level data, which only
 * exists for seasons synced after that feature landed — those seasons are
 * flagged in `benchYearsCovered`, and the entry notes the coverage.
 */
export async function getHallOfShame(): Promise<HallOfShame> {
  const rows = await prisma.matchupTeam.findMany({
    where: { score: { not: null } },
    include: {
      fantasyTeam: { select: { managerId: true, manager: { select: { displayName: true } } } },
      matchup: {
        select: {
          week: true,
          season: { select: { year: true } },
          teams: { select: { fantasyTeamId: true, score: true, fantasyTeam: { select: { manager: { select: { displayName: true } } } } } },
        },
      },
    },
  });

  const games: Mt[] = [];
  const allYearsSet = new Set<number>();
  for (const r of rows) {
    if (r.score == null) continue;
    const opp = r.matchup.teams.find((t) => t.fantasyTeamId !== r.fantasyTeamId);
    if (!opp || opp.score == null) continue;
    allYearsSet.add(r.matchup.season.year);
    games.push({
      managerId: r.fantasyTeam.managerId,
      managerName: r.fantasyTeam.manager.displayName,
      score: r.score,
      isWinner: r.isWinner,
      week: r.matchup.week,
      year: r.matchup.season.year,
      opponentName: opp.fantasyTeam.manager.displayName,
      opponentScore: opp.score,
    });
  }

  const entries: ShameEntry[] = [];
  if (games.length > 0) {
    const where = (g: Mt) => `Week ${g.week}, ${g.year}`;

    const lowest = games.reduce((a, b) => (b.score < a.score ? b : a));
    entries.push({ key: "low-game", label: "Lowest Single-Game Score", value: lowest.score.toFixed(1), holderName: lowest.managerName, holderManagerId: lowest.managerId, detail: `vs ${lowest.opponentName} · ${where(lowest)}` });

    const wins = games.filter((g) => g.isWinner === true);
    if (wins.length) {
      const lw = wins.reduce((a, b) => (b.score < a.score ? b : a));
      entries.push({ key: "low-win", label: "Lowest Score in a Win (Backed In)", value: lw.score.toFixed(1), holderName: lw.managerName, holderManagerId: lw.managerId, detail: `won ${lw.score.toFixed(1)}–${lw.opponentScore.toFixed(1)} · ${where(lw)}` });
    }

    // Worst blowout loss (from the loser's perspective).
    const losses = games.filter((g) => g.isWinner === false);
    if (losses.length) {
      const worstLoss = losses.reduce((a, b) => (b.opponentScore - b.score > a.opponentScore - a.score ? b : a));
      entries.push({ key: "worst-loss", label: "Worst Blowout Loss", value: `${(worstLoss.opponentScore - worstLoss.score).toFixed(1)} pts`, holderName: worstLoss.managerName, holderManagerId: worstLoss.managerId, detail: `lost ${worstLoss.score.toFixed(1)}–${worstLoss.opponentScore.toFixed(1)} to ${worstLoss.opponentName} · ${where(worstLoss)}` });
    }

    // Longest losing streak all-time.
    const logByManager = new Map<string, { name: string; games: GameResult[] }>();
    for (const g of games) {
      const e = logByManager.get(g.managerId) ?? { name: g.managerName, games: [] };
      e.games.push({ week: g.week, season: g.year, isPlayoff: false, pointsFor: g.score, pointsAgainst: g.opponentScore, opponentId: "", result: g.isWinner === true ? "W" : g.isWinner === false ? "L" : "T" });
      logByManager.set(g.managerId, e);
    }
    let worstStreak = { id: "", name: "", len: 0 };
    for (const [id, e] of logByManager) {
      const l = longestLosingStreak(e.games);
      if (l > worstStreak.len) worstStreak = { id, name: e.name, len: l };
    }
    if (worstStreak.len) entries.push({ key: "loss-streak", label: "Longest Losing Streak", value: `${worstStreak.len} games`, holderName: worstStreak.name, holderManagerId: worstStreak.id, detail: "all-time" });
  }

  // Worst season record.
  const teams = await prisma.fantasyTeam.findMany({
    where: { OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }, { pointsFor: { gt: 0 } }] },
    include: { manager: { select: { id: true, displayName: true } }, season: { select: { year: true, status: true } } },
  });
  if (teams.length) {
    const pct = (t: (typeof teams)[number]) => {
      const g = t.wins + t.losses + t.ties;
      return g ? (t.wins + 0.5 * t.ties) / g : 1;
    };
    const worst = teams.reduce((a, b) => (pct(b) < pct(a) ? b : a));
    entries.push({ key: "worst-season", label: "Worst Season Ever", value: `${worst.wins}-${worst.losses}${worst.ties ? `-${worst.ties}` : ""}`, holderName: worst.manager.displayName, holderManagerId: worst.manager.id, detail: `${worst.season.year} · ${worst.pointsFor.toFixed(0)} PF` });
  }

  // Most points left on the bench (needs player-level data).
  const rosters = await prisma.roster.findMany({
    include: {
      fantasyTeam: { select: { manager: { select: { id: true, displayName: true } }, season: { select: { year: true } } } },
      playerScores: { select: { isStarter: true, points: true } },
    },
  });
  const benchYears = new Set<number>();
  let worstBench: { value: number; managerId: string; managerName: string; year: number; week: number } | null = null;
  for (const roster of rosters) {
    if (roster.playerScores.length === 0) continue;
    benchYears.add(roster.fantasyTeam.season.year);
    const starters = roster.playerScores.filter((p) => p.isStarter);
    const starterCount = starters.length || 9;
    const actualStarterPts = starters.reduce((a, p) => a + p.points, 0);
    // Optimal (position-agnostic): best `starterCount` scorers on the roster.
    const optimalPts = [...roster.playerScores].sort((a, b) => b.points - a.points).slice(0, starterCount).reduce((a, p) => a + p.points, 0);
    const left = optimalPts - actualStarterPts;
    if (!worstBench || left > worstBench.value) {
      worstBench = { value: left, managerId: roster.fantasyTeam.manager.id, managerName: roster.fantasyTeam.manager.displayName, year: roster.fantasyTeam.season.year, week: roster.week };
    }
  }
  if (worstBench && worstBench.value > 0) {
    entries.push({
      key: "bench",
      label: "Most Points Left on the Bench",
      value: `${worstBench.value.toFixed(1)} pts`,
      holderName: worstBench.managerName,
      holderManagerId: worstBench.managerId,
      detail: `Week ${worstBench.week}, ${worstBench.year}`,
    });
  }

  // Toilet Bowl: the worst finish per completed season (highest finalRank, or
  // worst record when finalRank is unavailable).
  const completedTeams = teams.filter((t) => t.season.status === "COMPLETE");
  const rankVal = (x: (typeof completedTeams)[number]) => x.finalRank ?? 100 - (x.wins + 0.5 * x.ties);
  const worstFinalByYear = new Map<number, (typeof completedTeams)[number]>();
  for (const t of completedTeams) {
    const cur = worstFinalByYear.get(t.season.year);
    if (!cur || rankVal(t) > rankVal(cur)) worstFinalByYear.set(t.season.year, t);
  }
  const toiletBowl: ToiletBowlEntry[] = [...worstFinalByYear.values()]
    .map((t) => ({ year: t.season.year, managerId: t.manager.id, managerName: t.manager.displayName, teamName: t.teamName, record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`, pointsFor: t.pointsFor }))
    .sort((a, b) => b.year - a.year);

  return {
    entries,
    toiletBowl,
    benchYearsCovered: [...benchYears].sort((a, b) => a - b),
    allYears: [...allYearsSet].sort((a, b) => a - b),
  };
}
