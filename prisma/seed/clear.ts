import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Deletes every row from every table this seed script owns, in FK-safe
 * (children-before-parents) order, so `npm run db:seed` can be re-run from
 * a clean slate any number of times. See the comment block in prisma/seed.ts
 * for the dependency-order derivation.
 */
export async function clearDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.chatTag.deleteMany(),
    prisma.historicalQuote.deleteMany(),
    prisma.chatMessage.deleteMany(),
    prisma.chatParticipant.deleteMany(),
    prisma.chatImport.deleteMany(),
    prisma.aIContentGeneration.deleteMany(),
    prisma.articleSection.deleteMany(),
    prisma.article.deleteMany(),
    prisma.award.deleteMany(),
    prisma.leagueRecord.deleteMany(),
    prisma.rivalry.deleteMany(),
    prisma.championship.deleteMany(),
    prisma.playoffBracket.deleteMany(),
    prisma.transactionAsset.deleteMany(),
    prisma.trade.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.draftPick.deleteMany(),
    prisma.draft.deleteMany(),
    prisma.weeklyPlayerScore.deleteMany(),
    prisma.roster.deleteMany(),
    prisma.matchupTeam.deleteMany(),
    prisma.matchup.deleteMany(),
    prisma.standingSnapshot.deleteMany(),
    prisma.teamNameHistory.deleteMany(),
    prisma.fantasyTeam.deleteMany(),
    prisma.fantasyPlayer.deleteMany(),
    prisma.dataSyncLog.deleteMany(),
    prisma.user.deleteMany(),
    prisma.manager.deleteMany(),
    prisma.season.deleteMany(),
    prisma.league.deleteMany(),
  ]);
}
