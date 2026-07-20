-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('FULL_NAME', 'FIRST_NAME', 'SLEEPER_USERNAME', 'TEAM_NAME', 'NICKNAME', 'PHONE', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "HistorySectionType" AS ENUM ('ORIGIN', 'SEASON_SUMMARY', 'CHAMPIONSHIP', 'RIVALRY', 'RULE_CHANGE', 'CONTROVERSY', 'DRAFT_EVENT', 'TRADE', 'PUNISHMENT', 'TEAM_NAME_CHANGE', 'MEMORABLE_MOMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeType" AS ENUM ('PERSONALITY_TRAIT', 'DRAFT_TENDENCY', 'TRADE_TENDENCY', 'WAIVER_TENDENCY', 'RIVALRY', 'INSIDE_JOKE', 'NICKNAME', 'QUOTE', 'FAILED_PREDICTION', 'MEMORABLE_MOMENT', 'PLAYOFF_COLLAPSE', 'DRAFT_DISASTER', 'TRADE_REGRET', 'CHAMPIONSHIP_STORY', 'PUNISHMENT', 'TRADITION', 'STORYLINE');

-- CreateEnum
CREATE TYPE "PrivacyStatus" AS ENUM ('PUBLIC_SAFE', 'PRIVATE', 'NEVER_PUBLISH');

-- CreateEnum
CREATE TYPE "MediaCategory" AS ENUM ('PROFILE', 'HOMEPAGE_HERO', 'HISTORY', 'CHAMPIONSHIP', 'DRAFT', 'LOGIN', 'BACKGROUND', 'EVENT', 'UNCERTAIN');

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "normalizedSender" TEXT,
ADD COLUMN     "parseConfidence" DOUBLE PRECISION,
ADD COLUMN     "rawSender" TEXT,
ADD COLUMN     "sourcePage" INTEGER;

-- CreateTable
CREATE TABLE "ManagerAlias" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "aliasType" "AliasType" NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueHistorySection" (
    "id" TEXT NOT NULL,
    "year" INTEGER,
    "seasonId" TEXT,
    "sectionType" "HistorySectionType" NOT NULL DEFAULT 'SEASON_SUMMARY',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceRef" TEXT,
    "managerId" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "sensitivity" "SensitivityStatus" NOT NULL DEFAULT 'NONE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueHistorySection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueKnowledge" (
    "id" TEXT NOT NULL,
    "knowledgeType" "KnowledgeType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "seasonYear" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "sensitivity" "SensitivityStatus" NOT NULL DEFAULT 'NONE',
    "privacyStatus" "PrivacyStatus" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueKnowledgeManager" (
    "knowledgeId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,

    CONSTRAINT "LeagueKnowledgeManager_pkey" PRIMARY KEY ("knowledgeId","managerId")
);

-- CreateTable
CREATE TABLE "KnowledgeEvidence" (
    "id" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "seasonYear" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "originalFilename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "fileSizeBytes" INTEGER,
    "category" "MediaCategory" NOT NULL DEFAULT 'UNCERTAIN',
    "managerId" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentUsage" (
    "id" TEXT NOT NULL,
    "generationId" TEXT,
    "knowledgeId" TEXT,
    "factKey" TEXT,
    "articleType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerPerformanceSummary" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "providerName" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "inputHash" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerPerformanceSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagerAlias_aliasType_value_idx" ON "ManagerAlias"("aliasType", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerAlias_managerId_aliasType_value_key" ON "ManagerAlias"("managerId", "aliasType", "value");

-- CreateIndex
CREATE INDEX "LeagueHistorySection_year_idx" ON "LeagueHistorySection"("year");

-- CreateIndex
CREATE INDEX "LeagueHistorySection_approvalStatus_idx" ON "LeagueHistorySection"("approvalStatus");

-- CreateIndex
CREATE INDEX "LeagueKnowledge_knowledgeType_approvalStatus_idx" ON "LeagueKnowledge"("knowledgeType", "approvalStatus");

-- CreateIndex
CREATE INDEX "LeagueKnowledge_approvalStatus_privacyStatus_idx" ON "LeagueKnowledge"("approvalStatus", "privacyStatus");

-- CreateIndex
CREATE INDEX "LeagueKnowledgeManager_managerId_idx" ON "LeagueKnowledgeManager"("managerId");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_knowledgeId_idx" ON "KnowledgeEvidence"("knowledgeId");

-- CreateIndex
CREATE INDEX "MediaAsset_category_isPublished_idx" ON "MediaAsset"("category", "isPublished");

-- CreateIndex
CREATE INDEX "MediaAsset_approvalStatus_idx" ON "MediaAsset"("approvalStatus");

-- CreateIndex
CREATE INDEX "ContentUsage_generationId_idx" ON "ContentUsage"("generationId");

-- CreateIndex
CREATE INDEX "ContentUsage_knowledgeId_idx" ON "ContentUsage"("knowledgeId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerPerformanceSummary_managerId_key" ON "ManagerPerformanceSummary"("managerId");

-- CreateIndex
CREATE INDEX "ChatMessage_sourcePage_idx" ON "ChatMessage"("sourcePage");

-- AddForeignKey
ALTER TABLE "ManagerAlias" ADD CONSTRAINT "ManagerAlias_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueHistorySection" ADD CONSTRAINT "LeagueHistorySection_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueHistorySection" ADD CONSTRAINT "LeagueHistorySection_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueKnowledgeManager" ADD CONSTRAINT "LeagueKnowledgeManager_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "LeagueKnowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueKnowledgeManager" ADD CONSTRAINT "LeagueKnowledgeManager_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "LeagueKnowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentUsage" ADD CONSTRAINT "ContentUsage_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "LeagueKnowledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerPerformanceSummary" ADD CONSTRAINT "ManagerPerformanceSummary_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

