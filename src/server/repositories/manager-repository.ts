import { prisma } from "@/lib/db";
import {
  averageFinish,
  careerSummary,
  championships,
  filterByDataSource,
  finalsAppearances,
  finishesBySeason,
  headToHeadRecord,
  playoffAppearances,
} from "@/server/stats";
import type { GameDataSource, GameResult, SeasonFinish } from "@/server/stats/types";
import {
  groupByManager,
  loadVerifiedGames,
  loadVerifiedTeamWeeks,
  toGameResult,
} from "@/server/repositories/verified-games";
import { getManagerLuck } from "@/server/repositories/luck-repository";
import { getLastPlaceBySeason } from "@/server/repositories/hall-of-shame-repository";
import { cached, CACHE_TAGS } from "@/server/cache";
import type { ManagerSummary } from "@/types/view-models";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { generateScoutingReport } from "@/server/ai/services/scouting-report";
import {
  generateManagerPerformanceSummary,
  type ManagerPerfPacket,
  type ManagerEraFact,
  type ManagerSeasonFact,
} from "@/server/ai/services/manager-performance-summary";

const CLOSE_GAME_MARGIN = 5; // games decided by < 5 points
const BLOWOUT_MARGIN = 40; // games decided by >= 40 points

/**
 * One manager's game log.
 *
 * `opponentId` is the opponent MANAGER's id (not fantasy team id), so
 * career-vs-career head-to-head lookups can filter directly by manager without
 * an extra team->manager join.
 *
 * Only verified games are included — see server/repositories/verified-games.ts.
 * Without that filter an abandoned team's run of zeros counted as three losses
 * in its opponents' head-to-head records and dragged their average margins.
 */
export async function buildManagerGameLog(managerId: string): Promise<GameResult[]> {
  const rows = await loadVerifiedGames();
  return rows.filter((r) => r.managerId === managerId).map(toGameResult);
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
      avatarUrl: manager.photoUrl ?? manager.avatarUrl,
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
  /** Which system this season's results came from, for the era label. */
  dataSource: GameDataSource;
}

export interface HeadToHeadLine {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  pointsForAvg: number;
  pointsAgainstAvg: number;
}

/**
 * One unbroken run of seasons under the same team name.
 *
 * The TeamNameHistory table stores a row per season, so a manager who kept the
 * same name for six years produced six identical badges in a row — the page
 * read as one long concatenated string. It also only covers the ESPN era,
 * which meant the Sleeper-era names were missing entirely. Both are fixed by
 * deriving the runs from the FantasyTeam rows, which exist for every season.
 */
export interface TeamNameRun {
  name: string;
  firstYear: number;
  lastYear: number;
  /** "2020" or "2020–2022". */
  years: string;
}

/** Collapses a season-by-season name list into runs, trimming stray whitespace. */
export function buildTeamNameRuns(
  seasons: { year: number; teamName: string }[],
): TeamNameRun[] {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const runs: TeamNameRun[] = [];
  for (const season of [...seasons].sort((a, b) => a.year - b.year)) {
    const name = clean(season.teamName);
    if (!name) continue;
    const last = runs[runs.length - 1];
    if (last && last.name.toLowerCase() === name.toLowerCase() && season.year === last.lastYear + 1) {
      last.lastYear = season.year;
      last.years = `${last.firstYear}–${last.lastYear}`;
      continue;
    }
    runs.push({ name, firstYear: season.year, lastYear: season.year, years: `${season.year}` });
  }
  return runs.reverse();
}

/**
 * One era's worth of a manager's career. The league ran on ESPN through 2022
 * and on Sleeper from 2023, and the two eras are worth reading separately: the
 * rosters were different sizes, and only the Sleeper era has player-level data.
 */
export interface ManagerEraStats {
  key: "CAREER" | "ESPN" | "SLEEPER";
  label: string;
  /** e.g. "2017–2022", or "—" when the manager never played in this era. */
  years: string;
  seasonsPlayed: number;
  /**
   * REGULAR-SEASON record, deliberately. It has to agree with the
   * season-by-season rows on the same page (which come from FantasyTeam, and so
   * are regular season) and with the scouting report's career record. Counting
   * playoff and consolation games here made the per-season rows fail to sum to
   * the career row — 55-71 of regular season reading as 64-82.
   */
  wins: number;
  losses: number;
  ties: number;
  winningPercentage: number;
  /**
   * Championship-bracket record — the games that decide the title, and the only
   * postseason record the site keeps. Consolation games are not counted here or
   * anywhere else: going 2-0 in a Toilet Bowl is not a playoff run, and the
   * site no longer keeps a public record of it.
   */
  playoffWins: number;
  playoffLosses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Regular-season points per game — the only fair way to compare unequal eras. */
  pointsForPerGame: number | null;
  pointsAgainstPerGame: number | null;
  championships: number;
  finalsAppearances: number;
  playoffAppearances: number;
  bestFinish: number | null;
  highestWeeklyScore: number | null;
  lowestWeeklyScore: number | null;
}

interface EraSeasonFacts {
  year: number;
  dataSource: GameDataSource;
  madePlayoffs: boolean;
  finalRank: number | null;
  isChampion: boolean;
  isRunnerUp: boolean;
  playedGames: boolean;
}

/**
 * Builds the career / ESPN-era / Sleeper-era statistics table for one manager.
 *
 * Games carry their own `dataSource`, so an era's record is the record of the
 * games actually played in it — no year cutoff is hard-coded, and a season
 * imported from a third source would not silently land in either era.
 */
function buildEraStats(games: GameResult[], seasons: EraSeasonFacts[]): ManagerEraStats[] {
  const build = (key: ManagerEraStats["key"], label: string, scopedGames: GameResult[], scopedSeasons: EraSeasonFacts[]): ManagerEraStats => {
    const regular = careerSummary(scopedGames, "regularSeason");
    const title = careerSummary(scopedGames, "championshipBracket");
    // High/low single-game marks read across every game played, postseason
    // included — a career-best score is a career-best score.
    const allGames = careerSummary(scopedGames);
    const played = scopedSeasons.filter((s) => s.playedGames);
    const years = played.map((s) => s.year).sort((a, b) => a - b);
    const gameCount = regular.record.wins + regular.record.losses + regular.record.ties;
    const finishes = played.map((s) => s.finalRank).filter((r): r is number => r != null && r > 0);

    return {
      key,
      label,
      years: years.length === 0 ? "—" : years[0] === years[years.length - 1] ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`,
      seasonsPlayed: played.length,
      wins: regular.record.wins,
      losses: regular.record.losses,
      ties: regular.record.ties,
      winningPercentage: Number(regular.winningPercentage.toFixed(3)),
      playoffWins: title.record.wins,
      playoffLosses: title.record.losses,
      pointsFor: Number(regular.totalPointsFor.toFixed(1)),
      pointsAgainst: Number(regular.totalPointsAgainst.toFixed(1)),
      pointsForPerGame: gameCount ? Number((regular.totalPointsFor / gameCount).toFixed(1)) : null,
      pointsAgainstPerGame: gameCount ? Number((regular.totalPointsAgainst / gameCount).toFixed(1)) : null,
      championships: played.filter((s) => s.isChampion).length,
      finalsAppearances: played.filter((s) => s.isChampion || s.isRunnerUp).length,
      playoffAppearances: played.filter((s) => s.madePlayoffs).length,
      bestFinish: finishes.length ? Math.min(...finishes) : null,
      highestWeeklyScore: allGames.highestWeeklyScore == null ? null : Number(allGames.highestWeeklyScore.toFixed(1)),
      lowestWeeklyScore: allGames.lowestWeeklyScore == null ? null : Number(allGames.lowestWeeklyScore.toFixed(1)),
    };
  };

  const rows: ManagerEraStats[] = [build("CAREER", "Career", games, seasons)];
  for (const [key, label] of [
    ["ESPN", "ESPN era"],
    ["SLEEPER", "Sleeper era"],
  ] as const) {
    const scopedGames = filterByDataSource(games, key);
    const scopedSeasons = seasons.filter((s) => s.dataSource === key);
    // Omit an era the manager never played in rather than showing a row of zeroes.
    if (scopedGames.length === 0 && scopedSeasons.every((s) => !s.playedGames)) continue;
    rows.push(build(key, label, scopedGames, scopedSeasons));
  }
  return rows;
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

  // Every VERIFIED weekly score in the league, so all-play and the weekly
  // finish distribution are measured against real contests only. Reading an
  // abandoned team's 0.0 as a beatable score inflated everyone else's all-play
  // record for those weeks.
  const [allTeamWeeks, allGames] = await Promise.all([
    loadVerifiedTeamWeeks(),
    loadVerifiedGames(),
  ]);

  // Group scores by (season, week) for all-play + finish distribution.
  const weekKey = (year: number, week: number) => `${year}-${week}`;
  const scoresByWeek = new Map<string, { managerId: string; points: number }[]>();
  for (const tw of allTeamWeeks) {
    const key = weekKey(tw.year, tw.week);
    const list = scoresByWeek.get(key) ?? [];
    list.push({ managerId: tw.managerId, points: tw.points });
    scoresByWeek.set(key, list);
  }

  const games = allGames.filter((r) => r.managerId === managerId).map(toGameResult);
  /*
   * Two summaries, deliberately. `regular` is the record the page quotes and
   * the one every other surface agrees with. `summary` spans every game played
   * and is used only for career highs and lows, where a postseason score is
   * still a real score.
   */
  const regular = careerSummary(games, "regularSeason");
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
      dataSource: t.season.dataSource,
    }));

  const winPct = (l: ManagerSeasonLine) => {
    const g = l.wins + l.losses + l.ties;
    return g ? (l.wins + 0.5 * l.ties) / g : 0;
  };
  const playedSeasons = seasonLines.filter((l) => l.wins + l.losses + l.ties > 0);
  const bestSeason = [...playedSeasons].sort((a, b) => winPct(b) - winPct(a) || b.pointsFor - a.pointsFor)[0] ?? null;
  const worstSeason = [...playedSeasons].sort((a, b) => winPct(a) - winPct(b) || a.pointsFor - b.pointsFor)[0] ?? null;

  /*
   * Margins, close games and blowouts read the REGULAR SEASON only. Mixing in
   * postseason games meant a manager's close-game record moved when they
   * played a toilet-bowl game, and the Luck Score — which uses the same
   * close-game split — has to be measured over a schedule nobody chose.
   */
  const decided = games.filter((g) => !g.isPlayoff && g.result !== "T");
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
    // Regular season only: in a postseason week most of the league is no
    // longer playing for anything, so ranking a title-game score against six
    // dead teams' scores says nothing.
    if (g.isPlayoff) continue;
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
  const maxFinishSlots = Math.max(1, ...numTeamsSeen);
  const finishDistribution = Array.from({ length: maxFinishSlots }, (_, i) => ({
    finish: i + 1,
    count: finishCounts.get(i + 1) ?? 0,
  }));

  // Head-to-head vs every other manager.
  const byOpp = new Map<string, GameResult[]>();
  const oppName = new Map<string, string>();
  for (const row of allGames) {
    if (row.managerId !== managerId) oppName.set(row.managerId, row.managerName);
  }
  for (const g of games) {
    const list = byOpp.get(g.opponentId) ?? [];
    list.push(g);
    byOpp.set(g.opponentId, list);
  }
  const headToHead: HeadToHeadLine[] = [...byOpp.entries()]
    // An opponent id with no name behind it is a deleted or unmerged manager
    // row. Such an entry rendered as a nameless row showing only "14g", which
    // reads as a broken record rather than as missing data.
    .filter(([opponentId]) => opponentId && oppName.has(opponentId))
    .map(([opponentId, log]) => {
      const rec = headToHeadRecord(log);
      return {
        opponentId,
        opponentName: oppName.get(opponentId) as string,
        wins: rec.wins,
        losses: rec.losses,
        ties: rec.ties,
        games: rec.wins + rec.losses + rec.ties,
        pointsForAvg: Number(avg(log.map((g) => g.pointsFor)).toFixed(1)),
        pointsAgainstAvg: Number(avg(log.map((g) => g.pointsAgainst)).toFixed(1)),
      };
    })
    .sort((a, b) => b.games - a.games || a.opponentName.localeCompare(b.opponentName));

  const champs = await prisma.championship.count({ where: { championManagerId: managerId } });

  // Era table. `finishes` already excludes UPCOMING seasons, and runner-up
  // status comes from the Championship rows rather than being inferred.
  const finishByYear = new Map(finishes.map((f) => [f.season, f]));
  const eraStats = buildEraStats(
    games,
    seasonLines.map((line) => {
      const finish = finishByYear.get(line.year);
      return {
        year: line.year,
        dataSource: line.dataSource,
        madePlayoffs: line.madePlayoffs,
        finalRank: line.finalRank,
        isChampion: line.isChampion,
        isRunnerUp: finish?.isRunnerUp ?? false,
        playedGames: line.wins + line.losses + line.ties > 0,
      };
    }),
  );

  // The Luck Score, computed from recorded scores; see server/stats/luck.ts.
  const [luck, lastPlaceAll] = await Promise.all([
    getManagerLuck(managerId),
    getLastPlaceBySeason(),
  ]);
  const lastPlaceYears = lastPlaceAll.filter((l) => l.managerId === managerId).map((l) => l.year);

  return {
    manager,
    seasonLines,
    eraStats,
    luck,
    /** Seasons finished bottom of the REGULAR-SEASON standings, newest first. */
    lastPlaceYears,
    teamNameRuns: buildTeamNameRuns(
      manager.fantasyTeams.map((t) => ({ year: t.season.year, teamName: t.teamName })),
    ),
    stats: {
      ...summary,
      /** Regular-season record — the one the tables on the page show. */
      regularSeasonRecord: regular.record,
      regularSeasonWinPct: Number(regular.winningPercentage.toFixed(3)),
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

// ---------------------------------------------------------------------------
// Redesigned Managers page rows + saved performance summary
// ---------------------------------------------------------------------------

export interface ManagerRow {
  managerId: string;
  displayName: string;
  photoUrl: string | null;
  currentTeamName: string;
  yearsActive: string;
  seasonsPlayed: number;
  /**
   * REGULAR SEASON only, to match the manager profile, the season-by-season
   * rows and the scouting reports. This list used to show an all-games record
   * while every other surface showed regular season, so the same manager read
   * 64-82 here and 55-71 one click away.
   */
  careerWins: number;
  careerLosses: number;
  careerTies: number;
  winningPercentage: number;
  /** Championship bracket only — the games that decide the title. */
  playoffWins: number;
  playoffLosses: number;
  championships: number;
  finalsAppearances: number;
  currentWins: number;
  currentLosses: number;
  currentTies: number;
  bestFinish: number | null;
  /** Seasons finished bottom of the REGULAR-SEASON standings. */
  lastPlaceFinishes: number;
  lastPlaceYears: number[];
  statsComplete: boolean;
  performanceSummary: string | null;
  /** False for managers who no longer play in the league (retired). */
  isActive: boolean;
}

/**
 * Rows for the full-width Managers page: photo, name, team, years active,
 * championships, verified career stats, current record, and (if generated) a
 * saved performance summary. `statsComplete` is false whenever the league's
 * founding year predates the earliest loaded season, so callers can avoid
 * presenting a partial record as a complete one. It reads true now that the
 * ESPN era (2017-2022) sits alongside the Sleeper era; `getStatsCoverage()`
 * is what the UI uses to state the covered range.
 */
export const listManagerRows = cached(buildManagerRows, ["manager-rows"], {
  tags: [CACHE_TAGS.league, CACHE_TAGS.managers, CACHE_TAGS.content],
});

async function buildManagerRows(): Promise<ManagerRow[]> {
  const [managers, earliestSeason, league] = await Promise.all([
    prisma.manager.findMany({
      where: { deletedAt: null },
      include: {
        fantasyTeams: { include: { season: true }, orderBy: { season: { year: "asc" } } },
        performanceSummary: true,
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.season.findFirst({ orderBy: { year: "asc" }, select: { year: true } }),
    prisma.league.findFirst({ select: { foundedYear: true } }),
  ]);

  const historyIncomplete = !!(league && earliestSeason && league.foundedYear < earliestSeason.year);

  // Previously this loop ran three sequential queries PER manager (a full game
  // log plus two championship counts) — ~30 round-trips for ten managers. All
  // three are now answered by one query each, up front.
  const [gameLogs, championships, lastPlace] = await Promise.all([
    buildAllManagerGameLogs(),
    prisma.championship.findMany({
      select: {
        championManagerId: true,
        runnerUpFantasyTeam: { select: { managerId: true } },
      },
    }),
    getLastPlaceBySeason(),
  ]);

  const lastPlaceYears = new Map<string, number[]>();
  for (const finish of lastPlace) {
    const list = lastPlaceYears.get(finish.managerId) ?? [];
    list.push(finish.year);
    lastPlaceYears.set(finish.managerId, list);
  }

  const champCount = new Map<string, number>();
  const finalsCount = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string | null | undefined) => {
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const c of championships) {
    bump(champCount, c.championManagerId);
    bump(finalsCount, c.championManagerId);
    const runnerUp = c.runnerUpFantasyTeam?.managerId;
    if (runnerUp && runnerUp !== c.championManagerId) bump(finalsCount, runnerUp);
  }

  const rows: ManagerRow[] = [];
  for (const m of managers) {
    const games = gameLogs.get(m.id) ?? [];
    const summary = careerSummary(games, "regularSeason");
    const title = careerSummary(games, "championshipBracket");
    const champs = champCount.get(m.id) ?? 0;
    const finals = finalsCount.get(m.id) ?? 0;

    const played = m.fantasyTeams.filter((t) => t.wins + t.losses + t.ties > 0);
    const years = played.map((t) => t.season.year);
    const yearsActive = years.length ? (years[0] === years[years.length - 1] ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`) : "—";
    const current = m.fantasyTeams[m.fantasyTeams.length - 1];
    const finishes = played.map((t) => t.finalRank).filter((x): x is number => x != null);

    rows.push({
      managerId: m.id,
      displayName: m.displayName,
      photoUrl: m.photoUrl ?? m.avatarUrl,
      currentTeamName: current?.teamName ?? "—",
      yearsActive,
      seasonsPlayed: played.length,
      careerWins: summary.record.wins,
      careerLosses: summary.record.losses,
      careerTies: summary.record.ties,
      winningPercentage: Number(summary.winningPercentage.toFixed(3)),
      playoffWins: title.record.wins,
      playoffLosses: title.record.losses,
      championships: champs,
      finalsAppearances: finals,
      currentWins: current?.wins ?? 0,
      currentLosses: current?.losses ?? 0,
      currentTies: current?.ties ?? 0,
      bestFinish: finishes.length ? Math.min(...finishes) : null,
      lastPlaceFinishes: (lastPlaceYears.get(m.id) ?? []).length,
      lastPlaceYears: [...(lastPlaceYears.get(m.id) ?? [])].sort((a, b) => a - b),
      statsComplete: !historyIncomplete,
      performanceSummary: m.performanceSummary?.summary ?? null,
      isActive: m.isActive,
    });
  }
  return rows;
}

export interface StatsCoverage {
  /** One entry per era present in the database, oldest first. */
  eras: { key: GameDataSource; label: string; years: string }[];
  earliestYear: number | null;
  latestYear: number | null;
}

/**
 * Which seasons the site's statistics actually cover, per era.
 *
 * Used instead of a hard-coded caveat: the Managers page used to state that
 * stats "cover the seasons loaded from Sleeper (2023-present)", which stopped
 * being true the moment the ESPN history was imported. Deriving the sentence
 * from the seasons in the database means it cannot go stale again.
 */
export async function getStatsCoverage(): Promise<StatsCoverage> {
  const seasons = await prisma.season.findMany({
    where: { fantasyTeams: { some: { OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }, { ties: { gt: 0 } }] } } },
    select: { year: true, dataSource: true },
    orderBy: { year: "asc" },
  });

  const LABELS: Record<GameDataSource, string> = { ESPN: "ESPN", SLEEPER: "Sleeper", MANUAL: "Manually entered" };
  const byEra = new Map<GameDataSource, number[]>();
  for (const season of seasons) {
    const list = byEra.get(season.dataSource) ?? [];
    list.push(season.year);
    byEra.set(season.dataSource, list);
  }

  const eras = [...byEra.entries()]
    .map(([key, years]) => {
      const sorted = [...years].sort((a, b) => a - b);
      return {
        key,
        label: LABELS[key],
        years: sorted[0] === sorted[sorted.length - 1] ? `${sorted[0]}` : `${sorted[0]}–${sorted[sorted.length - 1]}`,
        first: sorted[0],
      };
    })
    .sort((a, b) => a.first - b.first)
    .map(({ key, label, years }) => ({ key, label, years }));

  const allYears = seasons.map((s) => s.year);
  return {
    eras,
    earliestYear: allYears.length ? Math.min(...allYears) : null,
    latestYear: allYears.length ? Math.max(...allYears) : null,
  };
}

/**
 * Builds every manager's game log from a single query. Same shape and same
 * verified-only rule as buildManagerGameLog, just batched — used by the list
 * pages so they don't issue one query per manager.
 */
async function buildAllManagerGameLogs(): Promise<Map<string, GameResult[]>> {
  return groupByManager(await loadVerifiedGames());
}

async function buildPerfPacket(managerId: string): Promise<ManagerPerfPacket | null> {
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    include: { fantasyTeams: { include: { season: true }, orderBy: { season: { year: "asc" } } } },
  });
  if (!manager) return null;

  const games = await buildManagerGameLog(managerId);
  /*
   * REGULAR-SEASON record, to match what the manager page actually displays.
   *
   * An all-games summary here produced bios that contradicted the table beside
   * them: Logan Javier's read "career record sits at 62-84" while the career
   * row on the same page showed 50-76, because the row is regular season and
   * the packet was counting playoff and consolation games too. The two must be
   * the same number, and the page's is the one a reader can check.
   */
  const summary = careerSummary(games, "regularSeason");
  // Championship bracket only. Consolation games are not in the packet at all:
  // the writer cannot call a Toilet Bowl result anything if it never sees one.
  const titleBracket = careerSummary(games, "championshipBracket");
  const finishes = await buildSeasonFinishes(managerId);
  const champs = await prisma.championship.count({ where: { championManagerId: managerId } });
  const finals = await prisma.championship.count({
    where: { OR: [{ championManagerId: managerId }, { runnerUpFantasyTeam: { managerId } }] },
  });

  const played = manager.fantasyTeams.filter((t) => t.wins + t.losses + t.ties > 0);
  const years = played.map((t) => t.season.year);
  const finishRanks = finishes.map((f) => f.finalRank).filter((x): x is number => x != null && x > 0);
  const [league, earliest] = await Promise.all([
    prisma.league.findFirst({ select: { foundedYear: true } }),
    prisma.season.findFirst({ orderBy: { year: "asc" }, select: { year: true } }),
  ]);

  // APPROVED + PUBLIC_SAFE knowledge about this manager, and commissioner history mentions.
  const knowledge = await prisma.leagueKnowledge.findMany({
    where: { approvalStatus: "APPROVED", privacyStatus: "PUBLIC_SAFE", managers: { some: { managerId } } },
    select: { title: true },
    take: 6,
  });
  const historySections = await prisma.leagueHistorySection.findMany({
    where: { approvalStatus: "APPROVED", body: { contains: manager.displayName } },
    select: { year: true, title: true, body: true },
    take: 4,
  });

  // ── Everything below feeds the long-form profile ─────────────────────────
  // The packet is the writer's ONLY source, so anything the profile should be
  // able to mention has to be gathered here as a verified number.

  const detailed = await getManagerProfileDetailed(managerId);
  const seasonFacts: ManagerSeasonFact[] = (detailed?.seasonLines ?? [])
    .filter((line) => line.wins + line.losses + line.ties > 0)
    .map((line) => ({
      year: line.year,
      era: line.dataSource === "ESPN" ? "ESPN" : line.dataSource === "SLEEPER" ? "Sleeper" : "Manual",
      record: `${line.wins}-${line.losses}${line.ties ? `-${line.ties}` : ""}`,
      pointsFor: Number(line.pointsFor.toFixed(1)),
      pointsAgainst: Number(line.pointsAgainst.toFixed(1)),
      regularSeasonRank: line.regularSeasonRank,
      finalRank: line.finalRank,
      madePlayoffs: line.madePlayoffs,
      isChampion: line.isChampion,
      teamName: line.teamName,
    }));

  const eras: ManagerEraFact[] = (detailed?.eraStats ?? [])
    .filter((era) => era.key !== "CAREER")
    .map((era) => ({
      label: era.label,
      years: era.years,
      seasons: era.seasonsPlayed,
      record: `${era.wins}-${era.losses}${era.ties ? `-${era.ties}` : ""}`,
      winPct: era.winningPercentage,
      pointsForPerGame: era.pointsForPerGame,
      championships: era.championships,
      playoffAppearances: era.playoffAppearances,
      bestFinish: era.bestFinish,
    }));

  const championshipRows = await prisma.championship.findMany({
    where: { championManagerId: managerId },
    select: { season: { select: { year: true } } },
    orderBy: { season: { year: "asc" } },
  });

  const regularGames = games.filter((g) => !g.isPlayoff);
  const careerPpg = regularGames.length
    ? Number((regularGames.reduce((s, g) => s + g.pointsFor, 0) / regularGames.length).toFixed(1))
    : null;
  const recentYears = [...new Set(seasonFacts.map((s) => s.year))].sort((a, b) => b - a).slice(0, 3);
  const recentGames = regularGames.filter((g) => recentYears.includes(g.season));
  const recentPpg = recentGames.length
    ? Number((recentGames.reduce((s, g) => s + g.pointsFor, 0) / recentGames.length).toFixed(1))
    : null;
  const trajectory =
    careerPpg == null || recentPpg == null
      ? "not enough data"
      : recentPpg > careerPpg + 4
        ? `scoring ${(recentPpg - careerPpg).toFixed(1)} pts/gm above their career rate over the last ${recentYears.length} seasons`
        : recentPpg < careerPpg - 4
          ? `scoring ${(careerPpg - recentPpg).toFixed(1)} pts/gm below their career rate over the last ${recentYears.length} seasons`
          : "scoring in line with their career rate recently";

  // Draft / waiver / trade behaviour. Only claims the data can actually carry.
  const [assets, r1picks, allPicks] = await Promise.all([
    prisma.transactionAsset.findMany({
      where: { managerId, direction: "ADD" },
      select: { transaction: { select: { type: true, faabSpent: true, season: { select: { year: true } } } } },
    }),
    prisma.draftPick.findMany({
      where: { managerId, round: 1 },
      select: { player: { select: { position: true } }, draft: { select: { season: { select: { year: true } } } } },
    }),
    prisma.draftPick.count({ where: { managerId } }),
  ]);

  const tendencies: string[] = [];
  const tradeCount = assets.filter((a) => a.transaction.type === "TRADE").length;
  const waiverCount = assets.filter((a) => a.transaction.type === "WAIVER").length;
  const faCount = assets.filter((a) => a.transaction.type === "FREE_AGENT").length;
  const txSeasons = [...new Set(assets.map((a) => a.transaction.season.year))].sort();
  if (assets.length > 0) {
    tendencies.push(
      `Transaction record covers ${txSeasons.join(", ")} only: ${tradeCount} players acquired by trade, ${waiverCount} on waivers, ${faCount} as free agents.`,
    );
  }
  if (r1picks.length > 0) {
    const positions = r1picks.map((p) => p.player?.position ?? "unknown");
    const counts = positions.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p]: (acc[p] ?? 0) + 1 }), {});
    const summaryText = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([pos, n]) => `${n} ${pos}`)
      .join(", ");
    tendencies.push(`First-round picks across ${r1picks.length} drafts: ${summaryText}.`);
  }
  if (allPicks > 0) tendencies.push(`${allPicks} total draft picks on record.`);

  // Head-to-head against EVERY opponent, not just the top few.
  //
  // The relationship summaries handed to the writer are prose and contain their
  // own numbers, which are not the verified head-to-head. Supplying only four
  // records left the model reaching into that prose for the rest — one bio
  // reported a 0-5 head-to-head that appears nowhere in the data. Giving it the
  // full verified set removes the temptation.
  const topRivalries = (detailed?.headToHead ?? []).map((h) => ({
    opponent: h.opponentName,
    record: `${h.wins}-${h.losses}${h.ties ? `-${h.ties}` : ""}`,
    note: `${h.wins + h.losses + h.ties} meetings, ${h.pointsForAvg} pts/gm scored`,
  }));

  // Private, admin-only context used purely as tone guidance. These are the
  // ALREADY-CONSOLIDATED profiles; the raw chat archive is never re-read.
  const [commProfile, leagueProfile, relationshipRows] = await Promise.all([
    prisma.managerCommunicationProfile.findUnique({
      where: { managerId },
      select: { styleSummary: true, profile: true, isMock: true },
    }),
    prisma.leagueProfile.findFirst({
      select: { humorStyle: true, communicationStyle: true, dynamics: true, traditions: true, isMock: true },
    }),
    prisma.managerRelationship.findMany({
      where: { OR: [{ managerAId: managerId }, { managerBId: managerId }] },
      orderBy: { intensity: "desc" },
      take: 4,
      select: {
        summary: true,
        relationshipType: true,
        isMock: true,
        managerA: { select: { id: true, displayName: true } },
        managerB: { select: { id: true, displayName: true } },
      },
    }),
  ]);

  const leagueVoice =
    leagueProfile && !leagueProfile.isMock
      ? [
          leagueProfile.humorStyle,
          leagueProfile.communicationStyle,
          leagueProfile.dynamics,
          leagueProfile.traditions,
        ]
          .filter((part): part is string => !!part && part.trim().length > 0)
          .join("\n\n")
      : null;

  const relationships = relationshipRows
    .filter((r) => !r.isMock)
    .map((r) => ({
      withManager: r.managerA.id === managerId ? r.managerB.displayName : r.managerA.displayName,
      type: r.relationshipType,
      summary: r.summary,
    }));

  const unavailable: string[] = [];
  if (txSeasons.length === 0) {
    unavailable.push("No transaction history at all is on record for this manager.");
  } else if (txSeasons[0] > (years[0] ?? txSeasons[0])) {
    unavailable.push(
      `Waiver, free-agent and trade history exists only for ${txSeasons.join(", ")}. ESPN does not retain transactions for its archived seasons, so nothing can be said about this manager's trading or waiver activity before ${txSeasons[0]}.`,
    );
  }
  unavailable.push(
    "Per-player weekly scoring is not on record for the ESPN seasons, so lineup-setting and bench decisions from that era cannot be assessed.",
  );

  const bestLine = detailed?.bestSeason;
  const worstLine = detailed?.worstSeason;
  const asFact = (year: number | undefined) => seasonFacts.find((s) => s.year === year) ?? null;

  return {
    managerName: manager.displayName,
    yearsActive: years.length ? (years[0] === years.at(-1) ? `${years[0]}` : `${years[0]}–${years.at(-1)}`) : "—",
    seasonsPlayed: played.length,
    careerRecord: `${summary.record.wins}-${summary.record.losses}${summary.record.ties ? `-${summary.record.ties}` : ""}`,
    winPct: Number(summary.winningPercentage.toFixed(3)),
    playoffRecord:
      titleBracket.record.wins + titleBracket.record.losses > 0
        ? `${titleBracket.record.wins}-${titleBracket.record.losses}`
        : "no championship-bracket games played",
    lastPlaceYears: detailed?.lastPlaceYears ?? [],
    championships: champs,
    finalsAppearances: finals,
    playoffAppearances: playoffAppearances(finishes),
    bestFinish: finishRanks.length ? Math.min(...finishRanks) : null,
    worstFinish: finishRanks.length ? Math.max(...finishRanks) : null,
    currentTeamName: manager.fantasyTeams.at(-1)?.teamName ?? "—",
    statsComplete: !(league && earliest && league.foundedYear < earliest.year),
    approvedKnowledge: knowledge.map((k) => k.title),
    historyNotes: historySections.map((h) => `${h.year ?? ""} ${h.title}`.trim()),
    eras,
    seasons: seasonFacts,
    championshipYears: championshipRows.map((c) => c.season.year),
    bestSeason: asFact(bestLine?.year),
    worstSeason: asFact(worstLine?.year),
    careerPointsPerGame: careerPpg,
    recentPointsPerGame: recentPpg,
    recentTrajectory: trajectory,
    allPlayRecord: detailed ? `${detailed.stats.allPlay.wins}-${detailed.stats.allPlay.losses}` : "—",
    allPlayWinPct: detailed?.stats.allPlay.winPct ?? 0,
    luckScore: detailed?.luck.career?.score ?? null,
    luckSummary: detailed?.luck.career
      ? detailed.luck.career.score == null
        ? "too few games to measure schedule luck"
        : `${detailed.luck.career.label} (${detailed.luck.career.score}/100, where 50 is neutral)`
      : "too few games to measure schedule luck",
    topRivalries,
    tendencies,
    // Mock profiles are placeholder text and would mislead the writer.
    communicationStyle: commProfile && !commProfile.isMock ? commProfile.styleSummary : null,
    personalityProfile: commProfile && !commProfile.isMock ? commProfile.profile : null,
    leagueVoice,
    relationships,
    unavailable,
  };
}

/** Return the saved summary, generating + saving it once if missing. */
export async function getOrCreateManagerPerformanceSummary(managerId: string): Promise<{ text: string; isMock: boolean } | null> {
  const existing = await prisma.managerPerformanceSummary.findUnique({ where: { managerId } });
  if (existing) return { text: existing.summary, isMock: existing.isMock };
  return regenerateManagerPerformanceSummary(managerId);
}

/** Force-regenerate + save the summary (admin action). */
export async function regenerateManagerPerformanceSummary(managerId: string): Promise<{ text: string; isMock: boolean } | null> {
  const packet = await buildPerfPacket(managerId);
  if (!packet || packet.seasonsPlayed === 0) return null;
  const safeguards = await getContentSafeguards();
  const result = await generateManagerPerformanceSummary(packet, safeguards);
  // Don't persist placeholder text — only real AI summaries are saved, so the
  // public Managers page stays clean until a key is configured (on Vercel).
  if (result.isMock) return { text: result.text, isMock: true };
  const hash = JSON.stringify(packet).length.toString();
  await prisma.managerPerformanceSummary.upsert({
    where: { managerId },
    create: { managerId, summary: result.text, providerName: result.providerName, isMock: false, inputHash: hash },
    update: { summary: result.text, providerName: result.providerName, isMock: false, inputHash: hash },
  });
  return { text: result.text, isMock: false };
}
