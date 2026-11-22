import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDisputeAppealDraft } from "@/lib/reports/dispute-template";
import { isMissingDiscrepancy } from "@/lib/returns/rules";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const [parcel, settings] = await Promise.all([
      prisma.returnParcel.findUnique({
        where: { id },
        select: {
          id: true,
          platform: true,
          orderSn: true,
          forwardTrackingNumber: true,
          rtsTrackingNumber: true,
          courier: true,
          category: true,
          digitalStatus: true,
          expectsPhysicalReturn: true,
          returnReason: true,
          itemSummary: true,
          variationName: true,
          quantity: true,
          itemImageUrl: true,
          orderTotalPhp: true,
          estimatedUnitCostPhp: true,
          digitalReturnTaggedAt: true,
          courierReturnedToSellerAt: true,
          physicallyReceivedAt: true,
          physicalCondition: true,
          disputeDraft: true,
          scans: {
            orderBy: { scannedAt: "desc" },
            select: {
              id: true,
              condition: true,
              notes: true,
              photoUrls: true,
              scannedAt: true,
              staffMember: { select: { name: true } },
            },
          },
        },
      }),
      prisma.appSettings.findUnique({
        where: { id: "default" },
        select: { missingSinceAt: true },
      }),
    ]);
    if (!parcel) {
      return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
    }

    return NextResponse.json({
      parcel: {
        ...parcel,
        orderTotalPhp: Number(parcel.orderTotalPhp),
        estimatedUnitCostPhp: Number(parcel.estimatedUnitCostPhp),
        isMissingDiscrepancy: isMissingDiscrepancy(parcel, settings?.missingSinceAt ?? null),
      },
    });
  } catch (err) {
    console.error("[Return detail error]", err);
    return NextResponse.json({ error: "Could not load parcel details." }, { status: 500 });
  }
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const parcel = await prisma.returnParcel.findUnique({
      where: { id },
      include: {
        scans: { orderBy: { scannedAt: "desc" }, take: 1 },
      },
    });
    if (!parcel) {
      return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
    }

    const latestScan = parcel.scans[0];
    const draft = buildDisputeAppealDraft({
      platform: parcel.platform,
      orderSn: parcel.orderSn,
      returnSn: parcel.returnSn,
      forwardTrackingNumber: parcel.forwardTrackingNumber,
      rtsTrackingNumber: parcel.rtsTrackingNumber,
      courier: parcel.courier,
      category: parcel.category,
      returnReason: parcel.returnReason,
      itemSummary: parcel.itemSummary,
      variationName: parcel.variationName,
      quantity: parcel.quantity,
      digitalReturnTaggedAt: parcel.digitalReturnTaggedAt,
      courierReturnedToSellerAt: parcel.courierReturnedToSellerAt,
      physicallyReceivedAt: parcel.physicallyReceivedAt,
      physicalCondition: parcel.physicalCondition,
      staffNotes: latestScan?.notes ?? null,
      photoCount: latestScan?.photoUrls.length ?? 0,
    });

    await prisma.returnParcel.update({
      where: { id: parcel.id },
      data: { disputeDraft: draft },
    });

    return NextResponse.json({ draft });
  } catch (err) {
    console.error("[Dispute draft error]", err);
    return NextResponse.json({ error: "Could not build dispute draft." }, { status: 500 });
  }
}
