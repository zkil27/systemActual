import { PhysicalCondition, Platform, ReturnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getManilaRangeBounds, isWithinBounds } from "@/lib/time";
import {
  costAtRiskPhp,
  isMissingDiscrepancy as isMissing,
  isOverdueRts as isOverdue,
} from "@/lib/returns/rules";

export interface CategoryDailyTruth {
  taggedCount: number;
  taggedPieces: number;
  taggedEstCostPhp: number;
  courierReturnedCount: number;
  courierReturnedPieces: number;
  physicallyArrivedCount: number;
  physicallyArrivedPieces: number;
  arrivedGoodCount: number;
  arrivedIssueCount: number;
  shopeeTaggedCount: number;
  tiktokTaggedCount: number;
  byCourier: Array<{ courier: string; tagged: number; arrived: number; missing: number }>;
}

export interface DailyTruthReport {
  rangeLabel: string;
  dateStr: string;
  defaultUnitCostPhp: number;
  overdueRtsDays: number;
  failedDelivery: CategoryDailyTruth;
  returnRefund: CategoryDailyTruth;
  combined: {
    taggedCount: number;
    courierReturnedCount: number;
    physicallyArrivedCount: number;
    missingNowCount: number;
    missingNowCostPhp: number;
    overdueRtsCount: number;
    urgentDeadlineCount: number;
    damagedOrSwappedTodayCount: number;
  };
  topItems: Array<{
    itemSummary: string;
    variationName: string | null;
    itemImageUrl: string | null;
    failedCount: number;
    returnCount: number;
    totalCount: number;
  }>;
  attentionParcels: Array<{
    id: string;
    platform: Platform;
    orderSn: string;
    forwardTrackingNumber: string | null;
    rtsTrackingNumber: string | null;
    courier: string;
    category: ReturnCategory;
    digitalStatus: string;
    returnReason: string | null;
    itemSummary: string;
    variationName: string | null;
    quantity: number;
    itemImageUrl: string | null;
    estimatedUnitCostPhp: number;
    digitalReturnTaggedAt: string | null;
    courierReturnedToSellerAt: string | null;
    physicallyReceivedAt: string | null;
    physicalCondition: PhysicalCondition | null;
    disputeDeadlineAt: string | null;
    isMissingDiscrepancy: boolean;
    isOverdueRts: boolean;
    isUrgentDeadline: boolean;
    expectsPhysicalReturn: boolean;
    scannedByName: string | null;
  }>;
  shops: Array<{
    id: string;
    platform: Platform;
    shopName: string;
    isDemo: boolean;
    lastSyncedAt: string | null;
  }>;
}

function emptyCategory(): CategoryDailyTruth {
  return {
    taggedCount: 0,
    taggedPieces: 0,
    taggedEstCostPhp: 0,
    courierReturnedCount: 0,
    courierReturnedPieces: 0,
    physicallyArrivedCount: 0,
    physicallyArrivedPieces: 0,
    arrivedGoodCount: 0,
    arrivedIssueCount: 0,
    shopeeTaggedCount: 0,
    tiktokTaggedCount: 0,
    byCourier: [],
  };
}

export async function getDailyTruthReport(options?: {
  range?: "today" | "yesterday" | "7days";
  date?: string;
}): Promise<DailyTruthReport> {
  const { label, dateStr, start, end } = getManilaRangeBounds(
    options?.range ?? "today",
    options?.date
  );

  const [settings, shops, parcels] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: "default" } }),
    prisma.shopConnection.findMany({ orderBy: { platform: "asc" } }),
    prisma.returnParcel.findMany({
      include: {
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 1,
          include: { staffMember: { select: { name: true } } },
        },
      },
      orderBy: [{ courierReturnedToSellerAt: "desc" }, { digitalReturnTaggedAt: "desc" }],
    }),
  ]);

  const defaultUnitCostPhp = Number(settings?.defaultUnitCostPhp ?? 82);
  const overdueRtsDays = settings?.overdueRtsDays ?? 10;
  const returnShippingEstimatePhp = Number(settings?.returnShippingEstimatePhp ?? 40);
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const failedDelivery = emptyCategory();
  const returnRefund = emptyCategory();

  const courierMaps: Record<
    ReturnCategory,
    Map<string, { tagged: number; arrived: number; missing: number }>
  > = {
    FAILED_DELIVERY: new Map(),
    RETURN_REFUND: new Map(),
  };

  const itemMap = new Map<
    string,
    {
      itemSummary: string;
      variationName: string | null;
      itemImageUrl: string | null;
      failedCount: number;
      returnCount: number;
    }
  >();

  let missingNowCount = 0;
  let missingNowCostPhp = 0;
  let overdueRtsCount = 0;
  let urgentDeadlineCount = 0;
  let damagedOrSwappedTodayCount = 0;

  const attentionCandidates: DailyTruthReport["attentionParcels"] = [];

  for (const p of parcels) {
    const bucket =
      p.category === ReturnCategory.FAILED_DELIVERY ? failedDelivery : returnRefund;
    const cMap = courierMaps[p.category];
    const cost = costAtRiskPhp(
      { estimatedUnitCostPhp: Number(p.estimatedUnitCostPhp), expectsPhysicalReturn: p.expectsPhysicalReturn },
      returnShippingEstimatePhp
    );

    const taggedInRange = isWithinBounds(p.digitalReturnTaggedAt, start, end);
    const courierReturnedInRange = isWithinBounds(p.courierReturnedToSellerAt, start, end);
    const arrivedInRange = isWithinBounds(p.physicallyReceivedAt, start, end);

    const isMissingDiscrepancy = isMissing(p);
    const isOverdueRts = isOverdue(p, overdueRtsDays, now);
    const isUrgentDeadline = Boolean(
      p.disputeDeadlineAt &&
        p.disputeDeadlineAt.getTime() > now.getTime() - 2 * 60 * 60 * 1000 &&
        p.disputeDeadlineAt.getTime() <= in24h.getTime()
    );

    if (isMissingDiscrepancy) {
      missingNowCount++;
      missingNowCostPhp += cost;
    }
    if (isOverdueRts) overdueRtsCount++;
    if (isUrgentDeadline) urgentDeadlineCount++;

    const ensureCourier = () => {
      let row = cMap.get(p.courier);
      if (!row) {
        row = { tagged: 0, arrived: 0, missing: 0 };
        cMap.set(p.courier, row);
      }
      return row;
    };

    if (taggedInRange) {
      bucket.taggedCount++;
      bucket.taggedPieces += p.quantity;
      bucket.taggedEstCostPhp += cost;
      if (p.platform === Platform.SHOPEE) bucket.shopeeTaggedCount++;
      else bucket.tiktokTaggedCount++;
      ensureCourier().tagged++;

      const key = `${p.itemSummary}||${p.variationName ?? ""}`;
      const existingItem = itemMap.get(key) ?? {
        itemSummary: p.itemSummary,
        variationName: p.variationName,
        itemImageUrl: p.itemImageUrl,
        failedCount: 0,
        returnCount: 0,
      };
      if (p.category === ReturnCategory.FAILED_DELIVERY) existingItem.failedCount++;
      else existingItem.returnCount++;
      itemMap.set(key, existingItem);
    }

    if (courierReturnedInRange) {
      bucket.courierReturnedCount++;
      bucket.courierReturnedPieces += p.quantity;
    }

    if (arrivedInRange) {
      bucket.physicallyArrivedCount++;
      bucket.physicallyArrivedPieces += p.quantity;
      ensureCourier().arrived++;
      if (
        p.physicalCondition === PhysicalCondition.GOOD_RESTOCKABLE ||
        p.physicalCondition === PhysicalCondition.DAMAGED_PACKAGING
      ) {
        bucket.arrivedGoodCount++;
      } else if (p.physicalCondition) {
        bucket.arrivedIssueCount++;
        damagedOrSwappedTodayCount++;
      }
    }

    if (isMissingDiscrepancy) {
      ensureCourier().missing++;
    }

    if (
      isMissingDiscrepancy ||
      isUrgentDeadline ||
      taggedInRange ||
      courierReturnedInRange ||
      arrivedInRange
    ) {
      attentionCandidates.push({
        id: p.id,
        platform: p.platform,
        orderSn: p.orderSn,
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
        estimatedUnitCostPhp: cost,
        digitalReturnTaggedAt: p.digitalReturnTaggedAt?.toISOString() ?? null,
        courierReturnedToSellerAt: p.courierReturnedToSellerAt?.toISOString() ?? null,
        physicallyReceivedAt: p.physicallyReceivedAt?.toISOString() ?? null,
        physicalCondition: p.physicalCondition,
        disputeDeadlineAt: p.disputeDeadlineAt?.toISOString() ?? null,
        isMissingDiscrepancy,
        isOverdueRts,
        isUrgentDeadline,
        expectsPhysicalReturn: p.expectsPhysicalReturn,
        scannedByName: p.scans[0]?.staffMember.name ?? null,
      });
    }
  }

  failedDelivery.byCourier = Array.from(courierMaps.FAILED_DELIVERY.entries())
    .map(([courier, stats]) => ({ courier, ...stats }))
    .sort((a, b) => b.tagged + b.missing - (a.tagged + a.missing));

  returnRefund.byCourier = Array.from(courierMaps.RETURN_REFUND.entries())
    .map(([courier, stats]) => ({ courier, ...stats }))
    .sort((a, b) => b.tagged + b.missing - (a.tagged + a.missing));

  const topItems = Array.from(itemMap.values())
    .map((x) => ({ ...x, totalCount: x.failedCount + x.returnCount }))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 6);

  // Prioritize Missing Discrepancies first, then Urgent Deadlines, then recent activity
  attentionCandidates.sort((a, b) => {
    const score = (x: typeof a) =>
      (x.isMissingDiscrepancy ? 100 : 0) +
      (x.isUrgentDeadline ? 50 : 0) +
      (x.physicalCondition === PhysicalCondition.WRONG_OR_SWAPPED_ITEM ||
      x.physicalCondition === PhysicalCondition.DAMAGED_ITEM
        ? 30
        : 0);
    return score(b) - score(a);
  });

  return {
    rangeLabel: label,
    dateStr,
    defaultUnitCostPhp,
    overdueRtsDays,
    failedDelivery,
    returnRefund,
    combined: {
      taggedCount: failedDelivery.taggedCount + returnRefund.taggedCount,
      courierReturnedCount:
        failedDelivery.courierReturnedCount + returnRefund.courierReturnedCount,
      physicallyArrivedCount:
        failedDelivery.physicallyArrivedCount + returnRefund.physicallyArrivedCount,
      missingNowCount,
      missingNowCostPhp,
      overdueRtsCount,
      urgentDeadlineCount,
      damagedOrSwappedTodayCount,
    },
    topItems,
    attentionParcels: attentionCandidates.slice(0, 12),
    shops: shops.map((s) => ({
      id: s.id,
      platform: s.platform,
      shopName: s.shopName,
      isDemo: s.isDemo,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
    })),
  };
}
