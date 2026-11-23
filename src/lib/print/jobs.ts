import { PrintJobKind, PrintJobStatus, WaveItemStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finishDoneWaves, markLabelFailed, markLabelPrinted } from "@/lib/waves/run";

/** Labels handed to the PC per poll. Small enough that pausing stops within one chunk. */
export const CHUNK_SIZE = 25;
/** A job the PC claimed but never reported (crash, power cut) goes back in the queue. */
export const STALE_CLAIM_MS = 10 * 60_000;

export type JobReport = { status: "PRINTED" } | { status: "FAILED"; error: string };

/**
 * Only the PC that claimed a job can report it, and only while it's printing.
 * A late report for a job that was already requeued is rejected, so a label
 * can't be marked printed by a stale agent.
 */
export function applyReport(
  job: { status: PrintJobStatus; deviceId: string | null },
  deviceId: string,
  report: JobReport,
  now: Date
):
  | { ok: true; data: { status: PrintJobStatus; printedAt?: Date; error: string | null } }
  | { ok: false; reason: string } {
  if (job.deviceId !== deviceId) return { ok: false, reason: "not claimed by this printer" };
  if (job.status !== PrintJobStatus.PRINTING) return { ok: false, reason: `job is ${job.status}` };
  return report.status === "PRINTED"
    ? { ok: true, data: { status: PrintJobStatus.PRINTED, printedAt: now, error: null } }
    : { ok: true, data: { status: PrintJobStatus.FAILED, error: report.error.slice(0, 500) } };
}

/** Requeues jobs a PC claimed but never reported (crash, power cut). Run from worker tick, not idle polls. */
export async function requeueStalePrintJobs(now: Date = new Date()): Promise<number> {
  const res = await prisma.printJob.updateMany({
    where: { status: PrintJobStatus.PRINTING, claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    data: { status: PrintJobStatus.QUEUED, deviceId: null, claimedAt: null },
  });
  return res.count;
}

export function computeNextPollMs(jobCount: number, runningWaveCount: number): number {
  return jobCount > 0 || runningWaveCount > 0 ? 3_000 : 30_000;
}

/** Job kinds a PC asked for ("TEST" only on a PC that's just trying a printer). Unknown names are ignored. */
export function parseJobKinds(raw: unknown): PrintJobKind[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kinds = raw.filter((k): k is PrintJobKind => Object.values(PrintJobKind).includes(k as PrintJobKind));
  return kinds.length ? kinds : undefined;
}

/**
 * Oldest queued jobs first, grouped by wave and sorted in wave position order
 * so Shopee/TikTok labels never scramble. With `kinds`, only those kinds are
 * claimed; everything else stays queued for the real warehouse printer.
 *
 * When `customWaybillEnabled` is on, strips `docUrl` so the agent always fetches
 * from `/api/agent/jobs/:id/pdf` and runs `withCustomWaybill()`.
 */
export async function claimJobs(deviceId: string, now: Date = new Date(), kinds?: PrintJobKind[]) {
  const order = [
    { waveId: { sort: "asc" as const, nulls: "last" as const } },
    { position: "asc" as const },
    { createdAt: "asc" as const },
  ];
  const [queued, settings] = await Promise.all([
    prisma.printJob.findMany({
      where: { status: PrintJobStatus.QUEUED, ...(kinds ? { kind: { in: kinds } } : {}) },
      orderBy: order,
      take: CHUNK_SIZE,
      select: { id: true },
    }),
    prisma.appSettings.findUnique({
      where: { id: "default" },
      select: { customWaybillEnabled: true },
    }),
  ]);
  if (!queued.length) return [];
  const customWaybillEnabled = Boolean(settings?.customWaybillEnabled);
  const ids = queued.map((j) => j.id);
  await prisma.printJob.updateMany({
    where: { id: { in: ids }, status: PrintJobStatus.QUEUED },
    data: { status: PrintJobStatus.PRINTING, deviceId, claimedAt: now, attempts: { increment: 1 } },
  });
  const claimed = await prisma.printJob.findMany({
    where: { id: { in: ids }, status: PrintJobStatus.PRINTING, deviceId },
    orderBy: order,
    select: { id: true, kind: true, title: true, docUrl: true, docExpiresAt: true },
  });
  return claimed.map((j) => ({
    id: j.id,
    kind: j.kind,
    title: j.title,
    docUrl:
      !customWaybillEnabled && j.docUrl && j.docExpiresAt && j.docExpiresAt.getTime() > now.getTime()
        ? j.docUrl
        : null,
  }));
}

export async function reportJob(deviceId: string, jobId: string, report: JobReport, now: Date = new Date()) {
  const job = await prisma.printJob.findUnique({
    where: { id: jobId },
    select: { status: true, deviceId: true, kind: true, waveId: true, packageId: true, batchPackageIds: true },
  });
  if (!job) return { ok: false as const, reason: "job not found" };
  const result = applyReport(job, deviceId, report, now);
  if (!result.ok) return result;
  await prisma.printJob.update({ where: { id: jobId }, data: result.data });
  if (job.kind === PrintJobKind.LABEL && job.waveId) {
    const pkgIds = job.batchPackageIds.length > 0 ? job.batchPackageIds : job.packageId ? [job.packageId] : [];
    if (pkgIds.length > 0) {
      if (report.status === "PRINTED") {
        await markLabelPrinted(job.waveId, pkgIds);
      } else {
        await markLabelFailed(job.waveId, pkgIds, report.error);
        await finishDoneWaves(now);
      }
    }
  }
  return { ok: true as const };
}

export async function reportJobsBatch(
  deviceId: string,
  items: Array<{ id: string } & JobReport>,
  now: Date = new Date()
) {
  const outcomes: Array<{ id: string; ok: boolean; reason?: string }> = [];
  for (const item of items) {
    const res = await reportJob(
      deviceId,
      item.id,
      item.status === "PRINTED" ? { status: "PRINTED" } : { status: "FAILED", error: item.error },
      now
    );
    outcomes.push(res.ok ? { id: item.id, ok: true } : { id: item.id, ok: false, reason: res.reason });
  }
  return outcomes;
}

/** Pause: put this PC's unprinted claimed jobs back, so nothing is lost. */
export async function releaseJobs(deviceId: string) {
  const res = await prisma.printJob.updateMany({
    where: { deviceId, status: PrintJobStatus.PRINTING },
    data: { status: PrintJobStatus.QUEUED, deviceId: null, claimedAt: null },
  });
  return res.count;
}

export async function enqueueTestPrint() {
  return prisma.printJob.create({
    data: { kind: PrintJobKind.TEST, title: "Test print" },
    select: { id: true },
  });
}

/**
 * Cancels all queued or currently printing jobs so they won't print, and marks
 * any associated LABEL_READY wave items FAILED so the wave doesn't deadlock.
 */
export async function clearPrintQueue() {
  const pending = await prisma.printJob.findMany({
    where: { status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PRINTING] } },
    select: { id: true, kind: true, waveId: true, packageId: true, batchPackageIds: true },
  });
  if (!pending.length) return 0;

  const byWave = new Map<string, string[]>();
  for (const job of pending) {
    if (job.kind !== PrintJobKind.LABEL || !job.waveId) continue;
    const pkgIds = job.batchPackageIds.length > 0 ? job.batchPackageIds : job.packageId ? [job.packageId] : [];
    if (!pkgIds.length) continue;
    const list = byWave.get(job.waveId) ?? [];
    list.push(...pkgIds);
    byWave.set(job.waveId, list);
  }

  const res = await prisma.printJob.deleteMany({
    where: { id: { in: pending.map((p) => p.id) } },
  });

  for (const [waveId, pkgIds] of byWave) {
    await markLabelFailed(waveId, pkgIds, "Removed from print queue");
  }
  if (byWave.size > 0) {
    await finishDoneWaves();
  }
  return res.count;
}

/** Sums parcels printed across both single-parcel jobs and 50-parcel Shopee batch jobs. */
export function sumPrintedJobParcels(jobs: Array<{ batchPackageIds: string[] }>): number {
  let total = 0;
  for (const j of jobs) {
    total += j.batchPackageIds.length > 0 ? j.batchPackageIds.length : 1;
  }
  return total;
}

export async function countPrintedLabels(start: Date, end: Date): Promise<number> {
  const jobs = await prisma.printJob.findMany({
    where: {
      kind: PrintJobKind.LABEL,
      status: PrintJobStatus.PRINTED,
      printedAt: { gte: start, lt: end },
    },
    select: { batchPackageIds: true },
  });
  return sumPrintedJobParcels(jobs);
}

/** Retries a single FAILED print job and moves its wave items back to LABEL_READY. */
export async function retryFailedPrintJob(jobId: string): Promise<boolean> {
  const job = await prisma.printJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, kind: true, waveId: true, packageId: true, batchPackageIds: true },
  });
  if (!job || job.status !== PrintJobStatus.FAILED) return false;

  await prisma.$transaction(async (tx) => {
    await tx.printJob.update({
      where: { id: job.id },
      data: {
        status: PrintJobStatus.QUEUED,
        error: null,
        deviceId: null,
        claimedAt: null,
      },
    });
    if (job.kind === PrintJobKind.LABEL && job.waveId) {
      const pkgIds = job.batchPackageIds.length > 0 ? job.batchPackageIds : job.packageId ? [job.packageId] : [];
      if (pkgIds.length > 0) {
        await tx.waveItem.updateMany({
          where: { waveId: job.waveId, packageId: { in: pkgIds }, status: WaveItemStatus.FAILED },
          data: { status: WaveItemStatus.LABEL_READY, error: null },
        });
        await tx.wave.updateMany({
          where: { id: job.waveId, status: WaveStatus.DONE },
          data: { status: WaveStatus.RUNNING, finishedAt: null },
        });
      }
    }
  });
  return true;
}

export async function retryAllFailedPrintJobs(since: Date): Promise<number> {
  const failed = await prisma.printJob.findMany({
    where: { status: PrintJobStatus.FAILED, createdAt: { gte: since } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let count = 0;
  for (const job of failed) {
    if (await retryFailedPrintJob(job.id)) count++;
  }
  return count;
}
