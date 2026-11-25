import { NextRequest, NextResponse } from "next/server";
import { DisputeStatus, PhysicalCondition, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildDisputeAppealDraft } from "@/lib/reports/dispute-template";
import {
  isMissingDiscrepancy,
  isOverdueRts,
  isPartialReturn,
  isRefundedNotBack,
  isUrgentDeadline,
  isWrongItemReturn,
} from "@/lib/returns/rules";
import { applyReturnAction, type ReturnAction } from "@/lib/returns/owner-actions";
import { getOwnerSession } from "@/lib/auth";
import { actorFromSession } from "@/lib/audit";

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
          shopConnectionId: true,
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
          disputeDeadlineAt: true,
          disputeStatus: true,
          disputeFiledAt: true,
          disputeRef: true,
          reimbursedPhp: true,
          resolvedAt: true,
          resolvedNote: true,
          returnSn: true,
          events: {
            orderBy: { eventTimestamp: "desc" },
            take: 40,
            select: { id: true, source: true, rawStatus: true, description: true, eventTimestamp: true },
          },
          scans: {
            orderBy: { scannedAt: "desc" },
            select: {
              id: true,
              condition: true,
              notes: true,
              photoUrls: true,
              scannedAt: true,
              packagingTorn: true,
              staffMember: { select: { name: true } },
              itemChecks: {
                orderBy: { createdAt: "asc" },
                select: {
                  lineKey: true,
                  name: true,
                  variationName: true,
                  imageUrl: true,
                  listingId: true,
                  variationId: true,
                  expectedQty: true,
                  goodQty: true,
                  damagedQty: true,
                  wrongQty: true,
                  missingQty: true,
                  result: true,
                  unitPricePhp: true,
                  priceSource: true,
                },
              },
            },
          },
          piecesGood: true,
          piecesDamaged: true,
          piecesWrong: true,
          piecesMissing: true,
          receivedValuePhp: true,
          itemCheckedAt: true,
        },
      }),
      prisma.appSettings.findUnique({
        where: { id: "default" },
        select: { missingSinceAt: true, overdueRtsDays: true },
      }),
    ]);
    if (!parcel) {
      return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
    }
    // Who did what, newest first (owner page only; staff never reach this route).
    const audit = await prisma.auditLog.findMany({
      where: { entity: "ReturnParcel", entityId: parcel.id },
      orderBy: { at: "desc" },
      take: 30,
      select: { id: true, at: true, actorType: true, actorName: true, action: true, after: true },
    });
    const missingSinceAt = settings?.missingSinceAt ?? null;
    const latestChecks = parcel.scans[0]?.itemChecks ?? [];
    // Items with no shop link can't be put back on the shelf by the app.
    const linked = latestChecks.length
      ? await prisma.listingVariant.findMany({
          where: {
            shopConnectionId: parcel.shopConnectionId,
            garmentVariantId: { not: null },
            OR: latestChecks
              .filter((c) => c.listingId && c.variationId)
              .map((c) => ({ listingId: c.listingId!, variationId: c.variationId! })),
          },
          select: { listingId: true, variationId: true },
        })
      : [];
    const linkedKeys = new Set(linked.map((l) => `${l.listingId}:${l.variationId}`));

    return NextResponse.json({
      audit,
      parcel: {
        ...parcel,
        scans: parcel.scans.map((s) => ({
          ...s,
          itemChecks: s.itemChecks.map((c) => ({
            ...c,
            unitPricePhp: c.unitPricePhp === null ? null : Number(c.unitPricePhp),
            stockLinked: Boolean(c.listingId && c.variationId && linkedKeys.has(`${c.listingId}:${c.variationId}`)),
          })),
        })),
        receivedValuePhp: parcel.receivedValuePhp === null ? null : Number(parcel.receivedValuePhp),
        isPartialReturn: isPartialReturn(parcel),
        isWrongItemReturn: isWrongItemReturn(parcel),
        isRefundedNotBack: isRefundedNotBack(parcel, missingSinceAt),
        orderTotalPhp: Number(parcel.orderTotalPhp),
        estimatedUnitCostPhp: Number(parcel.estimatedUnitCostPhp),
        reimbursedPhp: parcel.reimbursedPhp === null ? null : Number(parcel.reimbursedPhp),
        isMissingDiscrepancy: isMissingDiscrepancy(parcel, settings?.missingSinceAt ?? null),
        isOverdueRts: isOverdueRts(parcel, settings?.overdueRtsDays ?? 10, new Date(), settings?.missingSinceAt ?? null),
        isUrgentDeadline: isUrgentDeadline(parcel),
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
        scans: { orderBy: { scannedAt: "desc" }, take: 1, include: { itemChecks: { orderBy: { createdAt: "asc" } } } },
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
      itemChecks: latestScan?.itemChecks ?? [],
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

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_dispute"),
    status: z.nativeEnum(DisputeStatus),
    ref: z.string().trim().max(120).optional().nullable(),
    reimbursedPhp: z.number().min(0).max(1_000_000).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  }),
  z.object({
    action: z.literal("resolve"),
    outcome: z.enum(["FOUND", "SETTLED"]),
    note: z.string().trim().max(500).optional().nullable(),
  }),
  z.object({ action: z.literal("reopen") }),
  z.object({
    action: z.literal("correct_condition"),
    condition: z.nativeEnum(PhysicalCondition),
    note: z.string().trim().max(500).optional().nullable(),
  }),
  z.object({
    action: z.literal("correct_items"),
    checks: z
      .array(
        z.object({
          lineKey: z.string().min(1).max(300),
          missing: z.number().int().min(0).max(999).optional(),
          wrong: z.number().int().min(0).max(999).optional(),
          damaged: z.number().int().min(0).max(999).optional(),
        })
      )
      .max(100),
    packagingTorn: z.boolean().optional(),
    note: z.string().trim().max(500).optional().nullable(),
  }),
]);

/** Owner actions on one return: dispute status, settle / reopen, fix a wrong scan. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  try {
    const owner = await getOwnerSession();
    const result = await applyReturnAction(
      id,
      parsed.data as ReturnAction,
      new Date(),
      owner ? actorFromSession(owner) : undefined
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
    }
    console.error("[Return action error]", err);
    return NextResponse.json({ error: "Could not update parcel." }, { status: 500 });
  }
}
