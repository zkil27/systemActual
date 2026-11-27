-- CreateEnum
CREATE TYPE "ItemPublishMode" AS ENUM ('DRAFT', 'LIVE');

-- CreateEnum
CREATE TYPE "ItemPublishStatus" AS ENUM ('PENDING', 'PUSHED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ItemPublish" (
    "id" TEXT NOT NULL,
    "garmentId" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "publishMode" "ItemPublishMode" NOT NULL DEFAULT 'DRAFT',
    "status" "ItemPublishStatus" NOT NULL DEFAULT 'PENDING',
    "categoryId" TEXT,
    "categoryName" TEXT,
    "externalListingId" TEXT,
    "payloadJson" JSONB,
    "error" TEXT,
    "pushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPublish_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemPublish_status_updatedAt_idx" ON "ItemPublish"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ItemPublish_shopConnectionId_idx" ON "ItemPublish"("shopConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemPublish_garmentId_shopConnectionId_key" ON "ItemPublish"("garmentId", "shopConnectionId");

-- AddForeignKey
ALTER TABLE "ItemPublish" ADD CONSTRAINT "ItemPublish_garmentId_fkey" FOREIGN KEY ("garmentId") REFERENCES "Garment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPublish" ADD CONSTRAINT "ItemPublish_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

