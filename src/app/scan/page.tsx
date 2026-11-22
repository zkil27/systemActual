import { prisma } from "@/lib/prisma";
import { getScannerSession } from "@/lib/auth";
import { getPackerStats } from "@/lib/shipping/outbound";
import { getManilaDayBounds, getManilaTodayStr } from "@/lib/time";
import { missingWhere } from "@/lib/returns/rules";
import { ScanClient, type ScanInitialState } from "./ScanClient";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const session = await getScannerSession();

  if (!session) {
    const staff = await prisma.staffMember.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const initial: ScanInitialState = {
      unlocked: false,
      actorName: "",
      isOwnerActor: false,
      todayCount: 0,
      cancelledToPullCount: 0,
      unpickedOverdueCount: 0,
      pendingMissing: 0,
      recentScans: [],
      staffList: staff,
    };
    return <ScanClient initial={initial} />;
  }

  const { start, end } = getManilaDayBounds(getManilaTodayStr());
  const whereClause =
    session.actorType === "staff"
      ? { staffMemberId: session.staffId, scannedAt: { gte: start, lt: end } }
      : { scannedAt: { gte: start, lt: end } };

  const [todayCount, recentScans, settings, packStats] = await Promise.all([
    prisma.physicalScan.count({ where: whereClause }),
    prisma.physicalScan.findMany({
      where: whereClause,
      orderBy: { scannedAt: "desc" },
      take: 200,
      include: {
        parcel: {
          select: {
            id: true,
            orderSn: true,
            courier: true,
            category: true,
            itemSummary: true,
            variationName: true,
            quantity: true,
            itemImageUrl: true,
          },
        },
      },
    }),
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { missingSinceAt: true } }),
    getPackerStats(session),
  ]);
  const pendingMissingCount = await prisma.returnParcel.count({
    where: missingWhere(settings?.missingSinceAt ?? null),
  });

  const initial: ScanInitialState = {
    unlocked: true,
    actorName: session.name || "Staff",
    isOwnerActor: session.actorType === "owner",
    todayCount,
    cancelledToPullCount: packStats.cancelledToPullCount,
    unpickedOverdueCount: packStats.unpickedOverdueCount,
    pendingMissing: pendingMissingCount,
    recentScans: recentScans.map((s) => ({
      id: s.id,
      scannedBarcode: s.scannedBarcode,
      condition: s.condition,
      scannedAt: s.scannedAt.toISOString(),
      photoCount: s.photoUrls.length,
      parcel: s.parcel,
    })),
    staffList: [],
  };

  return <ScanClient initial={initial} />;
}
