import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrintJobKind, PrintJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { isOnline, newDeviceToken } from "@/lib/print/device";
import { enqueueTestPrint } from "@/lib/print/jobs";

/** Owner's printer status and controls (phone). */
export async function GET() {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const [device, queued, printing, failed, lastTest] = await Promise.all([
    prisma.printDevice.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.printJob.count({ where: { status: PrintJobStatus.QUEUED } }),
    prisma.printJob.count({ where: { status: PrintJobStatus.PRINTING } }),
    prisma.printJob.count({ where: { status: PrintJobStatus.FAILED, createdAt: { gte: dayAgo } } }),
    prisma.printJob.findFirst({ where: { kind: PrintJobKind.TEST }, orderBy: { createdAt: "desc" } }),
  ]);
  return NextResponse.json({
    device: device
      ? {
          name: device.name,
          online: isOnline(device.lastSeenAt),
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          paused: device.paused,
          printerName: device.printerName,
        }
      : null,
    queued,
    printing,
    failedToday: failed,
    lastTest: lastTest
      ? { status: lastTest.status, error: lastTest.error, createdAt: lastTest.createdAt.toISOString() }
      : null,
  });
}

const actionSchema = z.object({ action: z.enum(["setup", "test_print", "pause", "resume"]) });

export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  switch (parsed.data.action) {
    case "setup": {
      // One warehouse PC. A new token replaces the old one, so a lost token is fixed by setting up again.
      const { token, hash } = newDeviceToken();
      await prisma.$transaction([
        prisma.printDevice.deleteMany({}),
        prisma.printDevice.create({ data: { name: "Warehouse PC", tokenHash: hash } }),
      ]);
      // Shown once. Only its hash is stored.
      return NextResponse.json({ ok: true, token });
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
  }
}
