import { DigitalStatus, Prisma, PrintJobStatus, WaveStatus } from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { pruneOldOrders } from "@/lib/ledger/store";
import { getManilaDateString } from "@/lib/time";

const DAILY_PRUNE_LOCK_ID = "daily-prune";
const PRINT_JOB_RETENTION_DAYS = 30;
const WAVE_RETENTION_DAYS = 90;
const EVENT_PAYLOAD_RETENTION_DAYS = 14;
const PROOF_PHOTO_RETENTION_DAYS = 90;

export interface DailyPruneResult {
  skipped: boolean;
  orders: number;
  printJobs: number;
  waves: number;
  eventsCleared: number;
  blobsDeleted: number;
}

/**
 * Runs retention cleanup at most once per Manila calendar day to keep Supabase
 * under 500 MB and Vercel Blob under 1 GB.
 */
export async function pruneDailyData(now: Date = new Date()): Promise<DailyPruneResult> {
  const todayStr = getManilaDateString(now);
  const existing = await prisma.workerLock.findUnique({ where: { id: DAILY_PRUNE_LOCK_ID } });
  if (existing?.holder === todayStr) {
    return { skipped: true, orders: 0, printJobs: 0, waves: 0, eventsCleared: 0, blobsDeleted: 0 };
  }

  await prisma.workerLock.upsert({
    where: { id: DAILY_PRUNE_LOCK_ID },
    create: { id: DAILY_PRUNE_LOCK_ID, lockedUntil: now, holder: todayStr, rerunRequested: false },
    update: { lockedUntil: now, holder: todayStr, rerunRequested: false },
  });

  const cutoff14d = new Date(now.getTime() - EVENT_PAYLOAD_RETENTION_DAYS * 24 * 3600_000);
  const cutoff30d = new Date(now.getTime() - PRINT_JOB_RETENTION_DAYS * 24 * 3600_000);
  const cutoff90d = new Date(now.getTime() - WAVE_RETENTION_DAYS * 24 * 3600_000);
  const photoCutoff = new Date(now.getTime() - PROOF_PHOTO_RETENTION_DAYS * 24 * 3600_000);

  const [orders, printJobs, waves, eventsCleared] = await Promise.all([
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
  ]);

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

  return { skipped: false, orders, printJobs, waves, eventsCleared, blobsDeleted };
}
