import { prisma } from "@/lib/db";
import type { Prisma, TransactionStatus, TransactionType } from "@/generated/prisma/client";

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
  /** "Waiver claim", "Free-agent pickup", "Trade", "Commissioner action". */
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
}

const KIND_LABEL: Record<TransactionType, string> = {
  WAIVER: "Waiver claim",
  FREE_AGENT: "Free-agent pickup",
  TRADE: "Trade",
  COMMISSIONER: "Commissioner action",
};

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
  /** Hide failed claims. Default true — an unsuccessful bid is not a move. */
  successOnly?: boolean;
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

  const where: Prisma.TransactionWhereInput = {};
  if (seasonYear) where.season = { year: seasonYear };
  if (week != null) where.week = week;
  if (filters.type) where.type = filters.type;
  if (successOnly) where.status = { in: ["COMPLETE", "PENDING"] };
  if (filters.managerId || filters.playerId) {
    where.assets = {
      some: {
        ...(filters.managerId ? { fantasyTeam: { managerId: filters.managerId } } : {}),
        ...(filters.playerId ? { playerId: filters.playerId } : {}),
      },
    };
  }

  const [rows, totalMatching] = await Promise.all([
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
      orderBy: [{ processedAt: "desc" }],
      take: filters.limit ?? 150,
    }),
    prisma.transaction.count({ where }),
  ]);

  const transactions: TransactionView[] = rows.map((t) => {
    const status = OUTCOME[t.status];
    const partial: Omit<TransactionView, "summary"> = {
      id: t.id,
      seasonYear: t.season.year,
      week: t.week,
      type: t.type,
      kindLabel: KIND_LABEL[t.type],
      outcome: status.outcome,
      outcomeLabel: status.label,
      faabSpent: t.faabSpent,
      added: t.assets.filter((a) => a.direction === "ADD").map(assetView),
      dropped: t.assets.filter((a) => a.direction !== "ADD").map(assetView),
      processedAt: t.processedAt,
    };
    return { ...partial, summary: describe(partial) };
  });

  return {
    transactions,
    periods,
    seasonYear,
    week,
    type: filters.type ?? null,
    successOnly,
    seasonsWithoutData,
    totalMatching,
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
