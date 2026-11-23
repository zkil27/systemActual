-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DisputeStatus" AS ENUM ('NONE', 'FILED', 'WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "ReturnParcel"
  ADD COLUMN IF NOT EXISTS "disputeStatus" "DisputeStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "disputeFiledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disputeRef" TEXT,
  ADD COLUMN IF NOT EXISTS "reimbursedPhp" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedNote" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReturnParcel_disputeDeadlineAt_idx" ON "ReturnParcel"("disputeDeadlineAt");
