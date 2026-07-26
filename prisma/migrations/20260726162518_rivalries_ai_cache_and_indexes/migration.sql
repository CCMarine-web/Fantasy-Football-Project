-- AlterTable
ALTER TABLE "Rivalry" ADD COLUMN     "averageMargin" DOUBLE PRECISION,
ADD COLUMN     "championshipMeetings" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "closestGameSeason" INTEGER,
ADD COLUMN     "isOfficial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "largestBlowoutManagerId" TEXT,
ADD COLUMN     "largestBlowoutSeason" INTEGER,
ADD COLUMN     "lastMeetingSeason" INTEGER,
ADD COLUMN     "lastMeetingWeek" INTEGER,
ADD COLUMN     "lastMeetingWinnerId" TEXT,
ADD COLUMN     "longestStreakCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "longestStreakManagerId" TEXT,
ADD COLUMN     "managerAPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "managerBPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryInputHash" TEXT,
ADD COLUMN     "summaryIsMock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "summaryModel" TEXT,
ADD COLUMN     "summaryProvider" TEXT;

-- CreateTable
CREATE TABLE "RivalryMeeting" (
    "id" TEXT NOT NULL,
    "rivalryId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "managerAScore" DOUBLE PRECISION NOT NULL,
    "managerBScore" DOUBLE PRECISION NOT NULL,
    "winnerId" TEXT,
    "isPlayoff" BOOLEAN NOT NULL DEFAULT false,
    "isChampionship" BOOLEAN NOT NULL DEFAULT false,
    "dataSource" "SeasonDataSource" NOT NULL DEFAULT 'SLEEPER',

    CONSTRAINT "RivalryMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIBlurbCache" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIBlurbCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RivalryMeeting_rivalryId_idx" ON "RivalryMeeting"("rivalryId");

-- CreateIndex
CREATE UNIQUE INDEX "RivalryMeeting_rivalryId_seasonYear_week_key" ON "RivalryMeeting"("rivalryId", "seasonYear", "week");

-- CreateIndex
CREATE INDEX "AIBlurbCache_kind_idx" ON "AIBlurbCache"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "AIBlurbCache_kind_subjectKey_key" ON "AIBlurbCache"("kind", "subjectKey");

-- CreateIndex
CREATE INDEX "Championship_championManagerId_idx" ON "Championship"("championManagerId");

-- CreateIndex
CREATE INDEX "Championship_runnerUpFantasyTeamId_idx" ON "Championship"("runnerUpFantasyTeamId");

-- CreateIndex
CREATE INDEX "ChatMessage_timestamp_idx" ON "ChatMessage"("timestamp");

-- CreateIndex
CREATE INDEX "ChatMessage_linkedManagerId_idx" ON "ChatMessage"("linkedManagerId");

-- CreateIndex
CREATE INDEX "ChatMessage_deletedAt_idx" ON "ChatMessage"("deletedAt");

-- CreateIndex
CREATE INDEX "FantasyTeam_managerId_idx" ON "FantasyTeam"("managerId");

-- CreateIndex
CREATE INDEX "Rivalry_isOfficial_idx" ON "Rivalry"("isOfficial");

-- AddForeignKey
ALTER TABLE "RivalryMeeting" ADD CONSTRAINT "RivalryMeeting_rivalryId_fkey" FOREIGN KEY ("rivalryId") REFERENCES "Rivalry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
