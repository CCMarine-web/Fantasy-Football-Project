import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AssetDirection, AssetType, TransactionType } from "@/generated/prisma/client";
import { FAAB_BUDGET, MANAGERS } from "./constants";
import type { Rng } from "./rng";
import type { ManagerKey } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

export interface NotableTradeSpec {
  managerA: ManagerKey;
  managerB: ManagerKey;
  notes: string;
}

export interface SeasonTransactionInput {
  prisma: PrismaClient;
  rng: Rng;
  seasonId: string;
  year: number;
  weeksPlayed: number;
  fantasyTeamIdByManagerKey: Record<ManagerKey, string>;
  managerIdByKey: Record<ManagerKey, string>;
  draftedPlayerIdsByManagerKey: Record<ManagerKey, string[]>;
  freeAgentPlayerIds: string[];
  /** Guaranteed notable trades to force into this season's history, if any. */
  forcedNotableTrades?: NotableTradeSpec[];
  /** Guaranteed rivalry trade (Sofia <-> Marcus) to force into this season, if applicable. */
  forcedRivalryTrade?: { managerA: ManagerKey; managerB: ManagerKey };
  transactionCount: number;
}

const MANAGER_KEYS: ManagerKey[] = MANAGERS.map((m) => m.key);

export async function seedSeasonTransactions(input: SeasonTransactionInput): Promise<void> {
  const {
    prisma,
    rng,
    seasonId,
    weeksPlayed,
    fantasyTeamIdByManagerKey,
    managerIdByKey,
    draftedPlayerIdsByManagerKey,
    freeAgentPlayerIds,
    forcedNotableTrades = [],
    forcedRivalryTrade,
    transactionCount,
  } = input;

  const transactionRows: Prisma.TransactionCreateManyInput[] = [];
  const assetRows: Prisma.TransactionAssetCreateManyInput[] = [];
  const tradeRows: Prisma.TradeCreateManyInput[] = [];

  const faabRemaining: Record<ManagerKey, number> = {} as Record<ManagerKey, number>;
  MANAGER_KEYS.forEach((k) => (faabRemaining[k] = FAAB_BUDGET));

  function addWaiver(managerKey: ManagerKey, week: number): void {
    const teamId = fantasyTeamIdByManagerKey[managerKey]!;
    const managerId = managerIdByKey[managerKey]!;
    const roster = draftedPlayerIdsByManagerKey[managerKey]!;
    const dropPlayerId = rng.pick(roster);
    const addPlayerId = rng.pick(freeAgentPlayerIds.length > 0 ? freeAgentPlayerIds : roster);
    const bid = Math.min(faabRemaining[managerKey]!, rng.int(1, 38));
    faabRemaining[managerKey] = Math.max(0, faabRemaining[managerKey]! - bid);

    const transactionId = newId();
    transactionRows.push({
      id: transactionId,
      seasonId,
      week,
      type: TransactionType.WAIVER,
      faabSpent: bid,
      processedAt: weekToDate(input.year, week),
    });
    assetRows.push(
      {
        id: newId(),
        transactionId,
        fantasyTeamId: teamId,
        managerId,
        direction: AssetDirection.ADD,
        assetType: AssetType.PLAYER,
        playerId: addPlayerId,
      },
      {
        id: newId(),
        transactionId,
        fantasyTeamId: teamId,
        managerId,
        direction: AssetDirection.DROP,
        assetType: AssetType.PLAYER,
        playerId: dropPlayerId,
      },
    );
  }

  function addTrade(
    managerA: ManagerKey,
    managerB: ManagerKey,
    week: number,
    notable: boolean,
    notes?: string,
  ): void {
    const teamA = fantasyTeamIdByManagerKey[managerA]!;
    const teamB = fantasyTeamIdByManagerKey[managerB]!;
    const rosterA = draftedPlayerIdsByManagerKey[managerA]!;
    const rosterB = draftedPlayerIdsByManagerKey[managerB]!;
    const playerFromA = rng.pick(rosterA);
    const playerFromB = rng.pick(rosterB);

    const transactionId = newId();
    transactionRows.push({
      id: transactionId,
      seasonId,
      week,
      type: TransactionType.TRADE,
      processedAt: weekToDate(input.year, week),
    });
    assetRows.push(
      {
        id: newId(),
        transactionId,
        fantasyTeamId: teamA,
        managerId: managerIdByKey[managerA]!,
        direction: AssetDirection.DROP,
        assetType: AssetType.PLAYER,
        playerId: playerFromA,
      },
      {
        id: newId(),
        transactionId,
        fantasyTeamId: teamB,
        managerId: managerIdByKey[managerB]!,
        direction: AssetDirection.ADD,
        assetType: AssetType.PLAYER,
        playerId: playerFromA,
      },
      {
        id: newId(),
        transactionId,
        fantasyTeamId: teamB,
        managerId: managerIdByKey[managerB]!,
        direction: AssetDirection.DROP,
        assetType: AssetType.PLAYER,
        playerId: playerFromB,
      },
      {
        id: newId(),
        transactionId,
        fantasyTeamId: teamA,
        managerId: managerIdByKey[managerA]!,
        direction: AssetDirection.ADD,
        assetType: AssetType.PLAYER,
        playerId: playerFromB,
      },
    );
    if (notable) {
      assetRows.push({
        id: newId(),
        transactionId,
        fantasyTeamId: teamB,
        managerId: managerIdByKey[managerB]!,
        direction: AssetDirection.ADD,
        assetType: AssetType.DRAFT_PICK,
        draftPickDescription: `${input.year + 1} mid-round pick (throw-in)`,
      });
    }

    tradeRows.push({
      id: newId(),
      transactionId,
      isNotable: notable,
      notes: notes ?? null,
    });
  }

  // Forced rivalry trade first (Sofia <-> Marcus flavor), if requested this season.
  if (forcedRivalryTrade) {
    addTrade(
      forcedRivalryTrade.managerA,
      forcedRivalryTrade.managerB,
      rng.int(3, Math.max(3, weeksPlayed - 2)),
      false,
    );
  }

  for (const spec of forcedNotableTrades) {
    addTrade(spec.managerA, spec.managerB, rng.int(2, Math.max(2, weeksPlayed - 1)), true, spec.notes);
  }

  const remaining = transactionCount - forcedNotableTrades.length - (forcedRivalryTrade ? 1 : 0);
  for (let i = 0; i < remaining; i++) {
    const week = rng.int(1, Math.max(1, weeksPlayed));
    const isTrade = rng.bool(0.28);
    if (isTrade) {
      const [managerA, managerB] = rng.shuffle(MANAGER_KEYS).slice(0, 2) as [ManagerKey, ManagerKey];
      addTrade(managerA, managerB, week, false);
    } else {
      const managerKey = rng.pick(MANAGER_KEYS);
      addWaiver(managerKey, week);
    }
  }

  await prisma.transaction.createMany({ data: transactionRows });
  await prisma.transactionAsset.createMany({ data: assetRows });
  await prisma.trade.createMany({ data: tradeRows });
}

function weekToDate(year: number, week: number): Date {
  // Season openers land early September; each week advances ~7 days.
  const base = Date.UTC(year, 8, 8, 12, 0, 0);
  return new Date(base + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}
