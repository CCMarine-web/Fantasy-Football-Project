import { prisma } from "@/lib/db";

export async function getAdminOverview() {
  const [league, recentSyncLogs, managerCount, seasonCount, pendingGenerations, pendingChatMessages, chatImports] =
    await Promise.all([
      prisma.league.findFirst(),
      prisma.dataSyncLog.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
      prisma.manager.count({ where: { deletedAt: null } }),
      prisma.season.count(),
      prisma.aIContentGeneration.count({ where: { status: "GENERATED" } }),
      prisma.chatMessage.count({ where: { approvalStatus: "PENDING" } }),
      prisma.chatImport.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    ]);

  return {
    league,
    recentSyncLogs,
    managerCount,
    seasonCount,
    pendingGenerations,
    pendingChatMessages,
    chatImports,
  };
}
