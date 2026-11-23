-- AlterTable
ALTER TABLE "PhysicalScan" ADD COLUMN IF NOT EXISTS "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalScan_clientKey_key" ON "PhysicalScan"("clientKey");
CREATE INDEX IF NOT EXISTS "PhysicalScan_parcelId_scannedAt_idx" ON "PhysicalScan"("parcelId", "scannedAt");
