-- AlterTable
ALTER TABLE "WaveItem" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "docRequestedAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "shipRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WaveItem_status_nextAttemptAt_idx" ON "WaveItem"("status", "nextAttemptAt");
