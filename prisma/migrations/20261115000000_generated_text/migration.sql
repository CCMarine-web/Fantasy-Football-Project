-- CreateTable
CREATE TABLE "GeneratedText" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "asOfSeason" INTEGER NOT NULL,
    "asOfWeek" INTEGER,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "validation" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedText_kind_idx" ON "GeneratedText"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedText_kind_subjectKey_key" ON "GeneratedText"("kind", "subjectKey");
