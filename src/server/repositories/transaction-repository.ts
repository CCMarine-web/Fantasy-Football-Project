import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface TransactionFilters {
  seasonYear?: number;
  week?: number;
  managerId?: string;
  playerId?: string;
  type?: "WAIVER" | "FREE_AGENT" | "TRADE" | "COMMISSIONER";
}

export async function listTransactions(filters: TransactionFilters = {}) {
  const where: Prisma.TransactionWhereInput = {};
  if (filters.seasonYear) where.season = { year: filters.seasonYear };
  if (filters.week) where.week = filters.week;
  if (filters.type) where.type = filters.type;
  if (filters.managerId || filters.playerId) {
    where.assets = {
      some: {
        ...(filters.managerId ? { managerId: filters.managerId } : {}),
        ...(filters.playerId ? { playerId: filters.playerId } : {}),
      },
    };
  }

  return prisma.transaction.findMany({
    where,
    include: {
      season: true,
      assets: { include: { player: true, fantasyTeam: { include: { manager: true } } } },
      trade: true,
    },
    orderBy: { processedAt: "desc" },
    take: 100,
  });
}
