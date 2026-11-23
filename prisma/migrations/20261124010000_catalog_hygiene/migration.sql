-- AlterTable
ALTER TABLE "Garment"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unitCostPhp" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "sellingPricePhp" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER,
  ADD COLUMN IF NOT EXISTS "safetyBuffer" INTEGER,
  ADD COLUMN IF NOT EXISTS "binLocation" TEXT;

-- Stock history per variant and the recent activity feed.
DROP INDEX IF EXISTS "StockMovement_garmentVariantId_idx";
CREATE INDEX IF NOT EXISTS "StockMovement_garmentVariantId_createdAt_idx" ON "StockMovement"("garmentVariantId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");
