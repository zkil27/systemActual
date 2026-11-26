import {
  ActionRequestStatus,
  DigitalStatus,
  DisputeStatus,
  Prisma,
  PrintJobStatus,
  PurchaseOrderStatus,
  StockReason,
  WaveStatus,
} from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { pruneOldOrders } from "@/lib/ledger/store";
import { pruneOldChats } from "@/lib/chats/prune";
import { getManilaDateString } from "@/lib/time";
import { AUDIT_RETENTION_DAYS } from "@/lib/audit";
import { pruneIntegrationEvents } from "@/lib/integrations/inbox";
import { pruneOrderFinance } from "@/lib/finance/report";
import { pruneAppErrors } from "@/lib/dev/errors";
import { pruneDevTables } from "@/lib/dev/tick-recorder";
import { isMissingTableError } from "@/lib/dev/db-errors";

const DAILY_PRUNE_LOCK_ID = "daily-prune";
const PRINT_JOB_RETENTION_DAYS = 30;
const WAVE_RETENTION_DAYS = 90;
const EVENT_PAYLOAD_RETENTION_DAYS = 14;
const PROOF_PHOTO_RETENTION_DAYS = 90;
const WALLET_RETENTION_DAYS = 180;
const STOCK_HISTORY_RETENTION_DAYS = 180;
/** Variants rolled up per day, so one prune never runs long. */
const ROLLUP_VARIANTS_PER_RUN = 50;
const ALERT_LOG_RETENTION_DAYS = 30;
const AI_EVENT_RETENTION_DAYS = 30;
const AI_USAGE_RETENTION_DAYS = 90;
const IMPORT_JOB_RETENTION_DAYS = 180;
const RETURN_PARCEL_RETENTION_DAYS = 365;
const PRICE_CHANGE_RETENTION_DAYS = 365;
const PURCHASE_ORDER_RETENTION_DAYS = 730;

export interface DailyPruneResult {
  skipped: boolean;
  partial?: boolean;
  orders: number;
  printJobs: number;
  waves: number;
  eventsCleared: number;
  blobsDeleted: number;
  walletDeleted: number;
  movementsRolledUp: number;
  returnParcelsDeleted?: number;
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

async function rollUpStockMovements(
  cutoff: Date,
  deadline: number
): Promise<{ rolled: number; timedOut: boolean }> {
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
  const day = cutoff.toISOString().slice(0, 10);
  let rolled = 0;
  for (const row of plan) {
    if (Date.now() >= deadline) return { rolled, timedOut: true };
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "GarmentVariant" WHERE id = ${row.garmentVariantId} FOR UPDATE`;
      const agg = await tx.stockMovement.aggregate({
        where: { garmentVariantId: row.garmentVariantId, createdAt: { lt: cutoff } },
        _sum: { delta: true },
        _count: { _all: true },
      });
      if ((agg._count._all ?? 0) <= 1) return;
      const deleted = await tx.stockMovement.deleteMany({
        where: { garmentVariantId: row.garmentVariantId, createdAt: { lt: cutoff } },
      });
      await tx.stockMovement.create({
        data: {
          garmentVariantId: row.garmentVariantId,
          delta: agg._sum.delta ?? 0,
          reason: StockReason.ADJUSTMENT,
          note: `Carried forward: ${agg._count._all} changes before ${day}`,
          sourceKey: row.sourceKey,
          createdAt: row.createdAt,
        },
      });
      rolled += deleted.count;
    });
  }
  return { rolled, timedOut: false };
}

/**
 * Runs retention cleanup at most once per Manila calendar day to keep Supabase
 * under 500 MB and Vercel Blob under 1 GB. Stops cleanly if `deadline` runs out
 * without stamping today's lock, so the next tick finishes the remaining tables.
 */
export async function pruneDailyData(
  now: Date = new Date(),
  deadline: number = Date.now() + 25_000
): Promise<DailyPruneResult> {
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

  const outOfTime = () => Date.now() >= deadline;
  const cutoff14d = new Date(now.getTime() - EVENT_PAYLOAD_RETENTION_DAYS * 24 * 3600_000);
  const cutoff30d = new Date(now.getTime() - PRINT_JOB_RETENTION_DAYS * 24 * 3600_000);
  const cutoff90d = new Date(now.getTime() - WAVE_RETENTION_DAYS * 24 * 3600_000);
  const photoCutoff = new Date(now.getTime() - PROOF_PHOTO_RETENTION_DAYS * 24 * 3600_000);

  const walletCutoff = new Date(now.getTime() - WALLET_RETENTION_DAYS * 24 * 3600_000);
  const stockCutoff = new Date(now.getTime() - STOCK_HISTORY_RETENTION_DAYS * 24 * 3600_000);
  const alertCutoff = new Date(now.getTime() - ALERT_LOG_RETENTION_DAYS * 24 * 3600_000);
  const aiEventCutoff = new Date(now.getTime() - AI_EVENT_RETENTION_DAYS * 24 * 3600_000);
  const aiUsageCutoff = new Date(now.getTime() - AI_USAGE_RETENTION_DAYS * 24 * 3600_000);
  const importJobCutoff = new Date(now.getTime() - IMPORT_JOB_RETENTION_DAYS * 24 * 3600_000);

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

  let partial = false;
  let movementsRolledUp = 0;
  let blobsDeleted = 0;
  let returnParcelsDeleted = 0;

  if (!outOfTime()) {
    try {
      await pruneOldChats(now);
    } catch (err) {
      console.error("[prune] chats", err);
    }
  } else {
    partial = true;
  }

  if (!partial && !outOfTime()) {
    try {
      await prisma.auditLog.deleteMany({
        where: { at: { lt: new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 3600_000) } },
      });
    } catch (err) {
      console.error("[prune] audit log", err);
    }
  } else {
    partial = true;
  }

  if (!partial && !outOfTime()) {
    try {
      await pruneIntegrationEvents(now);
    } catch (err) {
      console.error("[prune] webhook inbox", err);
    }
  } else {
    partial = true;
  }

  if (!partial && !outOfTime()) {
    try {
      // Monthly totals stay; per-order profit rows go after 120 days and raw breakdowns after 14 days.
      await pruneOrderFinance(now);
    } catch (err) {
      console.error("[prune] order finance", err);
    }
  } else {
    partial = true;
  }

  if (!partial && !outOfTime()) {
    try {
      const actionCutoff = new Date(now.getTime() - 60 * 24 * 3600_000);
      const returnCutoff = new Date(now.getTime() - RETURN_PARCEL_RETENTION_DAYS * 24 * 3600_000);
      const priceChangeCutoff = new Date(now.getTime() - PRICE_CHANGE_RETENTION_DAYS * 24 * 3600_000);
      const poCutoff = new Date(now.getTime() - PURCHASE_ORDER_RETENTION_DAYS * 24 * 3600_000);
      const [, , , , , returnPruned] = await Promise.all([
        prisma.aiEvent.deleteMany({ where: { createdAt: { lt: aiEventCutoff } } }),
        prisma.aiUsage.deleteMany({ where: { updatedAt: { lt: aiUsageCutoff } } }),
        prisma.importJob.deleteMany({ where: { createdAt: { lt: importJobCutoff } } }),
        prisma.actionRequest.updateMany({
          where: { status: ActionRequestStatus.PENDING, expiresAt: { lt: now } },
          data: { status: ActionRequestStatus.EXPIRED },
        }),
        prisma.actionRequest.deleteMany({
          where: {
            status: { not: ActionRequestStatus.PENDING },
            createdAt: { lt: actionCutoff },
          },
        }),
        prisma.returnParcel.deleteMany({
          where: {
            updatedAt: { lt: returnCutoff },
            disputeStatus: { not: DisputeStatus.FILED },
            OR: [
              { physicallyReceivedAt: { not: null } },
              { digitalStatus: { in: [DigitalStatus.RESOLVED_REFUNDED, DigitalStatus.CANCELLED_RETURN] } },
            ],
          },
        }),
        prisma.priceChange.deleteMany({ where: { createdAt: { lt: priceChangeCutoff } } }),
        prisma.purchaseOrder.deleteMany({
          where: {
            status: { in: [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CANCELLED] },
            updatedAt: { lt: poCutoff },
          },
        }),
      ]);
      returnParcelsDeleted = returnPruned.count;
    } catch (err) {
      console.error("[prune] ai/import/retention tables", err);
    }
  } else {
    partial = true;
  }

  if (!partial && !outOfTime()) {
    try {
      // Developer screen: error log 30 days, tick timings 3 days, API call stats 30 days.
      await Promise.all([pruneAppErrors(now), pruneDevTables(now)]);
    } catch (err) {
      if (!isMissingTableError(err)) console.error("[prune] developer tables", err);
    }
  } else {
    partial = true;
  }

  if (!partial && !outOfTime()) {
    try {
      const rollup = await rollUpStockMovements(stockCutoff, deadline);
      movementsRolledUp = rollup.rolled;
      if (rollup.timedOut) partial = true;
    } catch (err) {
      console.error("[prune] stock rollup", err);
    }
  } else {
    partial = true;
  }

  if (!partial && !outOfTime() && process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
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
  } else if (outOfTime()) {
    partial = true;
  }

  // Stamp the day only after all cleanup phases finished within the deadline.
  if (!partial) {
    await prisma.workerLock.upsert({
      where: { id: DAILY_PRUNE_LOCK_ID },
      create: { id: DAILY_PRUNE_LOCK_ID, lockedUntil: now, holder: todayStr, rerunRequested: false },
      update: { lockedUntil: now, holder: todayStr, rerunRequested: false },
    });
  }

  return {
    skipped: false,
    partial,
    orders,
    printJobs,
    waves,
    eventsCleared,
    blobsDeleted,
    walletDeleted,
    movementsRolledUp,
    returnParcelsDeleted,
  };
}
