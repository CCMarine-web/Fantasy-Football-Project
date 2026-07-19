import { prisma } from "@/lib/db";

export async function getDraftForSeasonYear(year: number) {
  return prisma.draft.findFirst({
    where: { season: { year } },
    include: {
      season: true,
      picks: {
        include: { player: true, manager: true, fantasyTeam: true },
        orderBy: { pickNumber: "asc" },
      },
    },
  });
}

export async function listDraftSeasons() {
  return prisma.season.findMany({
    where: { drafts: { some: {} } },
    orderBy: { year: "desc" },
    select: { id: true, year: true },
  });
}
