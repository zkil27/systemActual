-- AlterTable
ALTER TABLE "PrintDevice"
  ADD COLUMN IF NOT EXISTS "printerStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "lastBackupAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastBackupError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastBackupBytes" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertLog" (
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("key")
);
