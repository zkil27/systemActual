-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('INITIAL', 'SUPPLIER_IN', 'RETURN_GOOD', 'SHIPPED', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "stockSafetyBuffer" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "stockRecordedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ListingVariant" ADD COLUMN     "pushError" TEXT,
ADD COLUMN     "pushFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pushedAt" TIMESTAMP(3),
ADD COLUMN     "pushedStock" INTEGER,
ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "garmentVariantId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "StockReason" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "note" TEXT,
    "staffMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_sourceKey_key" ON "StockMovement"("sourceKey");

-- CreateIndex
CREATE INDEX "StockMovement_garmentVariantId_idx" ON "StockMovement"("garmentVariantId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_garmentVariantId_fkey" FOREIGN KEY ("garmentVariantId") REFERENCES "GarmentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
