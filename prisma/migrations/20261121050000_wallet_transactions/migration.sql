-- CreateEnum
CREATE TYPE "MoneyKind" AS ENUM ('CREDIT', 'ADS', 'ADJUSTMENT', 'WITHDRAWAL', 'OTHER');

-- AlterTable
ALTER TABLE "ShopConnection" ADD COLUMN     "walletCheckedAt" TIMESTAMP(3),
ADD COLUMN     "walletSyncedTo" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" "MoneyKind" NOT NULL,
    "rawType" TEXT NOT NULL,
    "amountPhp" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "orderSn" TEXT,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletTransaction_occurredAt_kind_idx" ON "WalletTransaction"("occurredAt", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_platform_externalId_key" ON "WalletTransaction"("platform", "externalId");

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
