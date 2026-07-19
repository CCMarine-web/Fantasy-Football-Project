-- CreateEnum
CREATE TYPE "SeasonDataSource" AS ENUM ('SLEEPER', 'ESPN', 'MANUAL');

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "dataSource" "SeasonDataSource" NOT NULL DEFAULT 'SLEEPER',
ADD COLUMN     "espnLeagueId" TEXT;

