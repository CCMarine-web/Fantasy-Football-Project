-- Separates consolation meetings from playoff meetings on rivalries, and
-- records which bracket each meeting belonged to.
ALTER TABLE "Rivalry" ADD COLUMN "consolationMeetings" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RivalryMeeting" ADD COLUMN "bracketType" "BracketType";
