-- AlterTable
ALTER TABLE "Package"
  ADD COLUMN IF NOT EXISTS "packedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "packedByStaffId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Package_packedAt_idx" ON "Package"("packedAt");

-- Functional lowercase B-tree & trigram GIN indexes for fast outbound scan lookup
CREATE INDEX IF NOT EXISTS "Package_trackingNumber_lower_idx" ON "Package" (LOWER("trackingNumber"));
CREATE INDEX IF NOT EXISTS "Order_orderSn_lower_idx" ON "Order" (LOWER("orderSn"));
CREATE INDEX IF NOT EXISTS "Package_trackingNumber_trgm_idx" ON "Package" USING GIN ("trackingNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_orderSn_trgm_idx" ON "Order" USING GIN ("orderSn" gin_trgm_ops);

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Package_packedByStaffId_fkey'
  ) THEN
    ALTER TABLE "Package"
      ADD CONSTRAINT "Package_packedByStaffId_fkey"
      FOREIGN KEY ("packedByStaffId") REFERENCES "StaffMember"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
