import { NextRequest, NextResponse } from "next/server";
import { PhysicalCondition, Prisma, ReturnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMissingDiscrepancy, isOverdueRts, missingWhere, overdueWhere } from "@/lib/returns/rules";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filter = sp.get("filter") || "all";
    const q = (sp.get("q") || "").trim();

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const overdueDays = settings?.overdueRtsDays ?? 10;

    let where: Prisma.ReturnParcelWhereInput = {};

    if (filter === "failed") {
      where.category = ReturnCategory.FAILED_DELIVERY;
    } else if (filter === "refund") {
      where.category = ReturnCategory.RETURN_REFUND;
    } else if (filter === "missing") {
      where = { ...missingWhere };
    } else if (filter === "issues") {
      where.physicalCondition = {
        in: [
          PhysicalCondition.DAMAGED_ITEM,
          PhysicalCondition.WRONG_OR_SWAPPED_ITEM,
          PhysicalCondition.MISSING_PIECE,
        ],
      };
    } else if (filter === "overdue") {
      where = overdueWhere(overdueDays);
    }

    if (q) {
      where.OR = [
        { orderSn: { contains: q, mode: "insensitive" } },
        { returnSn: { contains: q, mode: "insensitive" } },
        { forwardTrackingNumber: { contains: q, mode: "insensitive" } },
        { rtsTrackingNumber: { contains: q, mode: "insensitive" } },
        { itemSummary: { contains: q, mode: "insensitive" } },
        { variationName: { contains: q, mode: "insensitive" } },
        { courier: { contains: q, mode: "insensitive" } },
      ];
    }

    const parcels = await prisma.returnParcel.findMany({
      where,
      include: {
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 1,
          include: { staffMember: { select: { name: true } } },
        },
      },
      orderBy: [{ courierReturnedToSellerAt: "desc" }, { digitalReturnTaggedAt: "desc" }],
      take: 300,
    });

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return NextResponse.json({
      parcels: parcels.map((p) => ({
        id: p.id,
        platform: p.platform,
        orderSn: p.orderSn,
        returnSn: p.returnSn,
        forwardTrackingNumber: p.forwardTrackingNumber,
        rtsTrackingNumber: p.rtsTrackingNumber,
        courier: p.courier,
        category: p.category,
        digitalStatus: p.digitalStatus,
        returnReason: p.returnReason,
        itemSummary: p.itemSummary,
        variationName: p.variationName,
        quantity: p.quantity,
        itemImageUrl: p.itemImageUrl,
        orderTotalPhp: Number(p.orderTotalPhp),
        estimatedUnitCostPhp: Number(p.estimatedUnitCostPhp),
        digitalReturnTaggedAt: p.digitalReturnTaggedAt?.toISOString() ?? null,
        courierReturnedToSellerAt: p.courierReturnedToSellerAt?.toISOString() ?? null,
        physicallyReceivedAt: p.physicallyReceivedAt?.toISOString() ?? null,
        physicalCondition: p.physicalCondition,
        disputeDeadlineAt: p.disputeDeadlineAt?.toISOString() ?? null,
        isMissingDiscrepancy: isMissingDiscrepancy(p),
        isOverdueRts: isOverdueRts(p, overdueDays, now),
        expectsPhysicalReturn: p.expectsPhysicalReturn,
        isUrgentDeadline: Boolean(
          p.disputeDeadlineAt &&
            p.disputeDeadlineAt.getTime() > now.getTime() - 2 * 60 * 60 * 1000 &&
            p.disputeDeadlineAt.getTime() <= in24h.getTime()
        ),
        scannedByName: p.scans[0]?.staffMember.name ?? null,
        photoCount: p.scans[0]?.photoUrls.length ?? 0,
      })),
    });
  } catch (err) {
    console.error("[Returns list API error]", err);
    return NextResponse.json({ error: "Could not load returns." }, { status: 500 });
  }
}
