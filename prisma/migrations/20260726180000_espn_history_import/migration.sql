-- ESPN history import (2017-2022) support.
--
-- All four changes are additive or widening, so existing Sleeper rows are
-- untouched and the migration is safe to run against production.

-- AlterEnum
-- ESPN "offline" drafts (results typed in after a draft held away from the
-- app) are neither snake nor auction nor linear.
ALTER TYPE "DraftType" ADD VALUE 'OFFLINE';

-- AlterTable
-- ESPN player ids, so a player who appears in both eras lives on one row.
ALTER TABLE "FantasyPlayer" ADD COLUMN     "espnPlayerId" INTEGER;

-- AlterTable
-- Stable per-season upsert key for ESPN games.
ALTER TABLE "Matchup" ADD COLUMN     "espnMatchupId" INTEGER;

-- AlterTable
-- Widen to nullable: ESPN's archived seasons expose roster membership but no
-- trustworthy per-week player score, and recording those as 0.0 would corrupt
-- every lineup-efficiency and best/worst-player figure on the site.
ALTER TABLE "WeeklyPlayerScore" ALTER COLUMN "points" DROP NOT NULL,
ALTER COLUMN "points" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "FantasyPlayer_espnPlayerId_key" ON "FantasyPlayer"("espnPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "Matchup_seasonId_espnMatchupId_key" ON "Matchup"("seasonId", "espnMatchupId");
