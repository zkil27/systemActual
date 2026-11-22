import {
  PhysicalCondition,
  Platform,
  PrintJobKind,
  PrintJobStatus,
  ReturnCategory,
  WaveItemStatus,
  WaveStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getManilaRangeBounds, isWithinBounds } from "@/lib/time";
import { getMoneySummary, type MoneySummary } from "@/lib/money/summary";
import { getStockOperationsSummary } from "@/lib/catalog/garments";
import { getShopeeBumpStatus } from "@/lib/catalog/shopee-bump";
import { isOnline } from "@/lib/print/device";
import { getReadyCounts } from "@/lib/waves/build";
import { isContinuousWave } from "@/lib/waves/schedule";
import {
  activeSinceWhere,
  costAtRiskPhp,
  isActiveSince,
  isMissingDiscrepancy as isMissing,
  isOverdueRts as isOverdue,
  missingWhere,
  overdueWhere,
} from "@/lib/returns/rules";
import { withSpan } from "@/lib/otel";

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
  money: MoneySummary;
  defaultUnitCostPhp: number;
  overdueRtsDays: number;
  missingSinceAt: string | null;
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
  operations: {
    readyToShipCount: number;
    readyShopeeCount: number;
    readyTikTokCount: number;
    coolingOffCount: number;
    printedTodayCount: number;
    runningWaveCount: number;
    waveNeedAttentionCount: number;
    wavesAutoEnabled: boolean;
    continuousAutoShip: boolean;
    printerOnline: boolean;
    printerQueuedCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    unlinkedCount: number;
    stockPushFailedCount: number;
    shopeeBumpEnabled: boolean;
    shopeeBoostedCount: number;
  };
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

  const now = new Date();
  const [settings, shops] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: "default" } }),
    prisma.shopConnection.findMany({ orderBy: { platform: "asc" } }),
  ]);

  const defaultUnitCostPhp = Number(settings?.defaultUnitCostPhp ?? 82);
  const overdueRtsDays = settings?.overdueRtsDays ?? 10;
  const returnShippingEstimatePhp = Number(settings?.returnShippingEstimatePhp ?? 40);
  const stockSafetyBuffer = settings?.stockSafetyBuffer ?? 0;
  const missingSinceAt = settings?.missingSinceAt ?? null;
  const activeFilter = activeSinceWhere(missingSinceAt);
  const effectiveStart =
    missingSinceAt && missingSinceAt.getTime() > start.getTime() ? missingSinceAt : start;
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const connectedPlatforms = new Set(
    shops.filter((s) => !s.isDemo && s.accessToken).map((s) => s.platform)
  ).size;
  const liveShopee = shops.find(
    (s) => s.platform === Platform.SHOPEE && !s.isDemo && Boolean(s.accessToken)
  );

  const [
    parcels,
    money,
    readyCounts,
    printedTodayCount,
    runningWaveCount,
    waveNeedAttentionCount,
    printDevice,
    printerQueuedCount,
    stockOps,
    bumpStatus,
  ] = await Promise.all([
    withSpan("dashboard.returnParcels", () =>
      prisma.returnParcel.findMany({
        where: {
          AND: [
            ...(activeFilter ? [activeFilter] : []),
            {
              OR: [
                { digitalReturnTaggedAt: { gte: effectiveStart, lt: end } },
                { courierReturnedToSellerAt: { gte: effectiveStart, lt: end } },
                { physicallyReceivedAt: { gte: effectiveStart, lt: end } },
                missingWhere(missingSinceAt),
                overdueWhere(overdueRtsDays, now, missingSinceAt),
                { disputeDeadlineAt: { gt: new Date(now.getTime() - 2 * 3600_000), lte: in24h } },
              ],
            },
          ],
        },
        select: {
          id: true,
          platform: true,
          orderSn: true,
          forwardTrackingNumber: true,
          rtsTrackingNumber: true,
          courier: true,
          category: true,
          digitalStatus: true,
          returnReason: true,
          itemSummary: true,
          variationName: true,
          quantity: true,
          itemImageUrl: true,
          estimatedUnitCostPhp: true,
          digitalReturnTaggedAt: true,
          courierReturnedToSellerAt: true,
          physicallyReceivedAt: true,
          physicalCondition: true,
          disputeDeadlineAt: true,
          expectsPhysicalReturn: true,
        },
        orderBy: [{ courierReturnedToSellerAt: "desc" }, { digitalReturnTaggedAt: "desc" }],
      })
    ),
    withSpan("dashboard.money", () => getMoneySummary(start, end, shops)),
    withSpan("dashboard.readyCounts", () => getReadyCounts(now)),
    prisma.printJob.count({
      where: {
        kind: PrintJobKind.LABEL,
        status: PrintJobStatus.PRINTED,
        printedAt: { gte: start, lt: end },
      },
    }),
    prisma.wave.count({ where: { status: WaveStatus.RUNNING } }),
    prisma.waveItem.count({
      where: {
        status: WaveItemStatus.FAILED,
        wave: {
          OR: [{ status: WaveStatus.RUNNING }, { status: WaveStatus.DONE, createdAt: { gte: start, lt: end } }],
        },
      },
    }),
    prisma.printDevice.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.printJob.count({ where: { status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PRINTING] } } }),
    withSpan("dashboard.catalog", () => getStockOperationsSummary(stockSafetyBuffer, connectedPlatforms)),
    getShopeeBumpStatus(now, liveShopee ? { id: liveShopee.id, shopName: liveShopee.shopName } : null),
  ]);

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
    if (!isActiveSince(p, missingSinceAt)) continue;
    const bucket =
      p.category === ReturnCategory.FAILED_DELIVERY ? failedDelivery : returnRefund;
    const cMap = courierMaps[p.category];
    const cost = costAtRiskPhp(
      { estimatedUnitCostPhp: Number(p.estimatedUnitCostPhp), expectsPhysicalReturn: p.expectsPhysicalReturn },
      returnShippingEstimatePhp
    );

    const taggedInRange = isWithinBounds(p.digitalReturnTaggedAt, effectiveStart, end);
    const courierReturnedInRange = isWithinBounds(p.courierReturnedToSellerAt, effectiveStart, end);
    const arrivedInRange = isWithinBounds(p.physicallyReceivedAt, effectiveStart, end);

    const isMissingDiscrepancy = isMissing(p, missingSinceAt);
    const isOverdueRts = isOverdue(p, overdueRtsDays, now, missingSinceAt);
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
        scannedByName: null,
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

  const attentionParcels = attentionCandidates.slice(0, 12);
  if (attentionParcels.length > 0) {
    const scans = await prisma.physicalScan.findMany({
      where: { parcelId: { in: attentionParcels.map((p) => p.id) } },
      orderBy: { scannedAt: "desc" },
      select: { parcelId: true, staffMember: { select: { name: true } } },
    });
    const scannerByParcel = new Map<string, string>();
    for (const s of scans) {
      if (!scannerByParcel.has(s.parcelId)) {
        scannerByParcel.set(s.parcelId, s.staffMember.name);
      }
    }
    for (const p of attentionParcels) {
      p.scannedByName = scannerByParcel.get(p.id) ?? null;
    }
  }

  const { lowStockCount, outOfStockCount, unlinkedCount, stockPushFailedCount } = stockOps;

  return {
    rangeLabel: label,
    dateStr,
    money,
    defaultUnitCostPhp,
    overdueRtsDays,
    missingSinceAt: missingSinceAt?.toISOString() ?? null,
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
    attentionParcels,
    shops: shops.map((s) => ({
      id: s.id,
      platform: s.platform,
      shopName: s.shopName,
      isDemo: s.isDemo,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
    })),
    operations: {
      readyToShipCount: readyCounts.totalReady,
      readyShopeeCount: readyCounts.byPlatform.SHOPEE,
      readyTikTokCount: readyCounts.byPlatform.TIKTOK,
      coolingOffCount: readyCounts.coolingOff,
      printedTodayCount,
      runningWaveCount,
      waveNeedAttentionCount,
      wavesAutoEnabled: Boolean(settings?.wavesAutoEnabled),
      continuousAutoShip: isContinuousWave(settings?.waveTimes ?? ""),
      printerOnline: printDevice ? isOnline(printDevice.lastSeenAt, now) : false,
      printerQueuedCount,
      lowStockCount,
      outOfStockCount,
      unlinkedCount,
      stockPushFailedCount,
      shopeeBumpEnabled: bumpStatus.enabled,
      shopeeBoostedCount: bumpStatus.boosted.length,
    },
  };
}
