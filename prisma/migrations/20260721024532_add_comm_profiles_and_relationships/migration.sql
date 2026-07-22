-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('RIVALRY', 'FRIENDSHIP', 'ALLIANCE', 'ANTAGONISM', 'MIXED', 'NEUTRAL');

-- CreateTable
CREATE TABLE "ManagerCommunicationProfile" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "styleSummary" TEXT,
    "facets" JSONB,
    "messagesConsidered" INTEGER NOT NULL DEFAULT 0,
    "providerName" TEXT,
    "model" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "inputHash" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerCommunicationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueProfile" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "humorStyle" TEXT,
    "communicationStyle" TEXT,
    "dynamics" TEXT,
    "traditions" TEXT,
    "historicalContext" TEXT,
    "facets" JSONB,
    "providerName" TEXT,
    "model" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "inputHash" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerRelationship" (
    "id" TEXT NOT NULL,
    "managerAId" TEXT NOT NULL,
    "managerBId" TEXT NOT NULL,
    "relationshipType" "RelationshipType" NOT NULL DEFAULT 'MIXED',
    "summary" TEXT NOT NULL,
    "intensity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "privacyStatus" "PrivacyStatus" NOT NULL DEFAULT 'PRIVATE',
    "facets" JSONB,
    "providerName" TEXT,
    "model" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerCommunicationProfile_managerId_key" ON "ManagerCommunicationProfile"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueProfile_leagueId_key" ON "LeagueProfile"("leagueId");

-- CreateIndex
CREATE INDEX "ManagerRelationship_managerBId_idx" ON "ManagerRelationship"("managerBId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerRelationship_managerAId_managerBId_key" ON "ManagerRelationship"("managerAId", "managerBId");

-- AddForeignKey
ALTER TABLE "ManagerCommunicationProfile" ADD CONSTRAINT "ManagerCommunicationProfile_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueProfile" ADD CONSTRAINT "LeagueProfile_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerRelationship" ADD CONSTRAINT "ManagerRelationship_managerAId_fkey" FOREIGN KEY ("managerAId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerRelationship" ADD CONSTRAINT "ManagerRelationship_managerBId_fkey" FOREIGN KEY ("managerBId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
