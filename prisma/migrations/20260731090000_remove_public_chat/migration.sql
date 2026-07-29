-- Removes the public shoutbox.
--
-- The feature is gone: no page, no API route, no anonymous write path. What is
-- dropped here is only ever written by that feature — visitor-submitted
-- messages, the salted address digests used to rate-limit them, and the
-- moderation rules that existed to police them.
--
-- The imported PRIVATE group-chat archive is untouched. That lives in
-- "ChatMessage" / "ChatImport" / "ChatParticipant" and is not referenced below.

-- DropForeignKey
ALTER TABLE "PublicChatMessage" DROP CONSTRAINT IF EXISTS "PublicChatMessage_verifiedManagerId_fkey";

-- DropTable
DROP TABLE IF EXISTS "PublicChatMessage";

-- DropTable
DROP TABLE IF EXISTS "ChatModerationRule";

-- DropEnum
DROP TYPE IF EXISTS "ChatModerationKind";

-- AlterTable: manager chat codes only ever authenticated a public-chat poster.
ALTER TABLE "Manager" DROP COLUMN IF EXISTS "chatCodeHash";
