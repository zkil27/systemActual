-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "maintenanceMessage" TEXT,
ADD COLUMN     "maintenanceUntil" TIMESTAMP(3),
ADD COLUMN     "workerPaused" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AppError" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "route" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "buildId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "actorType" TEXT,
    "lastUserAgent" TEXT,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "ran" BOOLEAN NOT NULL DEFAULT true,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "steps" JSONB NOT NULL,
    "shopsTicked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkerRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCallStat" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "shopKey" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "throttled" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCallStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppError_fingerprint_key" ON "AppError"("fingerprint");

-- CreateIndex
CREATE INDEX "AppError_lastAt_idx" ON "AppError"("lastAt");

-- CreateIndex
CREATE INDEX "WorkerRun_startedAt_idx" ON "WorkerRun"("startedAt");

-- CreateIndex
CREATE INDEX "ApiCallStat_hour_idx" ON "ApiCallStat"("hour");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCallStat_platform_shopKey_pathKey_hour_key" ON "ApiCallStat"("platform", "shopKey", "pathKey", "hour");

