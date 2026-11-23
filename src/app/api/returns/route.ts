import { NextRequest, NextResponse } from "next/server";
import { DisputeStatus, PhysicalCondition, Prisma, ReturnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRealShopWhere } from "@/lib/shops";
import {
  activeSinceWhere,
  arrivedWhere,
  isMissingDiscrepancy,
  isOverdueRts,
  missingWhere,
  overdueWhere,
  returnedToSellerWhere,
  isUrgentDeadline,
  urgentDeadlineWhere,
} from "@/lib/returns/rules";
import { getManilaDateRangeBounds } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filter = sp.get("filter") || "all";
    const q = (sp.get("q") || "").trim();

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const overdueDays = settings?.overdueRtsDays ?? 10;
    const missingSinceAt = settings?.missingSinceAt ?? null;
    const now = new Date();

    const dateBounds = getManilaDateRangeBounds({
      range: sp.get("range"),
      date: sp.get("date"),
      from: sp.get("from"),
      to: sp.get("to"),
    });
    const hasDateFilter = Boolean(dateBounds && (dateBounds.start || dateBounds.end));

    const realFilter = await getRealShopWhere();
    const conditions: Prisma.ReturnParcelWhereInput[] = [];
    if (Object.keys(realFilter).length > 0) {
      conditions.push(realFilter);
    }
    // Apply the go-live cutoff only when viewing the unfiltered active queue;
    // explicit date/range filters, text searches and dispute views inspect history as well.
    if (!hasDateFilter && !q && filter !== "urgent" && filter !== "disputes") {
      const activeFilter = activeSinceWhere(missingSinceAt);
      if (activeFilter) {
        conditions.push(activeFilter);
      }
    }

    if (filter === "returned") {
      conditions.push(returnedToSellerWhere);
    } else if (filter === "arrived") {
      conditions.push(arrivedWhere(hasDateFilter ? null : missingSinceAt));
    } else if (filter === "failed") {
      conditions.push({ category: ReturnCategory.FAILED_DELIVERY });
    } else if (filter === "refund") {
      conditions.push({ category: ReturnCategory.RETURN_REFUND });
    } else if (filter === "missing") {
      conditions.push(missingWhere(missingSinceAt));
    } else if (filter === "issues") {
      conditions.push({
        physicalCondition: {
          in: [
            PhysicalCondition.DAMAGED_ITEM,
            PhysicalCondition.WRONG_OR_SWAPPED_ITEM,
            PhysicalCondition.MISSING_PIECE,
          ],
        },
      });
    } else if (filter === "overdue") {
      conditions.push(overdueWhere(overdueDays, now, missingSinceAt));
    } else if (filter === "urgent") {
      conditions.push(urgentDeadlineWhere(now));
    } else if (filter === "disputes") {
      conditions.push({ disputeStatus: DisputeStatus.FILED });
    }

    if (hasDateFilter && dateBounds) {
      const dtFilter: Prisma.DateTimeFilter = {
        ...(dateBounds.start ? { gte: dateBounds.start } : {}),
        ...(dateBounds.end ? { lt: dateBounds.end } : {}),
      };
      if (filter === "returned" || filter === "missing") {
        conditions.push({ courierReturnedToSellerAt: dtFilter });
      } else if (filter === "arrived") {
        conditions.push({ physicallyReceivedAt: dtFilter });
      } else {
        conditions.push({
          OR: [
            { digitalReturnTaggedAt: dtFilter },
            { digitalReturnTaggedAt: null, createdAt: dtFilter },
          ],
        });
      }
    }

    if (q) {
      conditions.push({
        OR: [
          { orderSn: { contains: q, mode: "insensitive" } },
          { returnSn: { contains: q, mode: "insensitive" } },
          { forwardTrackingNumber: { contains: q, mode: "insensitive" } },
          { rtsTrackingNumber: { contains: q, mode: "insensitive" } },
          { itemSummary: { contains: q, mode: "insensitive" } },
          { variationName: { contains: q, mode: "insensitive" } },
          { courier: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.ReturnParcelWhereInput = conditions.length ? { AND: conditions } : {};
    const limitRaw = Number(sp.get("limit"));
    const offsetRaw = Number(sp.get("offset"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 50;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

    const [totalCount, parcels] = await Promise.all([
      prisma.returnParcel.count({ where }),
      prisma.returnParcel.findMany({
        where,
        select: {
          id: true,
          courier: true,
          category: true,
          itemSummary: true,
          variationName: true,
          quantity: true,
          itemImageUrl: true,
          physicallyReceivedAt: true,
          physicalCondition: true,
          expectsPhysicalReturn: true,
          digitalStatus: true,
          courierReturnedToSellerAt: true,
          digitalReturnTaggedAt: true,
          disputeDeadlineAt: true,
          disputeStatus: true,
          resolvedAt: true,
        },
        orderBy:
          filter === "urgent"
            ? [{ disputeDeadlineAt: "asc" }]
            : [{ courierReturnedToSellerAt: "desc" }, { digitalReturnTaggedAt: "desc" }],
        take: limit,
        skip: offset,
      }),
    ]);

    return NextResponse.json({
      totalCount,
      limit,
      offset,
      hasMore: offset + parcels.length < totalCount,
      parcels: parcels.map((p) => ({
        id: p.id,
        courier: p.courier,
        category: p.category,
        digitalStatus: p.digitalStatus,
        itemSummary: p.itemSummary,
        variationName: p.variationName,
        quantity: p.quantity,
        itemImageUrl: p.itemImageUrl,
        digitalReturnTaggedAt: p.digitalReturnTaggedAt?.toISOString() ?? null,
        courierReturnedToSellerAt: p.courierReturnedToSellerAt?.toISOString() ?? null,
        physicallyReceivedAt: p.physicallyReceivedAt?.toISOString() ?? null,
        physicalCondition: p.physicalCondition,
        isMissingDiscrepancy: isMissingDiscrepancy(p, missingSinceAt),
        isOverdueRts: isOverdueRts(p, overdueDays, now, missingSinceAt),
        expectsPhysicalReturn: p.expectsPhysicalReturn,
        disputeStatus: p.disputeStatus,
        disputeDeadlineAt: p.disputeDeadlineAt?.toISOString() ?? null,
        isUrgentDeadline: isUrgentDeadline(p, now),
        resolvedAt: p.resolvedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error("[Returns list API error]", err);
    return NextResponse.json({ error: "Could not load returns." }, { status: 500 });
  }
}
