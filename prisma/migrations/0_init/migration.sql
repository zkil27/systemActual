-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('SHOPEE', 'TIKTOK');

-- CreateEnum
CREATE TYPE "ReturnCategory" AS ENUM ('FAILED_DELIVERY', 'RETURN_REFUND');

-- CreateEnum
CREATE TYPE "DigitalStatus" AS ENUM ('FAILED_DELIVERY_TAGGED', 'RETURNING_TO_SELLER', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'COURIER_RETURNED', 'DISPUTED', 'RESOLVED_REFUNDED', 'CANCELLED_RETURN');

-- CreateEnum
CREATE TYPE "PhysicalCondition" AS ENUM ('GOOD_RESTOCKABLE', 'DAMAGED_PACKAGING', 'DAMAGED_ITEM', 'WRONG_OR_SWAPPED_ITEM', 'MISSING_PIECE');

-- CreateTable
CREATE TABLE "OwnerUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopConnection" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "shopCipher" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnParcel" (
    "id" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "orderSn" TEXT NOT NULL,
    "returnSn" TEXT,
    "forwardTrackingNumber" TEXT,
    "rtsTrackingNumber" TEXT,
    "courier" TEXT NOT NULL,
    "category" "ReturnCategory" NOT NULL,
    "digitalStatus" "DigitalStatus" NOT NULL,
    "returnReason" TEXT,
    "disputeDeadlineAt" TIMESTAMP(3),
    "itemSummary" TEXT NOT NULL,
    "variationName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "itemImageUrl" TEXT,
    "itemsJson" JSONB,
    "orderTotalPhp" DECIMAL(10,2) NOT NULL,
    "estimatedUnitCostPhp" DECIMAL(10,2) NOT NULL,
    "orderCreatedAt" TIMESTAMP(3),
    "digitalReturnTaggedAt" TIMESTAMP(3),
    "courierReturnedToSellerAt" TIMESTAMP(3),
    "physicallyReceivedAt" TIMESTAMP(3),
    "physicalCondition" "PhysicalCondition",
    "disputeDraft" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnEvent" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "description" TEXT,
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "rawPayloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalScan" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "scannedBarcode" TEXT NOT NULL,
    "condition" "PhysicalCondition" NOT NULL,
    "notes" TEXT,
    "photoUrls" TEXT[],
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhysicalScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceHint" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL,
    "skippedRows" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultUnitCostPhp" DECIMAL(10,2) NOT NULL DEFAULT 82.00,
    "defaultSellingPrice" DECIMAL(10,2) NOT NULL DEFAULT 199.00,
    "overdueRtsDays" INTEGER NOT NULL DEFAULT 10,
    "telegramChatId" TEXT,
    "telegramDailyBriefUtc" TEXT NOT NULL DEFAULT '12:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerUser_email_key" ON "OwnerUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_name_key" ON "StaffMember"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ShopConnection_shopId_key" ON "ShopConnection"("shopId");

-- CreateIndex
CREATE INDEX "ReturnParcel_forwardTrackingNumber_idx" ON "ReturnParcel"("forwardTrackingNumber");

-- CreateIndex
CREATE INDEX "ReturnParcel_rtsTrackingNumber_idx" ON "ReturnParcel"("rtsTrackingNumber");

-- CreateIndex
CREATE INDEX "ReturnParcel_digitalReturnTaggedAt_idx" ON "ReturnParcel"("digitalReturnTaggedAt");

-- CreateIndex
CREATE INDEX "ReturnParcel_courierReturnedToSellerAt_idx" ON "ReturnParcel"("courierReturnedToSellerAt");

-- CreateIndex
CREATE INDEX "ReturnParcel_physicallyReceivedAt_idx" ON "ReturnParcel"("physicallyReceivedAt");

-- CreateIndex
CREATE INDEX "ReturnParcel_category_digitalStatus_idx" ON "ReturnParcel"("category", "digitalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnParcel_platform_orderSn_category_key" ON "ReturnParcel"("platform", "orderSn", "category");

-- CreateIndex
CREATE INDEX "ReturnEvent_parcelId_eventTimestamp_idx" ON "ReturnEvent"("parcelId", "eventTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnEvent_parcelId_source_rawStatus_eventTimestamp_key" ON "ReturnEvent"("parcelId", "source", "rawStatus", "eventTimestamp");

-- CreateIndex
CREATE INDEX "PhysicalScan_scannedAt_idx" ON "PhysicalScan"("scannedAt");

-- AddForeignKey
ALTER TABLE "ReturnParcel" ADD CONSTRAINT "ReturnParcel_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnEvent" ADD CONSTRAINT "ReturnEvent_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ReturnParcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalScan" ADD CONSTRAINT "PhysicalScan_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ReturnParcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalScan" ADD CONSTRAINT "PhysicalScan_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
