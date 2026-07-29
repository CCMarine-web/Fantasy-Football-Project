import { prisma } from "@/lib/db";
import type { MatchupCardData, StandingsRow } from "@/types/view-models";
import { getCurrentSeason } from "./season-repository";
import { getSeasonPhase, type SeasonPhaseInfo } from "./season-phase";
import { getStandingsForSeason } from "./standings-repository";
import { getMatchupsForWeek } from "./matchup-repository";
import { getTransactionsPage, type TransactionView } from "./transaction-repository";
import {
  getPowerRankingsPreview,
  type PowerRankingsView,
  type PowerRankingView,
} from "./power-rankings-repository";
import { getWeeklyAwards, type WeeklyAwardView } from "./weekly-awards-repository";
import { getFeaturedMatchup, type FeaturedMatchupView } from "./featured-matchup-repository";
import { loadVerifiedGames } from "./verified-games";
import { longestLosingStreak, longestWinningStreak } from "@/server/stats";
import type { GameResult } from "@/server/stats/types";

/**
 * The Weekly League Hub — everything a manager wants on a Tuesday morning, on
 * one page.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 * Answering "what happened this week" meant visiting four separate pages —
 * Matchups, Standings, Transactions and News — each of which re-derived the
 * same season and week for itself. This assembles the lot in one pass, from
 * the same repositories those pages use, so the hub can never disagree with
 * the detailed views it links to.
 *
 * ── What it does NOT do ───────────────────────────────────────────────────
 * Generate anything. Every figure here is read from synced data or from
 * already-persisted AI copy; nothing calls a model at render time.
 */

export interface StreakLine {
  managerId: string;
  managerName: string;
  kind: "WIN" | "LOSS";
  length: number;
}

export interface WeeklyNewsItem {
  id: string;
  title: string;
  href: string;
  kind: string;
  seasonYear: number;
  week: number | null;
}

/**
 * The state of the automated data sync, so the page can say how current it is.
 *
 * A page that silently shows week-4 data in week 6 is worse than one that admits
 * it: the reader has no way to tell, and every number on it is wrong in the same
 * direction. `isStale` is set when the last attempt failed, or when the most
 * recent successful one is old enough that a weekly sync should have run since.
 */
export interface SyncState {
  /** When the last SUCCESSFUL sync of any kind finished. */
  lastSuccessAt: Date | null;
  /** Set when the most recent attempt did not succeed. */
  lastFailure: { at: Date; message: string | null } | null;
  isStale: boolean;
  /** Plain-English reason, when stale. */
  staleReason: string | null;
}

export interface WeeklyHubData {
  seasonYear: number;
  seasonId: string;
  phase: SeasonPhaseInfo;
  /** How current the underlying data is. */
  sync: SyncState;
  /** The featured game for this week, chosen deterministically. */
  featured: FeaturedMatchupView | null;
  /** The week being shown; null before the season starts. */
  week: number | null;
  /** Every week with a scheduled matchup, ascending. */
  availableWeeks: number[];
  /** Headline + body of the week's published article, when there is one. */
  headline: { title: string; excerpt: string; href: string } | null;
  matchups: MatchupCardData[];
  standings: StandingsRow[];
  awards: WeeklyAwardView[];
  powerRankings: PowerRankingView[];
  powerRankingsTitle: string;
  /** Completed moves for the week (or the season, before it starts). */
  successfulTransactions: TransactionView[];
  /** Claims that lost — kept behind an expandable control on the page. */
  failedClaims: TransactionView[];
  /** True when transaction data exists for this season at all. */
  hasTransactionData: boolean;
  /** Active win and loss streaks worth mentioning, longest first. */
  streaks: StreakLine[];
  /** Season-long notable marks: highest and lowest scores so far. */
  seasonNotables: { label: string; value: string; managerName: string; detail: string }[];
  recentNews: WeeklyNewsItem[];
}

/** The three power-ranking states, named the same way the dedicated page names them. */
function powerRankingsTitleFor(mode: PowerRankingsView["mode"], week: number): string {
  if (mode === "IN_SEASON") return `Power Rankings — updated through Week ${week}`;
  if (mode === "MANAGER_BASELINE") return "Manager Baseline Rankings";
  return "Preseason Power Rankings";
}

/**
 * Current win/loss streaks, from verified regular-season games in the season
 * shown. Only streaks of three or more are returned — a two-game run is not a
 * streak, it is a fortnight.
 */
const MIN_STREAK = 3;

function currentStreak(games: GameResult[]): { kind: "WIN" | "LOSS"; length: number } | null {
  const chronological = [...games].sort((a, b) => a.season - b.season || a.week - b.week);
  const last = chronological.at(-1);
  if (!last || last.result === "T") return null;
  let length = 0;
  for (let i = chronological.length - 1; i >= 0; i -= 1) {
    if (chronological[i].result !== last.result) break;
    length += 1;
  }
  return { kind: last.result === "W" ? "WIN" : "LOSS", length };
}

/**
 * How long after a successful sync the data counts as stale.
 *
 * The cron runs weekly (Tuesdays at noon — see vercel.json). Ten days allows a
 * full cycle plus a comfortable margin, so a single late run does not cry wolf,
 * while a sync that has genuinely stopped is caught within a few days.
 */
const STALE_AFTER_MS = 10 * 24 * 60 * 60 * 1000;

async function loadSyncState(): Promise<SyncState> {
  const [lastSuccess, lastAttempt] = await Promise.all([
    prisma.dataSyncLog.findFirst({
      where: { status: "SUCCESS", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.dataSyncLog.findFirst({
      // RUNNING rows are excluded: a sync in flight is not a failure, and one
      // abandoned mid-run would otherwise read as the newest attempt forever.
      where: { status: { in: ["SUCCESS", "FAILED", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
      select: { status: true, errorMessage: true, startedAt: true, finishedAt: true },
    }),
  ]);

  const lastSuccessAt = lastSuccess?.finishedAt ?? null;
  const failed = lastAttempt && lastAttempt.status !== "SUCCESS";
  const lastFailure = failed
    ? { at: lastAttempt.finishedAt ?? lastAttempt.startedAt, message: lastAttempt.errorMessage }
    : null;

  const age = lastSuccessAt ? Date.now() - lastSuccessAt.getTime() : null;
  const overdue = age != null && age > STALE_AFTER_MS;

  let staleReason: string | null = null;
  if (failed) {
    staleReason =
      lastAttempt.status === "PARTIAL"
        ? "The last automated sync only partly completed, so some figures below may be behind."
        : "The last automated sync failed, so the figures below may be behind.";
  } else if (overdue) {
    const days = Math.floor((age as number) / (24 * 60 * 60 * 1000));
    staleReason = `The last successful sync was ${days} days ago. The weekly job may have stopped.`;
  } else if (lastSuccessAt == null) {
    staleReason = "No automated sync has completed yet, so this is whatever was last imported by hand.";
  }

  return { lastSuccessAt, lastFailure, isStale: staleReason != null, staleReason };
}

export async function getWeeklyHub(requestedWeek?: number): Promise<WeeklyHubData | null> {
  const season =
    (await getCurrentSeason()) ??
    (await prisma.season.findFirst({
      where: { fantasyTeams: { some: {} } },
      orderBy: { year: "desc" },
    }));
  if (!season) return null;

  const phase = await getSeasonPhase(season.id, season.year);

  const scheduledWeeks = await prisma.matchup.findMany({
    where: { seasonId: season.id },
    distinct: ["week"],
    select: { week: true },
    orderBy: { week: "asc" },
  });
  const availableWeeks = scheduledWeeks.map((w) => w.week);

  // The week to show: whatever was asked for if it exists, else the latest week
  // with a score, else the first scheduled week, else nothing at all.
  const week =
    requestedWeek != null && availableWeeks.includes(requestedWeek)
      ? requestedWeek
      : (phase.currentWeek ?? availableWeeks[0] ?? null);

  const [standings, matchups, awards, power, transactions, verifiedGames, articles, sync, featured] =
    await Promise.all([
      getStandingsForSeason(season.id),
      week != null ? getMatchupsForWeek(season.id, week, season.year) : Promise.resolve([]),
      week != null ? getWeeklyAwards(season.id, week) : Promise.resolve([]),
      getPowerRankingsPreview(5),
      getTransactionsPage({
        seasonYear: season.year,
        week: week ?? undefined,
        successOnly: false,
        limit: 200,
      }),
      loadVerifiedGames({ seasonId: season.id }),
      prisma.article.findMany({
        where: { status: "PUBLISHED", deletedAt: null },
        include: {
          season: { select: { year: true } },
          sections: { orderBy: { order: "asc" }, take: 1, select: { body: true } },
        },
        orderBy: [{ season: { year: "desc" } }, { week: "desc" }, { publishedAt: "desc" }],
        take: 6,
      }),
      loadSyncState(),
      // The featured game is only meaningful once a week has a schedule.
      week != null
        ? getFeaturedMatchup(season.id, season.year, week)
        : Promise.resolve(null),
    ]);

  // The week's own article, if one was published, becomes the headline.
  const weekArticle = articles.find((a) => a.season.year === season.year && a.week === week);
  const headline = weekArticle
    ? {
        title: weekArticle.title,
        excerpt: (weekArticle.sections[0]?.body ?? "").split(/\n\s*\n/)[0]?.slice(0, 400) ?? "",
        href: `/news/${weekArticle.season.year}/${weekArticle.week}`,
      }
    : null;

  const recentNews: WeeklyNewsItem[] = articles
    .filter((a) => a.id !== weekArticle?.id)
    .slice(0, 4)
    .map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.type,
      seasonYear: a.season.year,
      week: a.week,
      href: a.week ? `/news/${a.season.year}/${a.week}` : `/history/${a.season.year}`,
    }));

  // Streaks, from this season's verified regular-season games only.
  const byManager = new Map<string, { name: string; games: GameResult[] }>();
  for (const row of verifiedGames) {
    if (row.isPlayoff) continue;
    const entry = byManager.get(row.managerId) ?? { name: row.managerName, games: [] };
    entry.games.push({
      week: row.week,
      season: row.year,
      isPlayoff: false,
      pointsFor: row.score,
      pointsAgainst: row.opponentScore,
      opponentId: row.opponentManagerId,
      result: row.isWinner === true ? "W" : row.isWinner === false ? "L" : "T",
    });
    byManager.set(row.managerId, entry);
  }
  const streaks: StreakLine[] = [];
  for (const [managerId, entry] of byManager) {
    const streak = currentStreak(entry.games);
    if (!streak || streak.length < MIN_STREAK) continue;
    streaks.push({ managerId, managerName: entry.name, kind: streak.kind, length: streak.length });
  }
  streaks.sort((a, b) => b.length - a.length || a.managerName.localeCompare(b.managerName));

  // Season notables: the marks a reader would actually mention this week.
  const seasonNotables: WeeklyHubData["seasonNotables"] = [];
  if (verifiedGames.length > 0) {
    const high = verifiedGames.reduce((a, b) => (b.score > a.score ? b : a));
    const low = verifiedGames.reduce((a, b) => (b.score < a.score ? b : a));
    seasonNotables.push({
      label: "Highest score this season",
      value: high.score.toFixed(1),
      managerName: high.managerName,
      detail: `Week ${high.week}`,
    });
    seasonNotables.push({
      label: "Lowest score this season",
      value: low.score.toFixed(1),
      managerName: low.managerName,
      detail: `Week ${low.week}`,
    });

    let bestRun = { name: "", length: 0 };
    let worstRun = { name: "", length: 0 };
    for (const entry of byManager.values()) {
      const w = longestWinningStreak(entry.games);
      const l = longestLosingStreak(entry.games);
      if (w > bestRun.length) bestRun = { name: entry.name, length: w };
      if (l > worstRun.length) worstRun = { name: entry.name, length: l };
    }
    if (bestRun.length >= MIN_STREAK) {
      seasonNotables.push({
        label: "Longest win run",
        value: `${bestRun.length} games`,
        managerName: bestRun.name,
        detail: `${season.year} regular season`,
      });
    }
    if (worstRun.length >= MIN_STREAK) {
      seasonNotables.push({
        label: "Longest losing run",
        value: `${worstRun.length} games`,
        managerName: worstRun.name,
        detail: `${season.year} regular season`,
      });
    }
  }

  return {
    seasonYear: season.year,
    seasonId: season.id,
    phase,
    sync,
    featured,
    week,
    availableWeeks,
    headline,
    matchups,
    standings,
    awards,
    powerRankings: power?.rows ?? [],
    powerRankingsTitle: powerRankingsTitleFor(power?.mode ?? "MANAGER_BASELINE", power?.throughWeek ?? 0),
    successfulTransactions: transactions.transactions.filter((t) => t.outcome !== "FAILED"),
    failedClaims: transactions.transactions.filter((t) => t.outcome === "FAILED"),
    hasTransactionData: transactions.periods.some((p) => p.year === season.year),
    streaks,
    seasonNotables,
    recentNews,
  };
}
