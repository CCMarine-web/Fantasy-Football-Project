-- CreateTable
CREATE TABLE "PlayoffOddsSnapshot" (
    "id" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "fantasyTeamId" TEXT NOT NULL,
    "playoffPct" DOUBLE PRECISION NOT NULL,
    "byePct" DOUBLE PRECISION NOT NULL,
    "titlePct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayoffOddsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayoffOddsSnapshot_seasonYear_idx" ON "PlayoffOddsSnapshot"("seasonYear");

-- CreateIndex
CREATE UNIQUE INDEX "PlayoffOddsSnapshot_seasonYear_week_fantasyTeamId_key" ON "PlayoffOddsSnapshot"("seasonYear", "week", "fantasyTeamId");

