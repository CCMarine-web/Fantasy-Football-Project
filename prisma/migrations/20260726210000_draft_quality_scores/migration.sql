-- Draft grading rebuilt around draft-day decisions.
--
-- Additive only: the score and factor breakdown behind the ORIGINAL grade are
-- now persisted alongside the letter, so the report card can show what produced
-- it and the two can never drift apart. `adpAvailable` records whether average
-- draft position existed for the season, so the page can state plainly which
-- factors were measurable.

-- AlterTable
ALTER TABLE "DraftGrade" ADD COLUMN     "adpAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalFactors" JSONB,
ADD COLUMN     "originalScore" DOUBLE PRECISION;
