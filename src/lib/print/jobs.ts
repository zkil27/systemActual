import { PrintJobKind, PrintJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { markLabelPrinted } from "@/lib/waves/run";

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

/** Oldest queued jobs first, in wave order, claimed atomically for this PC. */
export async function claimJobs(deviceId: string, now: Date = new Date()) {
  const order = [{ createdAt: "asc" as const }, { position: "asc" as const }];
  const queued = await prisma.printJob.findMany({
    where: { status: PrintJobStatus.QUEUED },
    orderBy: order,
    take: CHUNK_SIZE,
    select: { id: true },
  });
  if (!queued.length) return [];
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
    docUrl: j.docUrl && j.docExpiresAt && j.docExpiresAt.getTime() > now.getTime() ? j.docUrl : null,
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
  if (report.status === "PRINTED" && job.kind === PrintJobKind.LABEL && job.waveId) {
    const pkgIds = job.batchPackageIds.length > 0 ? job.batchPackageIds : job.packageId ? [job.packageId] : [];
    if (pkgIds.length > 0) {
      await markLabelPrinted(job.waveId, pkgIds);
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
