import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getScannerSession } from "@/lib/auth";
import { getManilaDayBounds, getManilaTodayStr } from "@/lib/time";

export async function GET() {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json({ unlocked: false });
  }

  const { start, end } = getManilaDayBounds(getManilaTodayStr());
  const whereClause =
    session.actorType === "staff"
      ? { staffMemberId: session.staffId, scannedAt: { gte: start, lt: end } }
      : { scannedAt: { gte: start, lt: end } };

  const [todayCount, recentScans, pendingMissingCount] = await Promise.all([
    prisma.physicalScan.count({ where: whereClause }),
    prisma.physicalScan.findMany({
      where: whereClause,
      orderBy: { scannedAt: "desc" },
      take: 8,
      include: {
        parcel: {
          select: {
            id: true,
            orderSn: true,
            courier: true,
            category: true,
            itemSummary: true,
            variationName: true,
            itemImageUrl: true,
          },
        },
      },
    }),
    prisma.returnParcel.count({
      where: {
        courierReturnedToSellerAt: { not: null },
        physicallyReceivedAt: null,
      },
    }),
  ]);

  return NextResponse.json({
    unlocked: true,
    actor: session,
    todayCount,
    pendingMissingCount,
    recentScans: recentScans.map((s) => ({
      id: s.id,
      scannedBarcode: s.scannedBarcode,
      condition: s.condition,
      scannedAt: s.scannedAt.toISOString(),
      photoCount: s.photoUrls.length,
      parcel: s.parcel,
    })),
  });
}
