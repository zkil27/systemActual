-- AlterTable
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "customWaybillEnabled" BOOLEAN NOT NULL DEFAULT false;
