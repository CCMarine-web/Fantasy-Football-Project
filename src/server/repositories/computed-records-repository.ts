import { prisma } from "@/lib/db";
import { sharedRecord } from "@/server/stats/finishes";
import { longestLosingStreak, longestWinningStreak } from "@/server/stats";
import type { GameResult } from "@/server/stats/types";
import { loadVerifiedGames } from "./verified-games";
import { cached, CACHE_TAGS } from "@/server/cache";
import { computeRecordWatch, type RecordWatchItem } from "@/server/stats/record-watch";

export interface RecordEntry {
  key: string;
  label: string;
  value: string;
  holderName: string;
  holderManagerId: string | null;
  detail: string;
  /**
   * The all-time top 10 for this record, #1 first (the headline is top[0], so
   * the two can never disagree). Ties share a rank ("T-3") and everyone tied
   * at 10th is listed, so a list can run past ten. Absent for records with no
   * ranking (streaks, titles).
   */
  top?: RankedRow[];
  /** Further entries tied at the last listed rank but cut for length. */
  topMoreTied?: number;
}

export interface RankedRow {
  /** Competition rank: two tied for 2nd are both 2, the next is 4. */
  rank: number;
  tied: boolean;
  value: string;
  holderName: string;
  holderManagerId: string | null;
  detail: string;
}

const TOP_N = 10;
/** Hard cap so a pile of identical values can't turn a top 10 into a top 40. */
const TOP_CAP = 20;

/**
 * Sorts (stably, so equal values keep row order) and ranks to the top 10,
 * comparing values at the precision they are shown (`scale`) so a float wobble
 * is never a different rank.
 */
export function rankTop<T>(
  items: T[],
  valueOf: (t: T) => number,
  direction: "desc" | "asc",
  toRow: (t: T) => Omit<RankedRow, "rank" | "tied">,
  scale = 100,
): { rows: RankedRow[]; moreTied: number } {
  const keyOf = (t: T) => Math.round(valueOf(t) * scale);
  const sorted = [...items].sort((a, b) =>
    direction === "desc" ? valueOf(b) - valueOf(a) : valueOf(a) - valueOf(b),
  );
  const counts = new Map<number, number>();
  for (const t of sorted) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1);
  const rows: RankedRow[] = [];
  let moreTied = 0;
  let rank = 0;
  let prevKey: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const k = keyOf(sorted[i]);
    if (k !== prevKey) rank = i + 1;
    prevKey = k;
    if (rank > TOP_N) break;
    if (rows.length >= TOP_CAP) {
      moreTied += 1;
      continue;
    }
    rows.push({ rank, tied: (counts.get(k) ?? 0) > 1, ...toRow(sorted[i]) });
  }
  return { rows, moreTied };
}

/** A record entry whose headline is #1 of its own ranked list. */
function rankedEntry(
  key: string,
  label: string,
  ranked: { rows: RankedRow[]; moreTied: number },
): RecordEntry | null {
  const first = ranked.rows[0];
  if (!first) return null;
  return {
    key,
    label,
    value: first.value,
    holderName: first.holderName,
    holderManagerId: first.holderManagerId,
    detail: first.detail,
    top: ranked.rows,
    topMoreTied: ranked.moreTied,
  };
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
 *
 * Games come from the shared verified-games loader, which requires BOTH sides
 * to be a real contest. Without that the all-time lowest score was 0.0 three
 * weeks running from a manager who had stopped setting a lineup, and the
 * all-time biggest blowout read "167.4-0.0" against the same abandoned team.
 */
export const getComputedRecords = cached(buildComputedRecords, ["computed-records"], {
  tags: [CACHE_TAGS.league],
});

async function buildComputedRecords(): Promise<RecordEntry[]> {
  const rows = await loadVerifiedGames();
  const games: Mt[] = rows.map((r) => ({
    fantasyTeamId: r.fantasyTeamId,
    managerId: r.managerId,
    managerName: r.managerName,
    score: r.score,
    isWinner: r.isWinner,
    week: r.week,
    year: r.year,
    isPlayoff: r.isPlayoff,
    seasonId: r.seasonId,
    opponentTeamId: r.opponentTeamId,
    opponentName: r.opponentManagerName,
    opponentScore: r.opponentScore,
  }));
  if (games.length === 0) return [];

  const entries: RecordEntry[] = [];
  // Postseason games are named as such. Without it a title-game score and a
  // week-4 score look like the same kind of achievement.
  const where = (g: Mt) => `Week ${g.week}, ${g.year}${g.isPlayoff ? " (postseason)" : ""}`;
  const vs = (g: Mt) => `vs ${g.opponentName} · ${where(g)}`;

  // Each headline is #1 of its own top-10 list. Ties are ranked together,
  // never broken by row order.
  const push = (e: RecordEntry | null) => {
    if (e) entries.push(e);
  };
  const gameRow = (g: Mt, value: string, detail: string) => ({
    value,
    holderName: g.managerName,
    holderManagerId: g.managerId,
    detail,
  });

  // Highest / lowest single-game score.
  push(rankedEntry("high-game", "Highest Single-Game Score", rankTop(games, (g) => g.score, "desc", (g) => gameRow(g, g.score.toFixed(1), vs(g)))));
  push(rankedEntry("low-game", "Lowest Single-Game Score", rankTop(games, (g) => g.score, "asc", (g) => gameRow(g, g.score.toFixed(1), vs(g)))));

  // Highest scoring loss / lowest scoring win.
  const losses = games.filter((g) => g.isWinner === false);
  const wins = games.filter((g) => g.isWinner === true);
  push(
    rankedEntry("high-loss", "Highest Score in a Loss", rankTop(losses, (g) => g.score, "desc", (g) =>
      gameRow(g, g.score.toFixed(1), `lost ${g.score.toFixed(1)}–${g.opponentScore.toFixed(1)} to ${g.opponentName} · ${where(g)}`),
    )),
  );
  push(
    rankedEntry("low-win", "Lowest Score in a Win", rankTop(wins, (g) => g.score, "asc", (g) =>
      gameRow(g, g.score.toFixed(1), `won ${g.score.toFixed(1)}–${g.opponentScore.toFixed(1)} over ${g.opponentName} · ${where(g)}`),
    )),
  );

  // Biggest blowout / closest game (from the winner's perspective, decided games).
  const decidedWins = wins.filter((g) => g.score !== g.opponentScore);
  const margin = (g: Mt) => g.score - g.opponentScore;
  push(
    rankedEntry("blowout", "Biggest Blowout", rankTop(decidedWins, margin, "desc", (g) =>
      gameRow(g, `${margin(g).toFixed(1)} pts`, `${g.score.toFixed(1)}–${g.opponentScore.toFixed(1)} over ${g.opponentName} · ${where(g)}`),
    )),
  );
  // Under a point, both scores to two decimals: a 0.08 win must not read
  // "122.9–122.8", which is a 0.1 margin.
  push(
    rankedEntry("closest", "Closest Game", rankTop(decidedWins, margin, "asc", (g) => {
      const d = margin(g) < 1 ? 2 : 1;
      return gameRow(g, `${margin(g).toFixed(2)} pts`, `${g.score.toFixed(d)}–${g.opponentScore.toFixed(d)} over ${g.opponentName} · ${where(g)}`);
    })),
  );

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
    // Only finished seasons: three weeks of an unfinished one (3-0, 0-3) were
    // beating every complete 14-game season for best and worst record.
    where: { season: { status: "COMPLETE" }, OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }, { pointsFor: { gt: 0 } }] },
    include: { manager: { select: { id: true, displayName: true } }, season: { select: { year: true } } },
  });
  if (teams.length) {
    type Team = (typeof teams)[number];
    const pct = (t: Team) => {
      const g = t.wins + t.losses + t.ties;
      return g ? (t.wins + 0.5 * t.ties) / g : 0;
    };
    const rec = (t: Team) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;
    const teamRow = (t: Team, value: string, detail: string) => ({
      value,
      holderName: t.manager.displayName,
      holderManagerId: t.manager.id,
      detail,
    });
    // Equal records share a rank. Within a tie, more points (best) or fewer
    // (worst) is listed first — the order only, never the rank.
    const byPf = [...teams].sort((a, b) => b.pointsFor - a.pointsFor);
    push(rankedEntry("season-points", "Most Points in a Season", rankTop(teams, (t) => t.pointsFor, "desc", (t) => teamRow(t, t.pointsFor.toFixed(1), `${t.season.year} season`))));
    push(rankedEntry("best-record", "Best Season Record", rankTop(byPf, pct, "desc", (t) => teamRow(t, rec(t), `${t.season.year} · ${t.pointsFor.toFixed(0)} PF`), 1e6)));
    push(rankedEntry("worst-record", "Worst Season Record", rankTop([...byPf].reverse(), pct, "asc", (t) => teamRow(t, rec(t), `${t.season.year} · ${t.pointsFor.toFixed(0)} PF`), 1e6)));
  }

  // Longest win / loss streaks all-time (per manager, across career).
  const logByManager = new Map<string, { name: string; games: GameResult[] }>();
  for (const g of games) {
    const e = logByManager.get(g.managerId) ?? { name: g.managerName, games: [] };
    e.games.push({ week: g.week, season: g.year, isPlayoff: g.isPlayoff, pointsFor: g.score, pointsAgainst: g.opponentScore, opponentId: g.opponentTeamId, result: g.isWinner === true ? "W" : g.isWinner === false ? "L" : "T" });
    logByManager.set(g.managerId, e);
  }
  // A record two managers share names both; it was picked by row order.
  const winStreaks = [...logByManager].map(([id, e]) => ({ id, name: e.name, len: longestWinningStreak(e.games) }));
  const lossStreaks = [...logByManager].map(([id, e]) => ({ id, name: e.name, len: longestLosingStreak(e.games) }));
  const bestWin = sharedRecord(winStreaks);
  const bestLoss = sharedRecord(lossStreaks);
  if (bestWin) entries.push({ key: "win-streak", label: "Longest Win Streak", value: `${bestWin.len} games`, holderName: bestWin.name, holderManagerId: bestWin.id, detail: bestWin.shared ? "all-time · shared" : "all-time" });
  if (bestLoss) entries.push({ key: "loss-streak", label: "Longest Losing Streak", value: `${bestLoss.len} games`, holderName: bestLoss.name, holderManagerId: bestLoss.id, detail: bestLoss.shared ? "all-time · shared" : "all-time" });

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

/**
 * Active record chases for the season in progress (stats/record-watch.ts):
 * streaks near the all-time marks, season-high/low games in the all-time top
 * 10, and season pace against COMPLETED-season records. Empty outside a season.
 */
export const getRecordWatch = cached(
  async (): Promise<{ seasonYear: number; items: RecordWatchItem[] } | null> => {
    const season = await prisma.season.findFirst({ where: { isCurrent: true, status: "IN_PROGRESS" } });
    if (!season) return null;
    const [rows, completed, current] = await Promise.all([
      loadVerifiedGames(),
      prisma.fantasyTeam.findMany({
        where: { season: { status: "COMPLETE" } },
        select: { wins: true, losses: true, ties: true, pointsFor: true, manager: { select: { displayName: true } }, season: { select: { year: true } } },
      }),
      prisma.fantasyTeam.findMany({
        where: { seasonId: season.id },
        select: { managerId: true, wins: true, losses: true, ties: true, pointsFor: true, manager: { select: { displayName: true } } },
      }),
    ]);
    const items = computeRecordWatch({
      seasonYear: season.year,
      regularSeasonWeeks: season.regularSeasonWeeks,
      games: rows.map((r) => ({
        managerId: r.managerId,
        managerName: r.managerName,
        year: r.year,
        week: r.week,
        isPlayoff: r.isPlayoff,
        score: r.score,
        opponentScore: r.opponentScore,
        opponentName: r.opponentManagerName,
      })),
      completedSeasons: completed
        .filter((t) => t.wins + t.losses + t.ties > 0)
        .map((t) => ({ managerName: t.manager.displayName, year: t.season.year, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor })),
      currentTeams: current.map((t) => ({ managerId: t.managerId, managerName: t.manager.displayName, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor })),
    });
    return { seasonYear: season.year, items };
  },
  ["record-watch"],
  { tags: [CACHE_TAGS.league] },
);

export interface ScoreDistribution {
  /** 10-point bins, lowest first; `from` is inclusive, `to` exclusive. */
  bins: { from: number; to: number; count: number }[];
  total: number;
  mean: number;
  median: number;
  high: { score: number; managerName: string; year: number; week: number };
  low: { score: number; managerName: string; year: number; week: number };
}

/**
 * Every verified weekly score ever, in 10-point bins — the same rows the
 * single-game records are read from, so the record high and low sit at the
 * ends of this histogram by construction. Null with no games.
 */
export const getScoreDistribution = cached(
  async (): Promise<ScoreDistribution | null> => {
    const rows = await loadVerifiedGames();
    if (rows.length === 0) return null;
    const scores = rows.map((r) => r.score).sort((a, b) => a - b);
    const hi = rows.reduce((a, b) => (b.score > a.score ? b : a));
    const lo = rows.reduce((a, b) => (b.score < a.score ? b : a));
    const first = Math.floor(scores[0] / 10) * 10;
    const last = Math.floor(scores[scores.length - 1] / 10) * 10;
    const counts = new Map<number, number>();
    for (const s of scores) {
      const b = Math.floor(s / 10) * 10;
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const bins: ScoreDistribution["bins"] = [];
    for (let from = first; from <= last; from += 10) bins.push({ from, to: from + 10, count: counts.get(from) ?? 0 });
    const mid = Math.floor(scores.length / 2);
    return {
      bins,
      total: scores.length,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      median: scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2,
      high: { score: hi.score, managerName: hi.managerName, year: hi.year, week: hi.week },
      low: { score: lo.score, managerName: lo.managerName, year: lo.year, week: lo.week },
    };
  },
  ["score-distribution"],
  { tags: [CACHE_TAGS.league] },
);
