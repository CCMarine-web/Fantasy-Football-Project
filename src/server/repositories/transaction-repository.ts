import { prisma } from "@/lib/db";
import type { Prisma, TransactionStatus, TransactionType } from "@/generated/prisma/client";
import { collapseChurn, describeChurn, type ChurnSummary } from "@/server/stats/transaction-churn";
import { activityGrid, pickupStint, type ActivityCell, type StintRow } from "@/server/stats/transaction-activity";

/**
 * The transaction wire.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 * The page rendered every row identically, so a failed waiver claim looked
 * exactly like a successful one. Seven managers put in for Jerome Ford in week
 * 2 of 2023; one got him and six did not, and the wire showed all seven as
 * though every team had acquired the same player. 163 of the 383 waiver rows
 * on record are failed claims.
 *
 * It also had no default period, so the first thing a visitor saw was a
 * hundred rows spanning three seasons with the filter boxes empty.
 *
 * ── What this returns instead ─────────────────────────────────────────────
 * Every row carries a plain-English kind and outcome, players are split into
 * what came in and what went out, and the filter options are the seasons and
 * weeks that actually have data — so the controls can never offer a period
 * that shows nothing.
 */

export type TransactionOutcome = "SUCCESSFUL" | "FAILED" | "PENDING" | "REVERSED";

export interface TransactionAssetView {
  id: string;
  playerName: string | null;
  position: string | null;
  teamName: string;
  managerId: string | null;
  managerName: string;
  /** A pick or FAAB rather than a player. */
  otherAsset: string | null;
}

export interface TransactionView {
  id: string;
  seasonYear: number;
  week: number | null;
  type: TransactionType;
  /**
   * What the move actually was, in the league's own words: "Add", "Drop",
   * "Add/Drop", "Successful waiver claim", "Failed waiver claim", "Trade" or
   * "Commissioner action".
   *
   * Derived from the assets, not from the platform's transaction type alone. A
   * free-agent transaction that both added and dropped a player is an add/drop,
   * and rendering it as a "Free-agent pickup" hid half of what happened.
   */
  kindLabel: string;
  outcome: TransactionOutcome;
  /** "Successful", "Failed claim", "Pending", "Reversed". */
  outcomeLabel: string;
  faabSpent: number | null;
  added: TransactionAssetView[];
  dropped: TransactionAssetView[];
  /** One-line description a reader can scan, e.g. "Patrick Schwing claimed …". */
  summary: string;
  processedAt: Date;
  /** Set when this row stands for several back-and-forth moves (see stats/transaction-churn.ts). */
  churn?: ChurnSummary;
}

export interface TransactionPeriod {
  year: number;
  /** Weeks with at least one transaction, ascending. */
  weeks: number[];
  count: number;
}

export interface TransactionsPage {
  transactions: TransactionView[];
  /** Seasons and weeks that actually contain transactions. */
  periods: TransactionPeriod[];
  /** The season being shown — the newest with data unless one was chosen. */
  seasonYear: number | null;
  week: number | null;
  type: TransactionType | null;
  /** True when only successful moves are shown. */
  successOnly: boolean;
  /** Seasons in the league that have no transaction data at all, and why. */
  seasonsWithoutData: number[];
  totalMatching: number;
  /** The manager filter in force, if any. */
  managerId: string | null;
  /** The player-name search in force, if any. */
  playerQuery: string | null;
  /** Every manager who appears in a transaction, for the filter control. */
  managerOptions: { id: string; displayName: string }[];
  /** How many rows are being shown, and whether there are more behind them. */
  shown: number;
  hasMore: boolean;
}

/**
 * Rows per page.
 *
 * The wire used to return 150 at once, which is a wall on a phone and a slow
 * query for a reader who wanted the last five moves. 25 is one comfortable
 * screenful; Load More adds another 25.
 */
export const TRANSACTIONS_PAGE_SIZE = 25;

/**
 * Ceiling on how much one request may load.
 *
 * Load More works by growing a `shown` count in the URL, which means the number
 * is attacker-supplied. Without a cap, `?shown=999999` is a free full-table scan
 * with every asset and manager joined.
 */
const MAX_SHOWN = 500;

/**
 * The seven kinds of move the league actually makes.
 *
 * A waiver claim's label carries its outcome, because "Waiver claim" beside a
 * greyed-out card was the only thing distinguishing the six managers who did
 * not get Jerome Ford from the one who did. Everything else is named by what
 * moved: an add, a drop, or both in one transaction.
 */
function kindLabelFor(
  type: TransactionType,
  outcome: TransactionOutcome,
  addedCount: number,
  droppedCount: number,
): string {
  if (type === "TRADE") return "Trade";
  if (type === "COMMISSIONER") return "Commissioner action";
  if (type === "WAIVER") {
    return outcome === "SUCCESSFUL"
      ? "Successful waiver claim"
      : outcome === "FAILED"
        ? "Failed waiver claim"
        : outcome === "REVERSED"
          ? "Reversed waiver claim"
          : "Pending waiver claim";
  }
  if (addedCount > 0 && droppedCount > 0) return "Add/Drop";
  if (droppedCount > 0) return "Drop";
  return "Add";
}

const OUTCOME: Record<TransactionStatus, { outcome: TransactionOutcome; label: string }> = {
  COMPLETE: { outcome: "SUCCESSFUL", label: "Successful" },
  FAILED: { outcome: "FAILED", label: "Failed claim" },
  PENDING: { outcome: "PENDING", label: "Pending" },
  REVERSED: { outcome: "REVERSED", label: "Reversed" },
};

export interface TransactionFilters {
  seasonYear?: number;
  week?: number;
  type?: TransactionType;
  managerId?: string;
  playerId?: string;
  /** Free-text player search — matched against first and last name. */
  playerQuery?: string;
  /** Hide failed claims. Default true — an unsuccessful bid is not a move. */
  successOnly?: boolean;
  /**
   * How many rows to return. Used by Load More, which grows this rather than
   * paging with an offset: the wire is ordered by a timestamp that never changes,
   * so growing a window cannot skip or duplicate a row the way an offset can
   * when the underlying set shifts.
   */
  limit?: number;
}

function assetView(asset: {
  id: string;
  assetType: string;
  faabAmount: number | null;
  draftPickDescription: string | null;
  player: { firstName: string; lastName: string; position: string } | null;
  fantasyTeam: { teamName: string; managerId: string | null; manager: { displayName: string } | null };
}): TransactionAssetView {
  return {
    id: asset.id,
    playerName: asset.player ? `${asset.player.firstName} ${asset.player.lastName}` : null,
    position: asset.player?.position ?? null,
    teamName: asset.fantasyTeam.teamName,
    managerId: asset.fantasyTeam.managerId,
    managerName: asset.fantasyTeam.manager?.displayName ?? asset.fantasyTeam.teamName,
    otherAsset:
      asset.assetType === "DRAFT_PICK"
        ? (asset.draftPickDescription ?? "a draft pick")
        : asset.assetType === "FAAB"
          ? `$${asset.faabAmount ?? 0} FAAB`
          : null,
  };
}

function describe(view: Omit<TransactionView, "summary">): string {
  const name = (a: TransactionAssetView) => a.playerName ?? a.otherAsset ?? "an unnamed asset";
  const managers = [...new Set([...view.added, ...view.dropped].map((a) => a.managerName))];

  if (view.type === "TRADE") {
    const byManager = new Map<string, string[]>();
    for (const a of view.added) {
      const list = byManager.get(a.managerName) ?? [];
      list.push(name(a));
      byManager.set(a.managerName, list);
    }
    return [...byManager]
      .map(([manager, players]) => `${manager} received ${players.join(" and ")}`)
      .join("; ");
  }

  const actor = managers[0] ?? "A manager";
  const parts: string[] = [];
  if (view.added.length > 0) {
    const verb =
      view.type === "WAIVER"
        ? view.outcome === "SUCCESSFUL"
          ? "claimed"
          : "put in a claim for"
        : view.type === "COMMISSIONER"
          ? "was awarded"
          : "picked up";
    parts.push(`${actor} ${verb} ${view.added.map(name).join(" and ")}`);
  }
  if (view.dropped.length > 0) {
    parts.push(`${view.added.length > 0 ? "dropping" : `${actor} dropped`} ${view.dropped.map(name).join(" and ")}`);
  }
  if (parts.length === 0) return `${actor} made a move with nothing recorded against it`;
  return parts.join(", ");
}

/**
 * One page of the wire, plus everything the filter controls need.
 *
 * With no season chosen it shows the newest season that has data, so the
 * default view is a period rather than a slice across three years.
 */
export async function getTransactionsPage(
  filters: TransactionFilters = {},
): Promise<TransactionsPage> {
  const successOnly = filters.successOnly ?? true;

  // Which seasons and weeks actually contain transactions.
  const grouped = await prisma.transaction.groupBy({
    by: ["seasonId", "week"],
    _count: { _all: true },
  });
  const seasons = await prisma.season.findMany({ select: { id: true, year: true, dataSource: true } });
  const yearById = new Map(seasons.map((s) => [s.id, s.year]));

  const periodMap = new Map<number, { weeks: Set<number>; count: number }>();
  for (const row of grouped) {
    const year = yearById.get(row.seasonId);
    if (year == null) continue;
    const entry = periodMap.get(year) ?? { weeks: new Set<number>(), count: 0 };
    if (row.week != null) entry.weeks.add(row.week);
    entry.count += row._count._all;
    periodMap.set(year, entry);
  }
  const periods: TransactionPeriod[] = [...periodMap]
    .map(([year, v]) => ({ year, weeks: [...v.weeks].sort((a, b) => a - b), count: v.count }))
    .sort((a, b) => b.year - a.year);

  const seasonsWithoutData = seasons
    .filter((s) => !periodMap.has(s.year))
    .map((s) => s.year)
    .sort((a, b) => a - b);

  // Default to the newest season that has anything to show.
  const seasonYear =
    filters.seasonYear && periodMap.has(filters.seasonYear)
      ? filters.seasonYear
      : (periods[0]?.year ?? null);

  // A week that does not exist in the chosen season is dropped rather than
  // silently returning nothing.
  const weeksInSeason = seasonYear ? (periodMap.get(seasonYear)?.weeks ?? new Set<number>()) : new Set<number>();
  const week = filters.week != null && weeksInSeason.has(filters.week) ? filters.week : null;

  const playerQuery = filters.playerQuery?.trim() || null;

  const where: Prisma.TransactionWhereInput = {};
  if (seasonYear) where.season = { year: seasonYear };
  if (week != null) where.week = week;
  if (filters.type) where.type = filters.type;
  if (successOnly) where.status = { in: ["COMPLETE", "PENDING"] };
  if (filters.managerId || filters.playerId || playerQuery) {
    where.assets = {
      some: {
        ...(filters.managerId ? { fantasyTeam: { managerId: filters.managerId } } : {}),
        ...(filters.playerId ? { playerId: filters.playerId } : {}),
        /*
         * A name search has to match a name that is stored in two columns, and
         * "josh allen" spans both. Splitting on whitespace and requiring every
         * token to hit one column or the other means "allen josh" works as well
         * as "josh allen", and a single token ("mahomes") matches either.
         */
        ...(playerQuery
          ? {
              AND: playerQuery
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 4)
                .map((token) => ({
                  player: {
                    OR: [
                      { firstName: { contains: token, mode: "insensitive" as const } },
                      { lastName: { contains: token, mode: "insensitive" as const } },
                    ],
                  },
                })),
            }
          : {}),
      },
    };
  }

  const shown = Math.min(MAX_SHOWN, Math.max(TRANSACTIONS_PAGE_SIZE, filters.limit ?? TRANSACTIONS_PAGE_SIZE));

  const [rows, totalMatching, managerRows] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        season: { select: { year: true } },
        assets: {
          include: {
            player: { select: { firstName: true, lastName: true, position: true } },
            fantasyTeam: {
              select: {
                teamName: true,
                managerId: true,
                manager: { select: { displayName: true } },
              },
            },
          },
        },
      },
      // processedAt then id: a season's rows can share a timestamp to the second,
      // and without a stable second key the same row could appear on two pages.
      orderBy: [{ processedAt: "desc" }, { id: "desc" }],
      take: shown,
    }),
    prisma.transaction.count({ where }),
    // Managers who appear anywhere in the wire, so the filter never offers one
    // with nothing behind it.
    prisma.manager.findMany({
      where: { deletedAt: null, fantasyTeams: { some: { transactionAssets: { some: {} } } } },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  const views: TransactionView[] = rows.map((t) => {
    const status = OUTCOME[t.status];
    const added = t.assets.filter((a) => a.direction === "ADD").map(assetView);
    const dropped = t.assets.filter((a) => a.direction !== "ADD").map(assetView);
    const partial: Omit<TransactionView, "summary"> = {
      id: t.id,
      seasonYear: t.season.year,
      week: t.week,
      type: t.type,
      kindLabel: kindLabelFor(t.type, status.outcome, added.length, dropped.length),
      outcome: status.outcome,
      outcomeLabel: status.label,
      faabSpent: t.faabSpent,
      added,
      dropped,
      processedAt: t.processedAt,
    };
    return { ...partial, summary: describe(partial) };
  });

  // Same manager, same week, the same players flipped back and forth: one row.
  const transactions: TransactionView[] = collapseChurn(views).map((v) =>
    v.churn ? { ...v, kindLabel: "Roster churn", summary: describeChurn(v.churn) } : v,
  );

  return {
    transactions,
    periods,
    seasonYear,
    week,
    type: filters.type ?? null,
    successOnly,
    seasonsWithoutData,
    totalMatching,
    managerId: filters.managerId ?? null,
    playerQuery,
    managerOptions: managerRows,
    shown: transactions.length,
    hasMore: transactions.length < totalMatching,
  };
}

/** Kept for the homepage sidebar, which wants only the latest few real moves. */
export async function listRecentTransactions(seasonId: string, take = 5) {
  return prisma.transaction.findMany({
    where: { seasonId, status: "COMPLETE" },
    include: { assets: { include: { player: true, fantasyTeam: true } } },
    orderBy: { processedAt: "desc" },
    take,
  });
}

// ── Season charts: activity grid and best pickups ──────────────────────────

export interface ActivityGridView {
  /** Every week from 1 to the last week with a dated move. */
  weeks: number[];
  /** Managers with a team in the season, sorted by name. */
  managers: { id: string; name: string }[];
  /** Completed moves, keyed `${managerId}|${week}`. */
  cells: Record<string, ActivityCell>;
  /** The busiest manager-week, for scaling the heat. */
  max: number;
}

export interface PickupView {
  transactionId: string;
  playerId: string;
  playerName: string;
  position: string;
  managerId: string;
  managerName: string;
  addedWeek: number;
  kind: "Waiver claim" | "Free agent";
  startWeek: number;
  endWeek: number;
  weeksOnRoster: number;
  startedWeeks: number;
  /** Points scored for the acquiring team, as a starter, during the stint. */
  starterPoints: number;
}

export interface TransactionSeasonCharts {
  seasonYear: number;
  activity: ActivityGridView;
  /** Top ten waiver and free-agent adds by starter points for the acquiring team. */
  bestPickups: PickupView[];
  /** False when the season has no per-week player scores, so pickups cannot be scored. */
  hasPlayerScores: boolean;
}

/**
 * The whole-season view of the wire for one year: how busy each manager was
 * week by week, and which waiver or free-agent adds actually paid.
 *
 * Only completed moves count. A pickup is scored from the week of the add
 * until the player left the acquiring roster (see pickupStint), and only for
 * weeks he was in that team's starting lineup.
 */
export async function getTransactionSeasonCharts(seasonYear: number): Promise<TransactionSeasonCharts | null> {
  const season = await prisma.season.findFirst({ where: { year: seasonYear }, select: { id: true } });
  if (!season) return null;

  const [moves, teams] = await Promise.all([
    prisma.transaction.findMany({
      where: { seasonId: season.id, status: "COMPLETE" },
      select: {
        id: true,
        week: true,
        type: true,
        processedAt: true,
        assets: {
          select: {
            direction: true,
            assetType: true,
            playerId: true,
            fantasyTeamId: true,
            fantasyTeam: { select: { managerId: true } },
            player: { select: { firstName: true, lastName: true, position: true } },
          },
        },
      },
      orderBy: [{ processedAt: "asc" }, { id: "asc" }],
    }),
    prisma.fantasyTeam.findMany({
      where: { seasonId: season.id },
      select: { id: true, managerId: true, manager: { select: { displayName: true } } },
    }),
  ]);

  // ── Activity grid ────────────────────────────────────────────────────────
  const grid = activityGrid(
    moves.map((m) => ({
      week: m.week,
      type: m.type,
      managerIds: m.assets.map((a) => a.fantasyTeam.managerId),
    })),
  );
  const lastWeek = moves.reduce((max, m) => (m.week != null && m.week > max ? m.week : max), 0);
  const managers = teams
    .map((t) => ({ id: t.managerId, name: t.manager.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const cells = Object.fromEntries(grid);
  const max = [...grid.values()].reduce((m, c) => Math.max(m, c.total), 0);

  // ── Best pickups ─────────────────────────────────────────────────────────
  const adds = moves.flatMap((m) =>
    (m.type === "WAIVER" || m.type === "FREE_AGENT") && m.week != null
      ? m.assets
          .filter((a) => a.direction === "ADD" && a.assetType === "PLAYER" && a.playerId && a.player)
          .map((a) => ({
            transactionId: m.id,
            week: m.week as number,
            kind: m.type === "WAIVER" ? ("Waiver claim" as const) : ("Free agent" as const),
            playerId: a.playerId as string,
            player: a.player as { firstName: string; lastName: string; position: string },
            fantasyTeamId: a.fantasyTeamId,
            managerId: a.fantasyTeam.managerId,
          }))
      : [],
  );

  const [rosters, scoreRows] = adds.length
    ? await Promise.all([
        // Only snapshots with players in them: an empty shell for a week not
        // yet synced would otherwise read as everyone leaving the roster.
        prisma.roster.findMany({
          where: { fantasyTeam: { seasonId: season.id }, playerScores: { some: {} } },
          select: { week: true, fantasyTeamId: true },
        }),
        prisma.weeklyPlayerScore.findMany({
          where: {
            playerId: { in: [...new Set(adds.map((a) => a.playerId))] },
            roster: { fantasyTeam: { seasonId: season.id } },
          },
          select: { playerId: true, isStarter: true, points: true, roster: { select: { week: true, fantasyTeamId: true } } },
        }),
      ])
    : [[], []];

  const teamWeeks = new Map<string, number[]>();
  for (const r of rosters) {
    const list = teamWeeks.get(r.fantasyTeamId) ?? [];
    list.push(r.week);
    teamWeeks.set(r.fantasyTeamId, list);
  }
  const rowsByPlayerTeam = new Map<string, StintRow[]>();
  for (const s of scoreRows) {
    const key = `${s.playerId}|${s.roster.fantasyTeamId}`;
    const list = rowsByPlayerTeam.get(key) ?? [];
    list.push({ week: s.roster.week, isStarter: s.isStarter, points: s.points });
    rowsByPlayerTeam.set(key, list);
  }
  const hasPlayerScores = scoreRows.some((s) => s.points != null);

  const nameByManager = new Map(managers.map((m) => [m.id, m.name]));
  const seen = new Set<string>();
  const pickups: PickupView[] = [];
  for (const a of adds) {
    const stint = pickupStint(a.week, teamWeeks.get(a.fantasyTeamId) ?? [], rowsByPlayerTeam.get(`${a.playerId}|${a.fantasyTeamId}`) ?? []);
    if (stint.startWeek == null || stint.endWeek == null) continue;
    // Add, drop, re-add in the same week resolves to the same stint: count it once.
    const key = `${a.playerId}|${a.fantasyTeamId}|${stint.startWeek}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pickups.push({
      transactionId: a.transactionId,
      playerId: a.playerId,
      playerName: `${a.player.firstName} ${a.player.lastName}`,
      position: a.player.position,
      managerId: a.managerId,
      managerName: nameByManager.get(a.managerId) ?? "Unknown",
      addedWeek: a.week,
      kind: a.kind,
      startWeek: stint.startWeek,
      endWeek: stint.endWeek,
      weeksOnRoster: stint.weeksOnRoster,
      startedWeeks: stint.startedWeeks,
      starterPoints: stint.starterPoints,
    });
  }
  const bestPickups = pickups
    .filter((p) => p.starterPoints > 0)
    .sort((x, y) => y.starterPoints - x.starterPoints || x.addedWeek - y.addedWeek)
    .slice(0, 10);

  return {
    seasonYear,
    activity: { weeks: Array.from({ length: lastWeek }, (_, i) => i + 1), managers, cells, max },
    bestPickups,
    hasPlayerScores,
  };
}
