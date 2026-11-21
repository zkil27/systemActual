-- CreateEnum
CREATE TYPE "WaveStatus" AS ENUM ('PREVIEW', 'RUNNING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WaveItemStatus" AS ENUM ('READY', 'SHIPPING_ARRANGED', 'TRACKING_ASSIGNED', 'LABEL_READY', 'PRINTED', 'SKIPPED_CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Wave" (
    "id" TEXT NOT NULL,
    "status" "WaveStatus" NOT NULL DEFAULT 'PREVIEW',
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "parcelCount" INTEGER NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Wave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaveItem" (
    "id" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "groupKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "WaveItemStatus" NOT NULL DEFAULT 'READY',
    "activePackageId" TEXT,
    "trackingNumber" TEXT,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaveItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Wave_status_createdAt_idx" ON "Wave"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaveItem_activePackageId_key" ON "WaveItem"("activePackageId");

-- CreateIndex
CREATE INDEX "WaveItem_waveId_position_idx" ON "WaveItem"("waveId", "position");

-- CreateIndex
CREATE INDEX "WaveItem_packageId_idx" ON "WaveItem"("packageId");

-- AddForeignKey
ALTER TABLE "WaveItem" ADD CONSTRAINT "WaveItem_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "Wave"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaveItem" ADD CONSTRAINT "WaveItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
