-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "MatchupStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'FINAL');

-- CreateEnum
CREATE TYPE "BracketType" AS ENUM ('WINNERS', 'CONSOLATION');

-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('SNAKE', 'AUCTION', 'LINEAR');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('WAIVER', 'FREE_AGENT', 'TRADE', 'COMMISSIONER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AssetDirection" AS ENUM ('ADD', 'DROP');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('PLAYER', 'DRAFT_PICK', 'FAAB');

-- CreateEnum
CREATE TYPE "RecordCategory" AS ENUM ('HIGHEST_WEEKLY_SCORE', 'LOWEST_WEEKLY_SCORE', 'LARGEST_BLOWOUT', 'CLOSEST_GAME', 'HIGHEST_SCORE_IN_LOSS', 'LOWEST_SCORE_IN_WIN', 'MOST_BENCH_POINTS', 'MOST_CHAMPIONSHIPS', 'MOST_PLAYOFF_APPEARANCES', 'LONGEST_WIN_STREAK', 'LONGEST_LOSS_STREAK', 'MOST_POINTS_SEASON', 'BEST_LINEUP_EFFICIENCY', 'WORST_LINEUP_EFFICIENCY');

-- CreateEnum
CREATE TYPE "ArticleType" AS ENUM ('WEEKLY_ISSUE', 'MATCHUP_PREVIEW', 'MATCHUP_RECAP', 'SEASON_SUMMARY', 'MANAGER_PROFILE', 'TRADE_RETROSPECTIVE');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ArticleSectionType" AS ENUM ('INTRO', 'MATCHUP_RECAP', 'POWER_RANKINGS', 'MANAGER_OF_WEEK', 'WORST_DECISION', 'BAD_BEAT', 'FRAUD_WIN', 'QUOTE_OF_WEEK', 'WAIVER_REPORT', 'PREVIEW', 'GENERIC');

-- CreateEnum
CREATE TYPE "AwardType" AS ENUM ('MANAGER_OF_WEEK', 'WORST_DECISION_OF_WEEK', 'BAD_BEAT', 'FRAUD_WIN', 'CHAMPION', 'RUNNER_UP', 'MOST_POINTS_SEASON', 'BEST_WAIVER_PICKUP', 'BIGGEST_TRADE');

-- CreateEnum
CREATE TYPE "AIGenerationStatus" AS ENUM ('GENERATED', 'APPROVED', 'REJECTED', 'EDITED');

-- CreateEnum
CREATE TYPE "ChatPlatform" AS ENUM ('IMESSAGE', 'WHATSAPP', 'GROUPME', 'DISCORD', 'PLAIN_TEXT', 'CSV', 'JSON');

-- CreateEnum
CREATE TYPE "ChatImportStatus" AS ENUM ('UPLOADED', 'PARSING', 'PARSED', 'FAILED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SensitivityStatus" AS ENUM ('NONE', 'SENSITIVE', 'REDACTED');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('FULL_LEAGUE', 'SEASON', 'WEEK', 'TRANSACTIONS', 'DRAFT', 'STATS_RECALC');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "logoUrl" TEXT,
    "description" TEXT,
    "sleeperLeagueId" TEXT,
    "foundedYear" INTEGER NOT NULL,
    "defaultHumorLevel" INTEGER NOT NULL DEFAULT 3,
    "sensitiveTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sleeperLeagueId" TEXT,
    "previousSleeperLeagueId" TEXT,
    "status" "SeasonStatus" NOT NULL DEFAULT 'UPCOMING',
    "regularSeasonWeeks" INTEGER NOT NULL DEFAULT 14,
    "playoffTeams" INTEGER NOT NULL DEFAULT 6,
    "playoffStartWeek" INTEGER NOT NULL DEFAULT 15,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manager" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sleeperUserId" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "joinedYear" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "noRoast" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Manager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyTeam" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "sleeperRosterId" TEXT,
    "teamName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointsAgainst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "regularSeasonRank" INTEGER,
    "finalRank" INTEGER,
    "madePlayoffs" BOOLEAN NOT NULL DEFAULT false,
    "playoffSeed" INTEGER,
    "isChampion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamNameHistory" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "fantasyTeamId" TEXT,
    "name" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamNameHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyPlayer" (
    "id" TEXT NOT NULL,
    "sleeperPlayerId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "nflTeam" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roster" (
    "id" TEXT NOT NULL,
    "fantasyTeamId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "sleeperRosterId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Roster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPlayerScore" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "lineupSlot" TEXT NOT NULL,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "projectedPoints" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyPlayerScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matchup" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "sleeperMatchupId" TEXT,
    "isPlayoff" BOOLEAN NOT NULL DEFAULT false,
    "playoffRound" INTEGER,
    "bracketType" "BracketType",
    "roundName" TEXT,
    "status" "MatchupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Matchup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchupTeam" (
    "id" TEXT NOT NULL,
    "matchupId" TEXT NOT NULL,
    "fantasyTeamId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "projectedScore" DOUBLE PRECISION,
    "benchPoints" DOUBLE PRECISION,
    "isWinner" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchupTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandingSnapshot" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "fantasyTeamId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "ties" INTEGER NOT NULL,
    "pointsFor" DOUBLE PRECISION NOT NULL,
    "pointsAgainst" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "streak" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "sleeperDraftId" TEXT,
    "type" "DraftType" NOT NULL DEFAULT 'SNAKE',
    "rounds" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "pickNumber" INTEGER NOT NULL,
    "draftSlot" INTEGER NOT NULL,
    "originalFantasyTeamId" TEXT NOT NULL,
    "fantasyTeamId" TEXT NOT NULL,
    "managerId" TEXT,
    "playerId" TEXT,
    "isKeeper" BOOLEAN NOT NULL DEFAULT false,
    "auctionAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER,
    "sleeperTransactionId" TEXT,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETE',
    "faabSpent" INTEGER,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAsset" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fantasyTeamId" TEXT NOT NULL,
    "managerId" TEXT,
    "direction" "AssetDirection" NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "playerId" TEXT,
    "draftPickDescription" TEXT,
    "faabAmount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "isNotable" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayoffBracket" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "bracketType" "BracketType" NOT NULL,
    "roundName" TEXT NOT NULL,
    "matchupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayoffBracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Championship" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "championFantasyTeamId" TEXT NOT NULL,
    "championManagerId" TEXT NOT NULL,
    "runnerUpFantasyTeamId" TEXT,
    "thirdPlaceFantasyTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Championship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueRecord" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "category" "RecordCategory" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "managerId" TEXT,
    "week" INTEGER,
    "description" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rivalry" (
    "id" TEXT NOT NULL,
    "managerAId" TEXT NOT NULL,
    "managerBId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "managerAWins" INTEGER NOT NULL DEFAULT 0,
    "managerBWins" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "playoffMeetings" INTEGER NOT NULL DEFAULT 0,
    "closestGameMargin" DOUBLE PRECISION,
    "largestBlowoutMargin" DOUBLE PRECISION,
    "currentStreakManagerId" TEXT,
    "currentStreakCount" INTEGER NOT NULL DEFAULT 0,
    "rivalryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastMeetingAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rivalry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER,
    "type" "ArticleType" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "heroImageUrl" TEXT,
    "authorUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleSection" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "sectionType" "ArticleSectionType" NOT NULL DEFAULT 'GENERIC',
    "heading" TEXT,
    "body" TEXT NOT NULL,
    "relatedManagerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER,
    "type" "AwardType" NOT NULL,
    "managerId" TEXT NOT NULL,
    "fantasyTeamId" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIContentGeneration" (
    "id" TEXT NOT NULL,
    "contentType" "ArticleType" NOT NULL,
    "relatedArticleId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "humorLevel" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputSummary" JSONB NOT NULL,
    "outputText" TEXT NOT NULL,
    "status" "AIGenerationStatus" NOT NULL DEFAULT 'GENERATED',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AIContentGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatImport" (
    "id" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "sourcePlatform" "ChatPlatform" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "status" "ChatImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "messageCount" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ChatImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatParticipant" (
    "id" TEXT NOT NULL,
    "chatImportId" TEXT NOT NULL,
    "rawIdentifier" TEXT NOT NULL,
    "linkedManagerId" TEXT,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "chatImportId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "text" TEXT,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "attachmentsMeta" JSONB,
    "replyToMessageId" TEXT,
    "sourcePlatform" "ChatPlatform" NOT NULL,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "sensitivityStatus" "SensitivityStatus" NOT NULL DEFAULT 'NONE',
    "linkedManagerId" TEXT,
    "linkedSeasonYear" INTEGER,
    "linkedWeek" INTEGER,
    "linkedMatchupId" TEXT,
    "linkedPlayerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatTag" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalQuote" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "managerId" TEXT,
    "sourceMessageId" TEXT,
    "seasonId" TEXT,
    "week" INTEGER,
    "context" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSyncLog" (
    "id" TEXT NOT NULL,
    "syncType" "SyncType" NOT NULL,
    "seasonId" TEXT,
    "week" INTEGER,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "recordsProcessed" INTEGER,
    "errorMessage" TEXT,
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DataSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_managerId_key" ON "User"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "League_sleeperLeagueId_key" ON "League"("sleeperLeagueId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_sleeperLeagueId_key" ON "Season"("sleeperLeagueId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_leagueId_year_key" ON "Season"("leagueId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Manager_sleeperUserId_key" ON "Manager"("sleeperUserId");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyTeam_seasonId_managerId_key" ON "FantasyTeam"("seasonId", "managerId");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyPlayer_sleeperPlayerId_key" ON "FantasyPlayer"("sleeperPlayerId");

-- CreateIndex
CREATE INDEX "FantasyPlayer_lastName_firstName_idx" ON "FantasyPlayer"("lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "Roster_fantasyTeamId_week_key" ON "Roster"("fantasyTeamId", "week");

-- CreateIndex
CREATE INDEX "WeeklyPlayerScore_playerId_idx" ON "WeeklyPlayerScore"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlayerScore_rosterId_playerId_key" ON "WeeklyPlayerScore"("rosterId", "playerId");

-- CreateIndex
CREATE INDEX "Matchup_seasonId_week_idx" ON "Matchup"("seasonId", "week");

-- CreateIndex
CREATE INDEX "MatchupTeam_fantasyTeamId_idx" ON "MatchupTeam"("fantasyTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupTeam_matchupId_fantasyTeamId_key" ON "MatchupTeam"("matchupId", "fantasyTeamId");

-- CreateIndex
CREATE INDEX "StandingSnapshot_seasonId_week_idx" ON "StandingSnapshot"("seasonId", "week");

-- CreateIndex
CREATE INDEX "StandingSnapshot_fantasyTeamId_idx" ON "StandingSnapshot"("fantasyTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_seasonId_key" ON "Draft"("seasonId");

-- CreateIndex
CREATE INDEX "DraftPick_playerId_idx" ON "DraftPick"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_draftId_pickNumber_key" ON "DraftPick"("draftId", "pickNumber");

-- CreateIndex
CREATE INDEX "Transaction_seasonId_week_idx" ON "Transaction"("seasonId", "week");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "TransactionAsset_playerId_idx" ON "TransactionAsset"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_transactionId_key" ON "Trade"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayoffBracket_matchupId_key" ON "PlayoffBracket"("matchupId");

-- CreateIndex
CREATE INDEX "PlayoffBracket_seasonId_round_idx" ON "PlayoffBracket"("seasonId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "Championship_seasonId_key" ON "Championship"("seasonId");

-- CreateIndex
CREATE INDEX "LeagueRecord_category_idx" ON "LeagueRecord"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Rivalry_managerAId_managerBId_key" ON "Rivalry"("managerAId", "managerBId");

-- CreateIndex
CREATE INDEX "Article_seasonId_week_idx" ON "Article"("seasonId", "week");

-- CreateIndex
CREATE UNIQUE INDEX "Article_seasonId_slug_key" ON "Article"("seasonId", "slug");

-- CreateIndex
CREATE INDEX "ArticleSection_articleId_order_idx" ON "ArticleSection"("articleId", "order");

-- CreateIndex
CREATE INDEX "Award_seasonId_week_idx" ON "Award"("seasonId", "week");

-- CreateIndex
CREATE INDEX "AIContentGeneration_contentType_idx" ON "AIContentGeneration"("contentType");

-- CreateIndex
CREATE UNIQUE INDEX "ChatParticipant_chatImportId_rawIdentifier_key" ON "ChatParticipant"("chatImportId", "rawIdentifier");

-- CreateIndex
CREATE INDEX "ChatMessage_chatImportId_idx" ON "ChatMessage"("chatImportId");

-- CreateIndex
CREATE INDEX "ChatMessage_participantId_idx" ON "ChatMessage"("participantId");

-- CreateIndex
CREATE INDEX "ChatMessage_approvalStatus_sensitivityStatus_idx" ON "ChatMessage"("approvalStatus", "sensitivityStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ChatTag_messageId_tag_key" ON "ChatTag"("messageId", "tag");

-- CreateIndex
CREATE INDEX "DataSyncLog_syncType_status_idx" ON "DataSyncLog"("syncType", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FantasyTeam" ADD CONSTRAINT "FantasyTeam_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FantasyTeam" ADD CONSTRAINT "FantasyTeam_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamNameHistory" ADD CONSTRAINT "TeamNameHistory_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamNameHistory" ADD CONSTRAINT "TeamNameHistory_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roster" ADD CONSTRAINT "Roster_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlayerScore" ADD CONSTRAINT "WeeklyPlayerScore_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlayerScore" ADD CONSTRAINT "WeeklyPlayerScore_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "FantasyPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupTeam" ADD CONSTRAINT "MatchupTeam_matchupId_fkey" FOREIGN KEY ("matchupId") REFERENCES "Matchup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupTeam" ADD CONSTRAINT "MatchupTeam_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingSnapshot" ADD CONSTRAINT "StandingSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingSnapshot" ADD CONSTRAINT "StandingSnapshot_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_originalFantasyTeamId_fkey" FOREIGN KEY ("originalFantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "FantasyPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAsset" ADD CONSTRAINT "TransactionAsset_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAsset" ADD CONSTRAINT "TransactionAsset_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAsset" ADD CONSTRAINT "TransactionAsset_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionAsset" ADD CONSTRAINT "TransactionAsset_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "FantasyPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_championFantasyTeamId_fkey" FOREIGN KEY ("championFantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_championManagerId_fkey" FOREIGN KEY ("championManagerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_runnerUpFantasyTeamId_fkey" FOREIGN KEY ("runnerUpFantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_thirdPlaceFantasyTeamId_fkey" FOREIGN KEY ("thirdPlaceFantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRecord" ADD CONSTRAINT "LeagueRecord_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRecord" ADD CONSTRAINT "LeagueRecord_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rivalry" ADD CONSTRAINT "Rivalry_managerAId_fkey" FOREIGN KEY ("managerAId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rivalry" ADD CONSTRAINT "Rivalry_managerBId_fkey" FOREIGN KEY ("managerBId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSection" ADD CONSTRAINT "ArticleSection_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSection" ADD CONSTRAINT "ArticleSection_relatedManagerId_fkey" FOREIGN KEY ("relatedManagerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIContentGeneration" ADD CONSTRAINT "AIContentGeneration_relatedArticleId_fkey" FOREIGN KEY ("relatedArticleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIContentGeneration" ADD CONSTRAINT "AIContentGeneration_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatImport" ADD CONSTRAINT "ChatImport_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_chatImportId_fkey" FOREIGN KEY ("chatImportId") REFERENCES "ChatImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_linkedManagerId_fkey" FOREIGN KEY ("linkedManagerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_chatImportId_fkey" FOREIGN KEY ("chatImportId") REFERENCES "ChatImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChatParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_linkedManagerId_fkey" FOREIGN KEY ("linkedManagerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_linkedPlayerId_fkey" FOREIGN KEY ("linkedPlayerId") REFERENCES "FantasyPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTag" ADD CONSTRAINT "ChatTag_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalQuote" ADD CONSTRAINT "HistoricalQuote_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalQuote" ADD CONSTRAINT "HistoricalQuote_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalQuote" ADD CONSTRAINT "HistoricalQuote_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSyncLog" ADD CONSTRAINT "DataSyncLog_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSyncLog" ADD CONSTRAINT "DataSyncLog_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

