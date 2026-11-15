-- CreateEnum
CREATE TYPE "PipelineStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "PipelineStatus" NOT NULL DEFAULT 'RUNNING',
    "stepReached" TEXT,
    "seasonYear" INTEGER,
    "week" INTEGER,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineLock" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineLock_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "PipelineRun_status_startedAt_idx" ON "PipelineRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "PipelineRun_job_startedAt_idx" ON "PipelineRun"("job", "startedAt");
