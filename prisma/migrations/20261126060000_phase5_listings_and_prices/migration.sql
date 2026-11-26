-- Phase 5: Listings and prices in one place (ChannelProduct & PriceChange)

-- CreateEnum
CREATE TYPE "PriceChangeStatus" AS ENUM ('PENDING', 'PUSHED', 'PARTIAL', 'FAILED', 'REJECTED');

-- AlterTable
ALTER TABLE "ListingVariant"
    ADD COLUMN "channelProductId" TEXT,
    ADD COLUMN "pricePhp" DECIMAL(10, 2),
    ADD COLUMN "pricePushedPhp" DECIMAL(10, 2),
    ADD COLUMN "pricePushedAt" TIMESTAMP(3),
    ADD COLUMN "pricePushError" TEXT;

-- CreateTable
CREATE TABLE "ChannelProduct" (
    "id" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "listingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "status" TEXT,
    "imageUrls" JSONB NOT NULL DEFAULT '[]',
    "attributesJson" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "minPricePhp" DECIMAL(10, 2),
    "maxPricePhp" DECIMAL(10, 2),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceChange" (
    "id" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "garmentVariantId" TEXT,
    "actionRequestId" TEXT,
    "oldPricePhp" DECIMAL(10, 2),
    "newPricePhp" DECIMAL(10, 2) NOT NULL,
    "status" "PriceChangeStatus" NOT NULL DEFAULT 'PENDING',
    "resultsJson" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "pushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingVariant_channelProductId_idx" ON "ListingVariant"("channelProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelProduct_shopConnectionId_listingId_key" ON "ChannelProduct"("shopConnectionId", "listingId");

-- CreateIndex
CREATE INDEX "ChannelProduct_platform_updatedAt_idx" ON "ChannelProduct"("platform", "updatedAt");

-- CreateIndex
CREATE INDEX "PriceChange_garmentId_createdAt_idx" ON "PriceChange"("garmentId", "createdAt");

-- CreateIndex
CREATE INDEX "PriceChange_actionRequestId_idx" ON "PriceChange"("actionRequestId");

-- CreateIndex
CREATE INDEX "PriceChange_status_createdAt_idx" ON "PriceChange"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ListingVariant" ADD CONSTRAINT "ListingVariant_channelProductId_fkey" FOREIGN KEY ("channelProductId") REFERENCES "ChannelProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelProduct" ADD CONSTRAINT "ChannelProduct_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChange" ADD CONSTRAINT "PriceChange_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "Garment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChange" ADD CONSTRAINT "PriceChange_garmentVariantId_fkey" FOREIGN KEY ("garmentVariantId") REFERENCES "GarmentVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChange" ADD CONSTRAINT "PriceChange_actionRequestId_fkey" FOREIGN KEY ("actionRequestId") REFERENCES "ActionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
