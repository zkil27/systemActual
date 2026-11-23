import { NextRequest, NextResponse } from "next/server";
import { WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deviceFromAuthHeader, parseBackupReport } from "@/lib/print/device";
import { claimJobs, computeNextPollMs, parseJobKinds, releaseJobs } from "@/lib/print/jobs";
import { withSpan } from "@/lib/otel";

export const dynamic = "force-dynamic";

const HEARTBEAT_WRITE_INTERVAL_MS = 45_000;


/** The PC checks in adaptively and takes the next chunk of jobs. */
export async function POST(req: NextRequest) {
  const device = await deviceFromAuthHeader(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown printer" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    version?: unknown;
    printer?: unknown;
    kinds?: unknown;
    printerStatus?: unknown;
    backup?: unknown;
  };
  const nextVersion = typeof body.version === "string" ? body.version.slice(0, 40) : device.agentVersion;
  const nextPrinter = typeof body.printer === "string" ? body.printer.slice(0, 120) : device.printerName;
  // Older agents don't send these; keep what we had.
  const nextStatus =
    body.printerStatus === null
      ? null
      : typeof body.printerStatus === "string"
        ? body.printerStatus.slice(0, 60)
        : device.printerStatus;
  const backup = parseBackupReport(body.backup);
  const now = new Date();
  const backupChanged =
    backup !== null &&
    (backup.lastBackupAt?.getTime() !== device.lastBackupAt?.getTime() ||
      backup.lastBackupError !== device.lastBackupError ||
      backup.lastBackupBytes !== device.lastBackupBytes);
  const heartbeatDue =
    !device.lastSeenAt ||
    now.getTime() - device.lastSeenAt.getTime() >= HEARTBEAT_WRITE_INTERVAL_MS ||
    nextVersion !== device.agentVersion ||
    nextPrinter !== device.printerName ||
    nextStatus !== device.printerStatus ||
    backupChanged;

  if (heartbeatDue) {
    await prisma.printDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: now,
        agentVersion: nextVersion,
        printerName: nextPrinter,
        printerStatus: nextStatus,
        ...(backup ? backup : {}),
      },
    });
  }

  if (device.paused) {
    await releaseJobs(device.id);
    return NextResponse.json({ paused: true, jobs: [], nextPollMs: 30_000 });
  }

  const jobs = await withSpan("agent.poll.claimJobs", () => claimJobs(device.id, now, parseJobKinds(body.kinds)));
  const runningWaves =
    jobs.length > 0 ? 1 : await prisma.wave.count({ where: { status: WaveStatus.RUNNING } });

  return NextResponse.json({
    paused: false,
    jobs,
    nextPollMs: computeNextPollMs(jobs.length, runningWaves),
  });
}
