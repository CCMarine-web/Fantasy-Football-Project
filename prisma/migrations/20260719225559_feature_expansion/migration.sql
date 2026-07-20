-- CreateEnum
CREATE TYPE "GradeLetter" AS ENUM ('A_PLUS', 'A', 'A_MINUS', 'B_PLUS', 'B', 'B_MINUS', 'C_PLUS', 'C', 'C_MINUS', 'D', 'F');

-- CreateEnum
CREATE TYPE "WeeklyAwardType" AS ENUM ('BOOM_OF_WEEK', 'BUST_OF_WEEK', 'BENCH_BLUNDER', 'LUCKIEST_WIN', 'UNLUCKIEST_LOSS');

-- AlterTable
ALTER TABLE "Championship" ADD COLUMN     "victorySpeech" TEXT;

-- AlterTable
ALTER TABLE "Manager" ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "nicknameOrigin" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "signatureMove" TEXT;

-- CreateTable
CREATE TABLE "Punishment" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "year" INTEGER NOT NULL,
    "managerId" TEXT,
    "description" TEXT NOT NULL,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Punishment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT,
    "managerId" TEXT NOT NULL,
    "predictedStandings" JSONB NOT NULL,
    "predictedChampionManagerId" TEXT,
    "predictedLastManagerId" TEXT,
    "predictedOwnWins" INTEGER,
    "predictedOwnLosses" INTEGER,
    "bustManagerId" TEXT,
    "boldTake" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftGrade" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "grade" "GradeLetter",
    "rationale" TEXT,
    "revisitedGrade" "GradeLetter",
    "revisitedRationale" TEXT,
    "providerName" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisitedAt" TIMESTAMP(3),

    CONSTRAINT "DraftGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyAward" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "type" "WeeklyAwardType" NOT NULL,
    "managerId" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "seasonId" TEXT,
    "takeText" TEXT NOT NULL,
    "outcomeText" TEXT,
    "verdict" TEXT,
    "isWorstTake" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatIdentityMap" (
    "id" TEXT NOT NULL,
    "rawIdentifier" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatIdentityMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Punishment_year_key" ON "Punishment"("year");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_seasonId_managerId_key" ON "Prediction"("seasonId", "managerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftGrade_seasonId_managerId_key" ON "DraftGrade"("seasonId", "managerId");

-- CreateIndex
CREATE INDEX "WeeklyAward_managerId_idx" ON "WeeklyAward"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyAward_seasonId_week_type_key" ON "WeeklyAward"("seasonId", "week", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ChatIdentityMap_rawIdentifier_key" ON "ChatIdentityMap"("rawIdentifier");

-- AddForeignKey
ALTER TABLE "Punishment" ADD CONSTRAINT "Punishment_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Punishment" ADD CONSTRAINT "Punishment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftGrade" ADD CONSTRAINT "DraftGrade_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftGrade" ADD CONSTRAINT "DraftGrade_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyAward" ADD CONSTRAINT "WeeklyAward_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyAward" ADD CONSTRAINT "WeeklyAward_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatIdentityMap" ADD CONSTRAINT "ChatIdentityMap_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

