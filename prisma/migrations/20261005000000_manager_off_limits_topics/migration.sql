-- Per-manager off-limits topics for AI copy (src/server/ai/voice.ts).
-- AlterTable
ALTER TABLE "Manager" ADD COLUMN     "offLimitsTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];

