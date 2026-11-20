-- AlterTable
ALTER TABLE "ShopConnection" ADD COLUMN     "ordersSyncedTo" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "orderSn" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isCod" BOOLEAN NOT NULL DEFAULT false,
    "totalPhp" DECIMAL(12,2) NOT NULL,
    "platformCreatedAt" TIMESTAMP(3) NOT NULL,
    "platformUpdatedAt" TIMESTAMP(3) NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "cancelBy" TEXT,
    "cancelReason" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variationName" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPricePhp" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packageNumber" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "channelId" TEXT,
    "status" TEXT,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingVariant" (
    "id" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "listingId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variationName" TEXT,
    "imageUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerLock" (
    "id" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "holder" TEXT,
    "rerunRequested" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WorkerLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_shopConnectionId_status_idx" ON "Order"("shopConnectionId", "status");

-- CreateIndex
CREATE INDEX "Order_status_platformUpdatedAt_idx" ON "Order"("status", "platformUpdatedAt");

-- CreateIndex
CREATE INDEX "Order_platformCreatedAt_idx" ON "Order"("platformCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_platform_orderSn_key" ON "Order"("platform", "orderSn");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_listingId_variationId_idx" ON "OrderLine"("listingId", "variationId");

-- CreateIndex
CREATE INDEX "Package_trackingNumber_idx" ON "Package"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Package_orderId_packageNumber_key" ON "Package"("orderId", "packageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ListingVariant_shopConnectionId_listingId_variationId_key" ON "ListingVariant"("shopConnectionId", "listingId", "variationId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingVariant" ADD CONSTRAINT "ListingVariant_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
