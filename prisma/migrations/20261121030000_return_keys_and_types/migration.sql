-- Return parcels are now keyed per return (R:<returnSn>) or per failed delivery
-- (F:<orderSn>) instead of (platform, orderSn, category), so two returns on one
-- order no longer collapse into one row. Existing rows get a key before the
-- NOT NULL + unique constraint is added.

-- AlterTable
ALTER TABLE "ShopConnection" ADD COLUMN "returnsSyncedTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "failedDeliveryCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReturnParcel" ADD COLUMN "dedupeKey" TEXT,
ADD COLUMN "expectsPhysicalReturn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN "returnRequestType" INTEGER,
ADD COLUMN "returnType" TEXT;

-- Backfill (same rule as returnDedupeKey() in src/lib/returns/keys.ts)
UPDATE "ReturnParcel"
SET "dedupeKey" = CASE
  WHEN "category" = 'FAILED_DELIVERY' THEN 'F:' || "orderSn"
  WHEN "returnSn" IS NOT NULL AND "returnSn" <> '' THEN 'R:' || "returnSn"
  ELSE 'R:order:' || "orderSn"
END;

ALTER TABLE "ReturnParcel" ALTER COLUMN "dedupeKey" SET NOT NULL;

-- DropIndex
DROP INDEX "ReturnParcel_platform_orderSn_category_key";

-- CreateIndex
CREATE UNIQUE INDEX "ReturnParcel_platform_dedupeKey_key" ON "ReturnParcel"("platform", "dedupeKey");

-- CreateIndex
CREATE INDEX "ReturnParcel_platform_orderSn_idx" ON "ReturnParcel"("platform", "orderSn");

-- CreateIndex
CREATE INDEX "ReturnParcel_lastCheckedAt_idx" ON "ReturnParcel"("lastCheckedAt");
