-- AlterTable
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "missingSinceAt" TIMESTAMP(3);

-- Initialize baseline to today's Asia/Manila midnight (stored as UTC) on existing installs
-- so pre-go-live backfilled returns do not trigger Missing alarms.
INSERT INTO "AppSettings" ("id", "missingSinceAt", "updatedAt")
SELECT
  'default',
  ((date_trunc('day', NOW() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'UTC'),
  (NOW() AT TIME ZONE 'UTC')
WHERE EXISTS (SELECT 1 FROM "ReturnParcel")
ON CONFLICT ("id") DO UPDATE
SET "missingSinceAt" = COALESCE("AppSettings"."missingSinceAt", EXCLUDED."missingSinceAt");
