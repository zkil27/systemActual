-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "financeCheckedAt" TIMESTAMP(3),
ADD COLUMN     "financeSavedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderFinance" (
    "id" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "orderSn" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "month" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "piecesBackGood" INTEGER NOT NULL DEFAULT 0,
    "buyerPaidPhp" DECIMAL(12,2) NOT NULL,
    "netPayoutPhp" DECIMAL(12,2) NOT NULL,
    "commissionPhp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "serviceFeePhp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transactionFeePhp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "affiliatePhp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingPhp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "withholdingTaxPhp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherPhp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costPhp" DECIMAL(12,2) NOT NULL,
    "profitPhp" DECIMAL(12,2) NOT NULL,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderFinance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFinanceLine" (
    "id" TEXT NOT NULL,
    "financeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "garmentId" TEXT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "pieces" INTEGER NOT NULL,
    "netPayoutPhp" DECIMAL(12,2) NOT NULL,
    "costPhp" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderFinanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceMonth" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "orders" INTEGER NOT NULL,
    "pieces" INTEGER NOT NULL,
    "piecesBackGood" INTEGER NOT NULL,
    "buyerPaidPhp" DECIMAL(14,2) NOT NULL,
    "netPayoutPhp" DECIMAL(14,2) NOT NULL,
    "commissionPhp" DECIMAL(14,2) NOT NULL,
    "serviceFeePhp" DECIMAL(14,2) NOT NULL,
    "transactionFeePhp" DECIMAL(14,2) NOT NULL,
    "affiliatePhp" DECIMAL(14,2) NOT NULL,
    "shippingPhp" DECIMAL(14,2) NOT NULL,
    "withholdingTaxPhp" DECIMAL(14,2) NOT NULL,
    "otherPhp" DECIMAL(14,2) NOT NULL,
    "costPhp" DECIMAL(14,2) NOT NULL,
    "profitPhp" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemProfitMonth" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "garmentId" TEXT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "pieces" INTEGER NOT NULL,
    "netPayoutPhp" DECIMAL(14,2) NOT NULL,
    "costPhp" DECIMAL(14,2) NOT NULL,
    "profitPhp" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemProfitMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderFinance_month_idx" ON "OrderFinance"("month");

-- CreateIndex
CREATE INDEX "OrderFinance_settledAt_idx" ON "OrderFinance"("settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFinance_platform_orderSn_key" ON "OrderFinance"("platform", "orderSn");

-- CreateIndex
CREATE INDEX "OrderFinanceLine_month_itemKey_idx" ON "OrderFinanceLine"("month", "itemKey");

-- CreateIndex
CREATE INDEX "OrderFinanceLine_financeId_idx" ON "OrderFinanceLine"("financeId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceMonth_month_shopConnectionId_key" ON "FinanceMonth"("month", "shopConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemProfitMonth_month_itemKey_key" ON "ItemProfitMonth"("month", "itemKey");

-- CreateIndex
CREATE INDEX "Order_status_financeSavedAt_financeCheckedAt_idx" ON "Order"("status", "financeSavedAt", "financeCheckedAt");

-- AddForeignKey
ALTER TABLE "OrderFinance" ADD CONSTRAINT "OrderFinance_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFinanceLine" ADD CONSTRAINT "OrderFinanceLine_financeId_fkey" FOREIGN KEY ("financeId") REFERENCES "OrderFinance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceMonth" ADD CONSTRAINT "FinanceMonth_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

