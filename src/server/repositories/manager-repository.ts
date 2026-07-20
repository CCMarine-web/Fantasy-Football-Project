import { prisma } from "@/lib/db";
import {
  averageFinish,
  careerSummary,
  championships,
  finalsAppearances,
  finishesBySeason,
  headToHeadRecord,
  playoffAppearances,
} from "@/server/stats";
import type { GameResult, SeasonFinish } from "@/server/stats/types";
import type { ManagerSummary } from "@/types/view-models";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { generateScoutingReport } from "@/server/ai/services/scouting-report";

const CLOSE_GAME_MARGIN = 5; // games decided by < 5 points
const BLOWOUT_MARGIN = 40; // games decided by >= 40 points

// `opponentId` is the opponent MANAGER's id (not fantasy team id), so career-vs-career
// head-to-head lookups can filter directly by manager without an extra team->manager join.
export async function buildManagerGameLog(managerId: string): Promise<GameResult[]> {
  const matchupTeams = await prisma.matchupTeam.findMany({
    where: { fantasyTeam: { managerId }, score: { not: null } },
    include: {
      matchup: { include: { teams: { include: { fantasyTeam: true } }, season: true } },
    },
  });

  const games: GameResult[] = [];
  for (const mt of matchupTeams) {
    const opponent = mt.matchup.teams.find((t) => t.id !== mt.id);
    if (!opponent || mt.score == null || opponent.score == null) continue;
    const result: GameResult["result"] = mt.isWinner === true ? "W" : mt.isWinner === false ? "L" : "T";
    games.push({
      week: mt.matchup.week,
      season: mt.matchup.season.year,
      isPlayoff: mt.matchup.isPlayoff,
      pointsFor: mt.score,
      pointsAgainst: opponent.score,
      opponentId: opponent.fantasyTeam.managerId,
      result,
    });
  }
  return games;
}

const buildGameLog = buildManagerGameLog;

export async function getHeadToHeadGameLog(managerId: string, opponentManagerId: string): Promise<GameResult[]> {
  const games = await buildManagerGameLog(managerId);
  return games.filter((g) => g.opponentId === opponentManagerId);
}

async function buildSeasonFinishes(managerId: string): Promise<SeasonFinish[]> {
  const teams = await prisma.fantasyTeam.findMany({
    where: { managerId, season: { status: "COMPLETE" } },
    include: { season: true, championshipsWon: true, championshipsRunnerUp: true },
  });

  return teams.map((team) => ({
    season: team.season.year,
    regularSeasonRank: team.regularSeasonRank ?? 0,
    finalRank: team.finalRank ?? team.regularSeasonRank ?? 0,
    madePlayoffs: team.madePlayoffs,
    isChampion: team.isChampion,
    isRunnerUp: team.championshipsRunnerUp.length > 0,
  }));
}

export async function listManagerSummaries(): Promise<ManagerSummary[]> {
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    include: {
      fantasyTeams: {
        orderBy: { season: { year: "desc" } },
        take: 1,
      },
    },
    orderBy: { displayName: "asc" },
  });

  const summaries: ManagerSummary[] = [];
  for (const manager of managers) {
    const games = await buildGameLog(manager.id);
    const summary = careerSummary(games);
    const champs = await prisma.championship.count({ where: { championManagerId: manager.id } });
    const finals = await prisma.championship.count({
      where: {
        OR: [{ championManagerId: manager.id }, { runnerUpFantasyTeam: { managerId: manager.id } }],
      },
    });

    summaries.push({
      managerId: manager.id,
      displayName: manager.displayName,
      avatarUrl: manager.avatarUrl,
      currentTeamName: manager.fantasyTeams[0]?.teamName ?? "—",
      championships: champs,
      finalsAppearances: finals,
      careerWins: summary.record.wins,
      careerLosses: summary.record.losses,
      careerTies: summary.record.ties,
      winningPercentage: Number(summary.winningPercentage.toFixed(3)),
    });
  }
  return summaries;
}

export interface ManagerSeasonLine {
  year: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  regularSeasonRank: number | null;
  finalRank: number | null;
  madePlayoffs: boolean;
  isChampion: boolean;
  teamName: string;
}

export interface HeadToHeadLine {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsForAvg: number;
}

/**
 * The full detailed profile for one manager. Fetches every league game once
 * and derives career totals, per-season lines, all-play (luck) record,
 * margins, close/blowout splits, head-to-head vs everyone, and the weekly
 * finish distribution. All-play and finish distribution need the whole
 * league's weekly scores, which is why we pull all matchup teams here.
 */
export async function getManagerProfileDetailed(managerId: string) {
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    include: {
      fantasyTeams: { include: { season: true }, orderBy: { season: { year: "asc" } } },
      teamNameHistory: { orderBy: { startDate: "asc" } },
    },
  });
  if (!manager) return null;

  // Every scored regular-season + playoff game in the league, with each side's
  // manager id, so we can compute all-play and finish distribution league-wide.
  const allMatchupTeams = await prisma.matchupTeam.findMany({
    where: { score: { not: null } },
    include: {
      fantasyTeam: { select: { managerId: true, manager: { select: { displayName: true } } } },
      matchup: { select: { week: true, isPlayoff: true, season: { select: { year: true } } } },
    },
  });

  // Group scores by (season, week) for all-play + finish distribution.
  const weekKey = (year: number, week: number) => `${year}-${week}`;
  const scoresByWeek = new Map<string, { managerId: string; points: number }[]>();
  for (const mt of allMatchupTeams) {
    if (mt.score == null) continue;
    const key = weekKey(mt.matchup.season.year, mt.matchup.week);
    const list = scoresByWeek.get(key) ?? [];
    list.push({ managerId: mt.fantasyTeam.managerId, points: mt.score });
    scoresByWeek.set(key, list);
  }

  const games = await buildManagerGameLog(managerId);
  const summary = careerSummary(games);
  const finishes = await buildSeasonFinishes(managerId);

  // Per-season lines.
  const seasonLines: ManagerSeasonLine[] = manager.fantasyTeams
    .filter((t) => t.season.status !== "UPCOMING" || t.wins + t.losses + t.ties > 0)
    .map((t) => ({
      year: t.season.year,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      regularSeasonRank: t.regularSeasonRank,
      finalRank: t.finalRank,
      madePlayoffs: t.madePlayoffs,
      isChampion: t.isChampion,
      teamName: t.teamName,
    }));

  const winPct = (l: ManagerSeasonLine) => {
    const g = l.wins + l.losses + l.ties;
    return g ? (l.wins + 0.5 * l.ties) / g : 0;
  };
  const playedSeasons = seasonLines.filter((l) => l.wins + l.losses + l.ties > 0);
  const bestSeason = [...playedSeasons].sort((a, b) => winPct(b) - winPct(a) || b.pointsFor - a.pointsFor)[0] ?? null;
  const worstSeason = [...playedSeasons].sort((a, b) => winPct(a) - winPct(b) || a.pointsFor - b.pointsFor)[0] ?? null;

  // Margins, close games, blowouts (regular + playoff decided games).
  const decided = games.filter((g) => g.result !== "T");
  const wins = decided.filter((g) => g.result === "W");
  const losses = decided.filter((g) => g.result === "L");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgMarginVictory = avg(wins.map((g) => g.pointsFor - g.pointsAgainst));
  const avgMarginDefeat = avg(losses.map((g) => g.pointsAgainst - g.pointsFor));
  const closeGames = decided.filter((g) => Math.abs(g.pointsFor - g.pointsAgainst) < CLOSE_GAME_MARGIN);
  const blowouts = decided.filter((g) => Math.abs(g.pointsFor - g.pointsAgainst) >= BLOWOUT_MARGIN);
  const closeRecord = {
    wins: closeGames.filter((g) => g.result === "W").length,
    losses: closeGames.filter((g) => g.result === "L").length,
  };
  const blowoutRecord = {
    wins: blowouts.filter((g) => g.result === "W").length,
    losses: blowouts.filter((g) => g.result === "L").length,
  };

  // All-play career record + weekly finish distribution (this manager only).
  let apW = 0;
  let apL = 0;
  let apT = 0;
  const numTeamsSeen = new Set<number>();
  const finishCounts = new Map<number, number>(); // finish position -> count
  for (const g of games) {
    const key = weekKey(g.season, g.week);
    const scores = scoresByWeek.get(key);
    if (!scores) continue;
    const teamCount = scores.length;
    numTeamsSeen.add(teamCount);
    const mine = g.pointsFor;
    let better = 0; // teams that scored higher than me
    for (const s of scores) {
      if (s.managerId === managerId) continue;
      if (mine > s.points) apW += 1;
      else if (mine < s.points) apL += 1;
      else apT += 1;
      if (s.points > mine) better += 1;
    }
    const finish = better + 1; // 1 = highest score that week
    finishCounts.set(finish, (finishCounts.get(finish) ?? 0) + 1);
  }
  const allPlayGames = apW + apL + apT;
  const allPlayWinPct = allPlayGames ? (apW + 0.5 * apT) / allPlayGames : 0;
  // Luck = actual win% vs all-play win%. If you win more than your all-play
  // rate suggests, you've been lucky (favorable schedule); less, unlucky.
  const luckDelta = summary.winningPercentage - allPlayWinPct;
  const luckLabel = luckDelta > 0.03 ? "lucky" : luckDelta < -0.03 ? "unlucky" : "neutral";
  const maxFinishSlots = Math.max(1, ...numTeamsSeen);
  const finishDistribution = Array.from({ length: maxFinishSlots }, (_, i) => ({
    finish: i + 1,
    count: finishCounts.get(i + 1) ?? 0,
  }));

  // Head-to-head vs every other manager.
  const byOpp = new Map<string, GameResult[]>();
  const oppName = new Map<string, string>();
  for (const mt of allMatchupTeams) {
    if (mt.fantasyTeam.managerId !== managerId) {
      oppName.set(mt.fantasyTeam.managerId, mt.fantasyTeam.manager.displayName);
    }
  }
  for (const g of games) {
    const list = byOpp.get(g.opponentId) ?? [];
    list.push(g);
    byOpp.set(g.opponentId, list);
  }
  const headToHead: HeadToHeadLine[] = [...byOpp.entries()]
    .map(([opponentId, log]) => {
      const rec = headToHeadRecord(log);
      return {
        opponentId,
        opponentName: oppName.get(opponentId) ?? "Unknown",
        wins: rec.wins,
        losses: rec.losses,
        ties: rec.ties,
        pointsForAvg: Number(avg(log.map((g) => g.pointsFor)).toFixed(1)),
      };
    })
    .sort((a, b) => b.wins + b.losses + b.ties - (a.wins + a.losses + a.ties) || a.opponentName.localeCompare(b.opponentName));

  const champs = await prisma.championship.count({ where: { championManagerId: managerId } });

  return {
    manager,
    seasonLines,
    stats: {
      ...summary,
      championships: champs,
      playoffAppearances: playoffAppearances(finishes),
      finalsAppearances: finalsAppearances(finishes),
      averageFinish: Number(averageFinish(finishes).toFixed(2)),
      finishes: finishesBySeason(finishes),
      avgMarginVictory: Number(avgMarginVictory.toFixed(1)),
      avgMarginDefeat: Number(avgMarginDefeat.toFixed(1)),
      closeRecord,
      blowoutRecord,
      allPlay: { wins: apW, losses: apL, ties: apT, winPct: Number(allPlayWinPct.toFixed(3)) },
      luck: { delta: Number(luckDelta.toFixed(3)), label: luckLabel },
    },
    bestSeason,
    worstSeason,
    finishDistribution,
    headToHead,
  };
}

export async function getManagerProfile(managerId: string) {
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    include: {
      fantasyTeams: { include: { season: true }, orderBy: { season: { year: "desc" } } },
      teamNameHistory: { orderBy: { startDate: "asc" } },
      rivalriesAsA: { include: { managerB: true } },
      rivalriesAsB: { include: { managerA: true } },
    },
  });
  if (!manager) return null;

  const games = await buildGameLog(managerId);
  const finishes = await buildSeasonFinishes(managerId);
  const summary = careerSummary(games);

  return {
    manager,
    games,
    stats: {
      ...summary,
      playoffAppearances: playoffAppearances(finishes),
      championships: championships(finishes),
      finalsAppearances: finalsAppearances(finishes),
      averageFinish: Number(averageFinish(finishes).toFixed(2)),
      finishes: finishesBySeason(finishes),
    },
    rivalries: [
      ...manager.rivalriesAsA.map((r) => ({ rivalry: r, opponent: r.managerB })),
      ...manager.rivalriesAsB.map((r) => ({ rivalry: r, opponent: r.managerA })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Personality layer: AI scouting report (generate-once-reuse)
// ---------------------------------------------------------------------------

export interface ManagerScoutingReport {
  text: string;
  isMock: boolean;
}

/**
 * Returns an AI scouting report for a manager, built from their real
 * transaction history, round-1 draft tendencies, and results. Generate-once-
 * reuse: an existing MANAGER_PROFILE generation for this manager is returned;
 * otherwise it's generated, logged, and reused. Null if the manager has no
 * meaningful history yet.
 */
export async function getManagerScoutingReport(managerId: string): Promise<ManagerScoutingReport | null> {
  const manager = await prisma.manager.findUnique({ where: { id: managerId }, select: { displayName: true } });
  if (!manager) return null;

  const existing = await prisma.aIContentGeneration.findFirst({
    where: { contentType: "MANAGER_PROFILE", inputSummary: { path: ["managerId"], equals: managerId } },
    orderBy: { generatedAt: "desc" },
  });
  if (existing) return { text: existing.outputText, isMock: existing.providerName === "mock" };

  const [assets, r1picks, teams] = await Promise.all([
    prisma.transactionAsset.findMany({
      where: { managerId, direction: "ADD" },
      include: { transaction: { select: { type: true, faabSpent: true } } },
    }),
    prisma.draftPick.findMany({ where: { managerId, round: 1 }, include: { player: { select: { position: true } } } }),
    prisma.fantasyTeam.findMany({ where: { managerId, season: { status: "COMPLETE" } }, select: { finalRank: true, isChampion: true, wins: true, losses: true, ties: true } }),
  ]);

  if (assets.length === 0 && r1picks.length === 0 && teams.length === 0) return null;

  const tradeCount = assets.filter((a) => a.transaction.type === "TRADE").length;
  const waiverClaims = assets.filter((a) => a.transaction.type === "WAIVER").length;
  const freeAgentPickups = assets.filter((a) => a.transaction.type === "FREE_AGENT").length;
  const faabSpent = assets.reduce((sum, a) => sum + (a.transaction.faabSpent ?? 0), 0) || null;
  const wins = teams.reduce((s, t) => s + t.wins, 0);
  const losses = teams.reduce((s, t) => s + t.losses, 0);
  const ties = teams.reduce((s, t) => s + t.ties, 0);
  const finishes = teams.map((t) => t.finalRank).filter((x): x is number => x != null);

  const safeguards = await getContentSafeguards();
  const result = await generateScoutingReport(
    {
      managerId,
      managerName: manager.displayName,
      careerRecord: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
      championships: teams.filter((t) => t.isChampion).length,
      tradeCount,
      waiverClaims,
      freeAgentPickups,
      faabSpent,
      firstRoundPositions: r1picks.map((p) => p.player?.position ?? "?"),
      bestFinish: finishes.length ? Math.min(...finishes) : null,
      worstFinish: finishes.length ? Math.max(...finishes) : null,
    },
    safeguards,
  );
  return { text: result.text, isMock: result.providerName === "mock" };
}
