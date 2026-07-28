-- Marks scores that are on record but not verifiable as a real contest result,
-- so they can be excluded from records and the Hall of Shame without deleting
-- anything. See scripts/import/audit-suspect-scores.ts.
ALTER TABLE "MatchupTeam" ADD COLUMN "verifiedScore" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "MatchupTeam_verifiedScore_idx" ON "MatchupTeam"("verifiedScore");
