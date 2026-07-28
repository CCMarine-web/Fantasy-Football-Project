-- Punishment photographs need their own media category so the Hall of Shame can
-- find them once an admin has confirmed the season and manager. They arrive with
-- no identifying information in the filename, so they land as PENDING.

-- AlterEnum
ALTER TYPE "MediaCategory" ADD VALUE 'PUNISHMENT';
