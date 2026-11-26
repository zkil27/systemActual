-- CreateTable
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PushSubscription_ownerUserId_idx" ON "PushSubscription"("ownerUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PushSubscription_updatedAt_idx" ON "PushSubscription"("updatedAt");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "OwnerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Protect push subscription keys from Supabase PostgREST anon/authenticated roles
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
