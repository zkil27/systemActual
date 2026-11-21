-- AlterTable
ALTER TABLE "ShopConnection" ADD COLUMN     "stockImportCursor" TEXT,
ADD COLUMN     "stockImportStatus" TEXT,
ADD COLUMN     "stockImportedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ListingVariant" ADD COLUMN     "availableStock" INTEGER,
ADD COLUMN     "garmentVariantId" TEXT,
ADD COLUMN     "stockCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Garment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Garment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarmentVariant" (
    "id" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startingStock" INTEGER,
    "startingStockSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarmentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GarmentVariant_garmentId_idx" ON "GarmentVariant"("garmentId");

-- CreateIndex
CREATE INDEX "ListingVariant_garmentVariantId_idx" ON "ListingVariant"("garmentVariantId");

-- AddForeignKey
ALTER TABLE "ListingVariant" ADD CONSTRAINT "ListingVariant_garmentVariantId_fkey" FOREIGN KEY ("garmentVariantId") REFERENCES "GarmentVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentVariant" ADD CONSTRAINT "GarmentVariant_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "Garment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
