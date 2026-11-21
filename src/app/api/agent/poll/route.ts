import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { claimJobs, releaseJobs } from "@/lib/print/jobs";

export const dynamic = "force-dynamic";

/** The PC checks in every few seconds and takes the next chunk of jobs. */
export async function POST(req: NextRequest) {
  const device = await deviceFromAuthHeader(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown printer" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { version?: unknown; printer?: unknown };
  await prisma.printDevice.update({
    where: { id: device.id },
    data: {
      lastSeenAt: new Date(),
      agentVersion: typeof body.version === "string" ? body.version.slice(0, 40) : device.agentVersion,
      printerName: typeof body.printer === "string" ? body.printer.slice(0, 120) : device.printerName,
    },
  });

  if (device.paused) {
    await releaseJobs(device.id);
    return NextResponse.json({ paused: true, jobs: [] });
  }
  return NextResponse.json({ paused: false, jobs: await claimJobs(device.id) });
}
