-- Public shoutbox for the open Chat page.
--
-- Entirely separate from the imported private group-chat archive (ChatMessage /
-- ChatImport), which stays admin-only and is never surfaced here.
--
-- `authorHash` is a salted one-way digest used only for rate limiting; no raw
-- IP address is stored, so this table holds no personal technical data.

-- CreateTable
CREATE TABLE "PublicChatMessage" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorHash" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "hiddenBy" TEXT,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicChatMessage_createdAt_idx" ON "PublicChatMessage"("createdAt");

-- CreateIndex
CREATE INDEX "PublicChatMessage_authorHash_createdAt_idx" ON "PublicChatMessage"("authorHash", "createdAt");

-- CreateIndex
CREATE INDEX "PublicChatMessage_hiddenAt_createdAt_idx" ON "PublicChatMessage"("hiddenAt", "createdAt");
