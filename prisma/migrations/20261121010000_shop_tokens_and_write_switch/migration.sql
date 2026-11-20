-- AlterTable
ALTER TABLE "ShopConnection" ADD COLUMN     "tokenError" TEXT,
ADD COLUMN     "tokenErrorAt" TIMESTAMP(3),
ADD COLUMN     "writesEnabled" BOOLEAN NOT NULL DEFAULT false;
