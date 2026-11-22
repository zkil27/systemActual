import { NextRequest, NextResponse } from "next/server";
import { WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { claimJobs, computeNextPollMs, parseJobKinds, releaseJobs } from "@/lib/print/jobs";
import { withSpan } from "@/lib/otel";

export const dynamic = "force-dynamic";

const HEARTBEAT_WRITE_INTERVAL_MS = 45_000;

/** The PC checks in adaptively and takes the next chunk of jobs. */
export async function POST(req: NextRequest) {
  const device = await deviceFromAuthHeader(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown printer" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { version?: unknown; printer?: unknown; kinds?: unknown };
  const nextVersion = typeof body.version === "string" ? body.version.slice(0, 40) : device.agentVersion;
  const nextPrinter = typeof body.printer === "string" ? body.printer.slice(0, 120) : device.printerName;
  const now = new Date();
  const heartbeatDue =
    !device.lastSeenAt ||
    now.getTime() - device.lastSeenAt.getTime() >= HEARTBEAT_WRITE_INTERVAL_MS ||
    nextVersion !== device.agentVersion ||
    nextPrinter !== device.printerName;

  if (heartbeatDue) {
    await prisma.printDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: now,
        agentVersion: nextVersion,
        printerName: nextPrinter,
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
