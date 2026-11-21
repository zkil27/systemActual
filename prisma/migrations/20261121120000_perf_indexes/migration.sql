-- AlterTable
ALTER TABLE "PrintJob"
  ADD COLUMN IF NOT EXISTS "docUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "docExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "batchPackageIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PrintJob_status_claimedAt_idx" ON "PrintJob"("status", "claimedAt");

-- PostgreSQL extensions and specialized performance indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Partial indexes for 1-minute worker tick scans
CREATE INDEX IF NOT EXISTS "Order_unrecorded_stock_idx"
  ON "Order" ("platformUpdatedAt")
  WHERE "stockRecordedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_unchecked_failed_delivery_idx"
  ON "Order" ("shopConnectionId", "platformUpdatedAt")
  WHERE "failedDeliveryCheckedAt" IS NULL AND "status" = 'CANCELLED' AND "shippedAt" IS NOT NULL;

-- Functional lowercase B-tree indexes for /api/scan/lookup exact matches
CREATE INDEX IF NOT EXISTS "ReturnParcel_rts_lower_idx" ON "ReturnParcel" (LOWER("rtsTrackingNumber"));
CREATE INDEX IF NOT EXISTS "ReturnParcel_fwd_lower_idx" ON "ReturnParcel" (LOWER("forwardTrackingNumber"));
CREATE INDEX IF NOT EXISTS "ReturnParcel_orderSn_lower_idx" ON "ReturnParcel" (LOWER("orderSn"));
CREATE INDEX IF NOT EXISTS "ReturnParcel_returnSn_lower_idx" ON "ReturnParcel" (LOWER("returnSn"));

-- Trigram GIN indexes for suffix fallback (/api/scan/lookup) and search (/api/returns, /api/stock-in)
CREATE INDEX IF NOT EXISTS "ReturnParcel_rts_trgm_idx" ON "ReturnParcel" USING GIN ("rtsTrackingNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ReturnParcel_fwd_trgm_idx" ON "ReturnParcel" USING GIN ("forwardTrackingNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ReturnParcel_orderSn_trgm_idx" ON "ReturnParcel" USING GIN ("orderSn" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ReturnParcel_itemSummary_trgm_idx" ON "ReturnParcel" USING GIN ("itemSummary" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Garment_name_trgm_idx" ON "Garment" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GarmentVariant_label_trgm_idx" ON "GarmentVariant" USING GIN ("label" gin_trgm_ops);

-- Repair any existing parcels where tagged date landed after courier return date
UPDATE "ReturnParcel"
SET "digitalReturnTaggedAt" = "courierReturnedToSellerAt"
WHERE "courierReturnedToSellerAt" IS NOT NULL
  AND ("digitalReturnTaggedAt" IS NULL OR "digitalReturnTaggedAt" > "courierReturnedToSellerAt");
