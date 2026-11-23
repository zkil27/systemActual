import { DigitalStatus, Prisma, PrintJobStatus, StockReason, WaveStatus } from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { pruneOldOrders } from "@/lib/ledger/store";
import { getManilaDateString } from "@/lib/time";

const DAILY_PRUNE_LOCK_ID = "daily-prune";
const PRINT_JOB_RETENTION_DAYS = 30;
const WAVE_RETENTION_DAYS = 90;
const EVENT_PAYLOAD_RETENTION_DAYS = 14;
const PROOF_PHOTO_RETENTION_DAYS = 90;
const WALLET_RETENTION_DAYS = 180;
const STOCK_HISTORY_RETENTION_DAYS = 180;
/** Variants rolled up per day, so one prune never runs long. */
const ROLLUP_VARIANTS_PER_RUN = 200;
const ALERT_LOG_RETENTION_DAYS = 30;

export interface DailyPruneResult {
  skipped: boolean;
  orders: number;
  printJobs: number;
  waves: number;
  eventsCleared: number;
  blobsDeleted: number;
  walletDeleted: number;
  movementsRolledUp: number;
}

/**
 * Old stock movements fold into one "carried forward" row per variant, so the
 * shelf count (sum of movements) is unchanged while the table stays small.
 * Pure planning step; returns the rows to write.
 */
export function planStockRollup(
  sums: Array<{ garmentVariantId: string; delta: number; count: number }>,
  cutoff: Date
): Array<{ garmentVariantId: string; delta: number; note: string; sourceKey: string; createdAt: Date }> {
  const day = cutoff.toISOString().slice(0, 10);
  return sums
    .filter((s) => s.count > 1)
    .map((s) => ({
      garmentVariantId: s.garmentVariantId,
      delta: s.delta,
      note: `Carried forward: ${s.count} changes before ${day}`,
      sourceKey: `rollup:${s.garmentVariantId}:${day}`,
      // Dated just before the cutoff so it sorts where the old rows were.
      createdAt: new Date(cutoff.getTime() - 1000),
    }));
}

async function rollUpStockMovements(cutoff: Date): Promise<number> {
  const sums = await prisma.stockMovement.groupBy({
    by: ["garmentVariantId"],
    where: { createdAt: { lt: cutoff } },
    // A lone old row (e.g. last run's carry-forward) needs nothing; don't let it use a slot.
    having: { garmentVariantId: { _count: { gt: 1 } } },
    _sum: { delta: true },
    _count: { _all: true },
    orderBy: { garmentVariantId: "asc" },
    take: ROLLUP_VARIANTS_PER_RUN,
  });
  const plan = planStockRollup(
    sums.map((g) => ({ garmentVariantId: g.garmentVariantId, delta: g._sum.delta ?? 0, count: g._count._all })),
    cutoff
  );
  let rolled = 0;
  for (const row of plan) {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.stockMovement.deleteMany({
        where: { garmentVariantId: row.garmentVariantId, createdAt: { lt: cutoff } },
      });
      await tx.stockMovement.create({
        data: {
          garmentVariantId: row.garmentVariantId,
          delta: row.delta,
          reason: StockReason.ADJUSTMENT,
          note: row.note,
          sourceKey: row.sourceKey,
          createdAt: row.createdAt,
        },
      });
      rolled += deleted.count;
    });
  }
  return rolled;
}

/**
 * Runs retention cleanup at most once per Manila calendar day to keep Supabase
 * under 500 MB and Vercel Blob under 1 GB.
 */
export async function pruneDailyData(now: Date = new Date()): Promise<DailyPruneResult> {
  const todayStr = getManilaDateString(now);
  const existing = await prisma.workerLock.findUnique({ where: { id: DAILY_PRUNE_LOCK_ID } });
  if (existing?.holder === todayStr) {
    return {
      skipped: true,
      orders: 0,
      printJobs: 0,
      waves: 0,
      eventsCleared: 0,
      blobsDeleted: 0,
      walletDeleted: 0,
      movementsRolledUp: 0,
    };
  }

  const cutoff14d = new Date(now.getTime() - EVENT_PAYLOAD_RETENTION_DAYS * 24 * 3600_000);
  const cutoff30d = new Date(now.getTime() - PRINT_JOB_RETENTION_DAYS * 24 * 3600_000);
  const cutoff90d = new Date(now.getTime() - WAVE_RETENTION_DAYS * 24 * 3600_000);
  const photoCutoff = new Date(now.getTime() - PROOF_PHOTO_RETENTION_DAYS * 24 * 3600_000);

  const walletCutoff = new Date(now.getTime() - WALLET_RETENTION_DAYS * 24 * 3600_000);
  const stockCutoff = new Date(now.getTime() - STOCK_HISTORY_RETENTION_DAYS * 24 * 3600_000);
  const alertCutoff = new Date(now.getTime() - ALERT_LOG_RETENTION_DAYS * 24 * 3600_000);

  const [orders, printJobs, waves, eventsCleared, walletDeleted] = await Promise.all([
    pruneOldOrders(now),
    prisma.printJob
      .deleteMany({
        where: {
          status: { in: [PrintJobStatus.PRINTED, PrintJobStatus.FAILED] },
          createdAt: { lt: cutoff30d },
        },
      })
      .then((r) => r.count),
    prisma.wave
      .deleteMany({
        where: {
          status: { in: [WaveStatus.DONE, WaveStatus.CANCELLED] },
          createdAt: { lt: cutoff90d },
        },
      })
      .then((r) => r.count),
    prisma.returnEvent
      .updateMany({
        where: {
          createdAt: { lt: cutoff14d },
          rawPayloadJson: { not: Prisma.JsonNull },
        },
        data: { rawPayloadJson: Prisma.JsonNull },
      })
      .then((r) => r.count),
    prisma.walletTransaction.deleteMany({ where: { occurredAt: { lt: walletCutoff } } }).then((r) => r.count),
    prisma.alertLog.deleteMany({ where: { sentAt: { lt: alertCutoff } } }).then((r) => r.count),
  ]);

  let movementsRolledUp = 0;
  try {
    movementsRolledUp = await rollUpStockMovements(stockCutoff);
  } catch (err) {
    console.error("[prune] stock rollup", err);
  }

  let blobsDeleted = 0;
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    try {
      const oldScans = await prisma.physicalScan.findMany({
        where: {
          scannedAt: { lt: photoCutoff },
          NOT: { photoUrls: { isEmpty: true } },
          parcel: {
            OR: [
              { physicallyReceivedAt: { not: null } },
              {
                digitalStatus: {
                  in: [DigitalStatus.RESOLVED_REFUNDED, DigitalStatus.CANCELLED_RETURN],
                },
              },
            ],
          },
        },
        select: { id: true, photoUrls: true },
        take: 100,
      });

      const blobUrls = oldScans
        .flatMap((s) => s.photoUrls)
        .filter((u) => /^https?:\/\//i.test(u));

      if (blobUrls.length > 0) {
        await del(blobUrls);
        blobsDeleted = blobUrls.length;
      }

      if (oldScans.length > 0) {
        await prisma.physicalScan.updateMany({
          where: { id: { in: oldScans.map((s) => s.id) } },
          data: { photoUrls: [] },
        });
      }
    } catch (err) {
      console.error("[prune] blob cleanup", err);
    }
  }

  // Stamp the day only after the work is done, so a prune that crashed halfway runs again.
  await prisma.workerLock.upsert({
    where: { id: DAILY_PRUNE_LOCK_ID },
    create: { id: DAILY_PRUNE_LOCK_ID, lockedUntil: now, holder: todayStr, rerunRequested: false },
    update: { lockedUntil: now, holder: todayStr, rerunRequested: false },
  });

  return { skipped: false, orders, printJobs, waves, eventsCleared, blobsDeleted, walletDeleted, movementsRolledUp };
}
