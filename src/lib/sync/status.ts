import { prisma } from "@/lib/prisma";

export const STALE_SYNC_MS = 3 * 60_000;
const CATCHUP_LAG_MS = 15 * 60_000;

export interface SyncShopSnapshot {
  id: string;
  lastSyncedAt: Date | null;
  ordersSyncedTo: Date | null;
  returnsSyncedTo: Date | null;
  stockImportStatus: string | null;
}

export interface SyncStatusPayload {
  version: string;
  syncing: boolean;
  stale: boolean;
  catchingUp: boolean;
  lastSyncedAt: string | null;
}

export function buildSyncStatus(
  shops: SyncShopSnapshot[],
  lock: { holder: string | null; lockedUntil: Date } | null,
  now: Date = new Date()
): SyncStatusPayload {
  const nowMs = now.getTime();
  const syncing = Boolean(lock?.holder && lock.lockedUntil.getTime() > nowMs);
  const version = shops
    .map((s) =>
      [
        s.id,
        s.lastSyncedAt?.getTime() ?? 0,
        s.ordersSyncedTo?.getTime() ?? 0,
        s.returnsSyncedTo?.getTime() ?? 0,
        s.stockImportStatus ?? "",
      ].join(":")
    )
    .join("|");

  const stale = shops.some((s) => !s.lastSyncedAt || s.lastSyncedAt.getTime() < nowMs - STALE_SYNC_MS);
  const catchingUp = shops.some(
    (s) =>
      s.stockImportStatus === "RUNNING" ||
      (s.ordersSyncedTo !== null && nowMs - s.ordersSyncedTo.getTime() > CATCHUP_LAG_MS)
  );

  let latestMs = 0;
  for (const s of shops) {
    const t = s.lastSyncedAt?.getTime() ?? 0;
    if (t > latestMs) latestMs = t;
  }

  return {
    version,
    syncing,
    stale,
    catchingUp,
    lastSyncedAt: latestMs > 0 ? new Date(latestMs).toISOString() : null,
  };
}

/** Ultra-cheap 2-query sync status check (~5ms) used for version-gated UI auto-refresh. */
export async function getSyncStatus(now: Date = new Date()): Promise<SyncStatusPayload> {
  const [shops, lock] = await Promise.all([
    prisma.shopConnection.findMany({
      where: { isDemo: false, accessToken: { not: null } },
      select: {
        id: true,
        lastSyncedAt: true,
        ordersSyncedTo: true,
        returnsSyncedTo: true,
        stockImportStatus: true,
      },
      orderBy: { id: "asc" },
    }),
    prisma.workerLock.findUnique({
      where: { id: "tick" },
      select: { holder: true, lockedUntil: true },
    }),
  ]);
  return buildSyncStatus(shops, lock, now);
}
