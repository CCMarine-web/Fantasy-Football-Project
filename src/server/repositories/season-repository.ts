import { prisma } from "@/lib/db";
import type { Season } from "@/generated/prisma/client";

export async function getCurrentSeason(): Promise<Season | null> {
  return prisma.season.findFirst({ where: { isCurrent: true } });
}

export async function getSeasonByYear(year: number): Promise<Season | null> {
  return prisma.season.findFirst({ where: { year } });
}

export async function listSeasons(): Promise<Season[]> {
  return prisma.season.findMany({ orderBy: { year: "desc" } });
}

export async function getLatestCompletedSeason(): Promise<Season | null> {
  return prisma.season.findFirst({
    where: { status: "COMPLETE" },
    orderBy: { year: "desc" },
  });
}
