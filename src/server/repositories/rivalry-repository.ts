import { prisma } from "@/lib/db";

export async function listRivalries() {
  const rivalries = await prisma.rivalry.findMany({
    include: { managerA: true, managerB: true },
    orderBy: { rivalryScore: "desc" },
  });
  return rivalries;
}

export async function getRivalryBetween(managerAId: string, managerBId: string) {
  return prisma.rivalry.findFirst({
    where: {
      OR: [
        { managerAId, managerBId },
        { managerAId: managerBId, managerBId: managerAId },
      ],
    },
    include: { managerA: true, managerB: true },
  });
}
