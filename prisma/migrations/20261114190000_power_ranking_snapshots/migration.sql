-- CreateTable
CREATE TABLE "PowerRankingSnapshot" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "fantasyTeamId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PowerRankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PowerRankingSnapshot_seasonId_week_idx" ON "PowerRankingSnapshot"("seasonId", "week");

-- CreateIndex
CREATE UNIQUE INDEX "PowerRankingSnapshot_seasonYear_week_fantasyTeamId_key" ON "PowerRankingSnapshot"("seasonYear", "week", "fantasyTeamId");
