import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactOutboundPackageForStaff } from "@/lib/auth";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import {
  enrichPackageLineImages,
  getPackerStats,
  isOrderCancelledForPacking,
  OUTBOUND_PACKAGE_INCLUDE,
  resolveActorStaffMemberId,
} from "@/lib/shipping/outbound";
import { reprintLabel, WaveStartError } from "@/lib/waves/run";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm_pack"),
    packageId: z.string().min(1),
    courierLock: z.string().max(64).optional(),
  }),
  z.object({
    action: z.literal("mark_cancelled_pulled"),
    packageId: z.string().min(1),
  }),
  z.object({
    action: z.literal("reprint_label"),
    orderSn: z.string().min(3).max(64),
  }),
]);

export async function POST(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unlock the scanner with your 4-digit PIN first." },
      { status: 401 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (parsed.data.action === "reprint_label") {
    const deviceCount = await prisma.printDevice.count();
    if (!deviceCount) {
      return NextResponse.json(
        { error: "Printer PC is not connected in Settings yet." },
        { status: 400 }
      );
    }
    try {
      const result = await reprintLabel(parsed.data.orderSn);
      return NextResponse.json({ ok: true, orderSn: result.orderSn });
    } catch (err) {
      if (err instanceof WaveStartError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error("[scan pack reprint]", err);
      return NextResponse.json({ error: "Couldn't queue reprint." }, { status: 500 });
    }
  }

  const pkg = await prisma.package.findUnique({
    where: { id: parsed.data.packageId },
    include: OUTBOUND_PACKAGE_INCLUDE,
  });
  if (!pkg) {
    return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
  }

  const staffMemberId = await resolveActorStaffMemberId(session);
  if (!staffMemberId) {
    return NextResponse.json(
      { error: "No active staff profile configured in Settings." },
      { status: 400 }
    );
  }

  if (parsed.data.action === "mark_cancelled_pulled") {
    await prisma.package.update({
      where: { id: pkg.id },
      data: {
        packedAt: pkg.packedAt ?? new Date(),
        packedByStaffId: pkg.packedByStaffId ?? staffMemberId,
      },
    });
    const stats = await getPackerStats(session);
    return NextResponse.json({ ok: true, packageId: pkg.id, ...stats });
  }

  if (isOrderCancelledForPacking(pkg.order)) {
    return NextResponse.json(
      { error: "STOP — Buyer cancelled this order. Do not pack or hand to courier." },
      { status: 409 }
    );
  }

  const rawLock = parsed.data.courierLock?.trim() ?? "";
  if (rawLock && rawLock.toUpperCase() !== "ALL") {
    const expected = normalizeCourierName(rawLock);
    const actual = normalizeCourierName(pkg.carrier);
    if (actual !== expected) {
      return NextResponse.json(
        { error: `Wrong courier sack! This parcel is ${actual}, not ${expected}.` },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.package.update({
    where: { id: pkg.id },
    data: {
      packedAt: pkg.packedAt ?? new Date(),
      packedByStaffId: pkg.packedByStaffId ?? staffMemberId,
    },
    include: OUTBOUND_PACKAGE_INCLUDE,
  });

  const [enriched] = await enrichPackageLineImages([updated]);
  const stats = await getPackerStats(session);

  return NextResponse.json({
    ok: true,
    outbound: redactOutboundPackageForStaff(enriched),
    ...stats,
  });
}
