import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrintJobKind, PrintJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { isOnline, newDeviceToken } from "@/lib/print/device";
import { clearPrintQueue, enqueueTestPrint, retryAllFailedPrintJobs, retryFailedPrintJob } from "@/lib/print/jobs";

/** The live PC plus one standby. Setting up a third retires the oldest. */
const MAX_DEVICES = 2;

/** Owner's printer status and controls (phone). */
export async function GET() {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const [devices, queued, printing, failed, failedJobs, lastTest] = await Promise.all([
    prisma.printDevice.findMany({ orderBy: { createdAt: "desc" }, take: MAX_DEVICES }),
    prisma.printJob.count({ where: { status: PrintJobStatus.QUEUED } }),
    prisma.printJob.count({ where: { status: PrintJobStatus.PRINTING } }),
    prisma.printJob.count({ where: { status: PrintJobStatus.FAILED, createdAt: { gte: dayAgo } } }),
    prisma.printJob.findMany({
      where: { status: PrintJobStatus.FAILED, createdAt: { gte: dayAgo } },
      select: { id: true, title: true, error: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.printJob.findFirst({ where: { kind: PrintJobKind.TEST }, orderBy: { createdAt: "desc" } }),
  ]);
  // The PC that checked in most recently is "the" printer; a standby PC shows as a count.
  const device =
    [...devices].sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))[0] ?? null;
  return NextResponse.json({
    device: device
      ? {
          name: device.name,
          online: isOnline(device.lastSeenAt),
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          paused: device.paused,
          printerName: device.printerName,
          agentVersion: device.agentVersion,
          printerStatus: device.printerStatus,
          lastBackupAt: device.lastBackupAt?.toISOString() ?? null,
          lastBackupError: device.lastBackupError,
          lastBackupBytes: device.lastBackupBytes,
        }
      : null,
    deviceCount: devices.length,
    queued,
    printing,
    failedToday: failed,
    failedJobs: failedJobs.map((j) => ({
      id: j.id,
      title: j.title,
      error: j.error,
      createdAt: j.createdAt.toISOString(),
    })),
    lastTest: lastTest
      ? { status: lastTest.status, error: lastTest.error, createdAt: lastTest.createdAt.toISOString() }
      : null,
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["setup", "forget_others", "test_print", "pause", "resume", "clear_queue", "retry_failed"]) }),
  z.object({ action: z.literal("retry_job"), jobId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  switch (parsed.data.action) {
    case "setup": {
      // Pairs another PC without unpairing the working one (a standby, or a lost token).
      // Only the newest MAX_DEVICES stay paired.
      const { token, hash } = newDeviceToken();
      const existing = await prisma.printDevice.findMany({ orderBy: { createdAt: "desc" }, select: { id: true } });
      const retire = existing.slice(MAX_DEVICES - 1).map((d) => d.id);
      const paused = (await prisma.printDevice.findFirst({ where: { paused: true } })) !== null;
      await prisma.$transaction([
        ...(retire.length ? [prisma.printDevice.deleteMany({ where: { id: { in: retire } } })] : []),
        prisma.printDevice.create({
          data: { name: existing.length ? "Warehouse PC (new)" : "Warehouse PC", tokenHash: hash, paused },
        }),
      ]);
      // Shown once. Only its hash is stored.
      return NextResponse.json({ ok: true, token, retired: retire.length });
    }
    case "forget_others": {
      // Keep only the PC that checked in most recently.
      const devices = await prisma.printDevice.findMany({ select: { id: true, lastSeenAt: true } });
      const keep = [...devices].sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))[0];
      const res = keep ? await prisma.printDevice.deleteMany({ where: { id: { not: keep.id } } }) : { count: 0 };
      return NextResponse.json({ ok: true, removed: res.count });
    }
    case "test_print": {
      if (!(await prisma.printDevice.count())) {
        return NextResponse.json({ error: "Set up the printer PC first." }, { status: 400 });
      }
      await enqueueTestPrint();
      return NextResponse.json({ ok: true });
    }
    case "pause":
    case "resume":
      await prisma.printDevice.updateMany({ data: { paused: parsed.data.action === "pause" } });
      return NextResponse.json({ ok: true });
    case "clear_queue": {
      const cleared = await clearPrintQueue();
      return NextResponse.json({ ok: true, cleared });
    }
    case "retry_job": {
      const retried = await retryFailedPrintJob(parsed.data.jobId);
      if (!retried) return NextResponse.json({ error: "Print job cannot be retried." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    case "retry_failed": {
      const dayAgo = new Date(Date.now() - 24 * 3600_000);
      const retried = await retryAllFailedPrintJobs(dayAgo);
      return NextResponse.json({ ok: true, retried });
    }
  }
}
