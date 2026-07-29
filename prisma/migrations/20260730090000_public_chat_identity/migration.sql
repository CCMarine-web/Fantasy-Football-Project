-- Public-chat identity controls.
--
-- Anyone could post as "Michael Shea" on the open shoutbox, and somebody did.
-- Manager names, team names and known aliases are now reserved: the only way to
-- use one is to present that manager's personal chat code, which also earns the
-- Verified Manager badge. Everything else stays open to anonymous names.

-- 1. Per-manager chat code (hashed; the plaintext is shown once and never stored).
ALTER TABLE "Manager" ADD COLUMN "chatCodeHash" TEXT;

-- 2. Which manager a message was verified as, if any.
ALTER TABLE "PublicChatMessage" ADD COLUMN "verifiedManagerId" TEXT;
ALTER TABLE "PublicChatMessage"
  ADD CONSTRAINT "PublicChatMessage_verifiedManagerId_fkey"
  FOREIGN KEY ("verifiedManagerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PublicChatMessage_verifiedManagerId_idx" ON "PublicChatMessage"("verifiedManagerId");

-- 3. Admin moderation rules: blocked names and muted posters.
CREATE TYPE "ChatModerationKind" AS ENUM ('BLOCKED_NAME', 'MUTED_AUTHOR');

CREATE TABLE "ChatModerationRule" (
  "id"        TEXT NOT NULL,
  "kind"      "ChatModerationKind" NOT NULL,
  "value"     TEXT NOT NULL,
  "reason"    TEXT,
  "createdBy" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatModerationRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatModerationRule_kind_value_key" ON "ChatModerationRule"("kind", "value");
CREATE INDEX "ChatModerationRule_kind_idx" ON "ChatModerationRule"("kind");
