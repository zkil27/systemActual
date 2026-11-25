-- CreateEnum
CREATE TYPE "ItemCheckResult" AS ENUM ('ALL_GOOD', 'SOME_DAMAGED', 'SOME_MISSING', 'WRONG_ITEM');

-- AlterTable
ALTER TABLE "ReturnParcel" ADD COLUMN     "itemCheckedAt" TIMESTAMP(3),
ADD COLUMN     "piecesDamaged" INTEGER,
ADD COLUMN     "piecesGood" INTEGER,
ADD COLUMN     "piecesMissing" INTEGER,
ADD COLUMN     "piecesWrong" INTEGER,
ADD COLUMN     "receivedValuePhp" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "PhysicalScan" ADD COLUMN     "checkMs" INTEGER,
ADD COLUMN     "packagingTorn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ReturnItemCheck" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "listingId" TEXT,
    "variationId" TEXT,
    "name" TEXT NOT NULL,
    "variationName" TEXT,
    "imageUrl" TEXT,
    "expectedQty" INTEGER NOT NULL,
    "goodQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "wrongQty" INTEGER NOT NULL DEFAULT 0,
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "result" "ItemCheckResult" NOT NULL,
    "unitPricePhp" DECIMAL(10,2),
    "priceSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnItemCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "shopExternalId" TEXT,
    "orderSn" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnItemCheck_parcelId_idx" ON "ReturnItemCheck"("parcelId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItemCheck_scanId_lineKey_key" ON "ReturnItemCheck"("scanId", "lineKey");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_at_idx" ON "AuditLog"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_externalKey_key" ON "IntegrationEvent"("externalKey");

-- CreateIndex
CREATE INDEX "IntegrationEvent_processedAt_receivedAt_idx" ON "IntegrationEvent"("processedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "ReturnParcel_piecesMissing_idx" ON "ReturnParcel"("piecesMissing");

-- CreateIndex
CREATE INDEX "ReturnParcel_piecesWrong_idx" ON "ReturnParcel"("piecesWrong");

-- AddForeignKey
ALTER TABLE "ReturnItemCheck" ADD CONSTRAINT "ReturnItemCheck_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "PhysicalScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItemCheck" ADD CONSTRAINT "ReturnItemCheck_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ReturnParcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

