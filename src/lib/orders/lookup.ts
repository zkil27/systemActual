import { MoneyKind, OrderState, Platform, PrintJobKind, PrintJobStatus, Prisma } from "@prisma/client";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { isCancelledOrderState, isDeliveredOrderState, normalizeOrderState } from "@/lib/ledger/state";
import { prisma } from "@/lib/prisma";
import { hasRealConnectedShop } from "@/lib/shops";

/** The plain-English steps one order goes through, in order. */
export type OrderStageId =
  | "ordered"
  | "waved"
  | "printed"
  | "packed"
  | "handed_over"
  | "delivered"
  | "returned"
  | "credited"
  | "cancelled";

export interface OrderStage {
  id: OrderStageId;
  label: string;
  at: string | null;
  /** Shown in red: something went wrong at this step (cancelled, failed label, return). */
  alert?: boolean;
  detail?: string | null;
}

export interface TimelineInput {
  status: string;
  state?: OrderState | null;
  cancelRequested: boolean;
  platformCreatedAt: Date;
  platformUpdatedAt: Date;
  shippedAt: Date | null;
  wavedAt: Date | null;
  printedAt: Date | null;
  labelFailed: string | null;
  packedAt: Date | null;
  packedBy: string | null;
  creditedAt: Date | null;
  creditedPhp: number | null;
  returnedAt: Date | null;
  returnLabel: string | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function resolveOrderState(status: string, state?: OrderState | null): OrderState {
  return state ?? normalizeOrderState(Platform.SHOPEE, status);
}

/**
 * One row per step. "Delivered" is inferred from the order status (shops
 * don't give a delivery time on the order), so it carries the last update time.
 * A returned order replaces "Delivered" with "Returned".
 */
export function buildOrderTimeline(o: TimelineInput): OrderStage[] {
  const st = resolveOrderState(o.status, o.state);
  const statusCancelled = isCancelledOrderState(st);
  const cancelled = statusCancelled || o.cancelRequested;
  const stages: OrderStage[] = [
    { id: "ordered", label: "Ordered", at: iso(o.platformCreatedAt) },
    { id: "waved", label: "Put in a wave", at: iso(o.wavedAt) },
    {
      id: "printed",
      label: "Label printed",
      at: iso(o.printedAt),
      alert: Boolean(o.labelFailed) && !o.printedAt,
      detail: !o.printedAt && o.labelFailed ? o.labelFailed : null,
    },
    { id: "packed", label: "Packed", at: iso(o.packedAt), detail: o.packedBy ? `by ${o.packedBy}` : null },
    { id: "handed_over", label: "Handed to courier", at: iso(o.shippedAt) },
  ];
  if (o.returnedAt || o.returnLabel) {
    stages.push({ id: "returned", label: o.returnLabel ?? "Returned", at: iso(o.returnedAt), alert: true });
  } else {
    stages.push({
      id: "delivered",
      label: "Delivered",
      at: isDeliveredOrderState(st) ? iso(o.platformUpdatedAt) : null,
    });
  }
  stages.push({
    id: "credited",
    label: "Money credited",
    at: iso(o.creditedAt),
    detail: o.creditedPhp !== null ? `₱${o.creditedPhp.toFixed(2)}` : null,
  });
  if (cancelled) {
    stages.splice(1, 0, {
      id: "cancelled",
      label: o.cancelRequested && !statusCancelled ? "Buyer asked to cancel" : "Cancelled",
      at: iso(o.platformUpdatedAt),
      alert: true,
    });
  }
  return stages;
}

/** Status in a few words for the result row. */
export function orderHeadline(stages: OrderStage[], status: string, state?: OrderState | null): string {
  if (isCancelledOrderState(resolveOrderState(status, state))) return "Cancelled";
  const ret = stages.find((s) => s.id === "returned");
  if (ret) return ret.label;
  const done = stages.filter((s) => s.at && !s.alert);
  return done.length ? done[done.length - 1].label : "Ordered";
}

export interface OrderLookupResult {
  id: string;
  platform: Platform;
  orderSn: string;
  status: string;
  headline: string;
  totalPhp: number;
  isCod: boolean;
  shopName: string;
  courier: string | null;
  trackingNumbers: string[];
  lines: Array<{ name: string; variationName: string | null; quantity: number; imageUrl: string | null }>;
  stages: OrderStage[];
  returnParcelIds: string[];
  canReprint: boolean;
}

export interface ReturnOnlyResult {
  id: string;
  platform: Platform;
  orderSn: string;
  itemSummary: string;
  variationName: string | null;
  courier: string;
  category: string;
  trackingNumber: string | null;
}

export const MIN_QUERY_LENGTH = 3;

export async function lookupOrders(
  rawQuery: string,
  opts: { courier?: string | null; limit?: number } = {}
): Promise<{ orders: OrderLookupResult[]; returnsOnly: ReturnOnlyResult[] }> {
  const q = rawQuery.trim();
  const limit = Math.min(30, Math.max(1, opts.limit ?? 15));
  const realShop = await hasRealConnectedShop();
  const shopFilter = realShop ? { shopConnection: { isDemo: false } } : {};
  const courier = opts.courier?.trim() || null;

  const where: Prisma.OrderWhereInput = {
    ...shopFilter,
    AND: [
      {
        OR: [
          { orderSn: { contains: q, mode: "insensitive" } },
          { packages: { some: { trackingNumber: { contains: q, mode: "insensitive" } } } },
          { lines: { some: { name: { contains: q, mode: "insensitive" } } } },
          { lines: { some: { variationName: { contains: q, mode: "insensitive" } } } },
        ],
      },
      ...(courier ? [{ packages: { some: { carrier: { contains: courier, mode: "insensitive" as const } } } }] : []),
    ],
  };

  const orders = await prisma.order.findMany({
    where,
    orderBy: { platformCreatedAt: "desc" },
    take: limit,
    include: {
      shopConnection: { select: { shopName: true } },
      lines: { select: { name: true, variationName: true, quantity: true, imageUrl: true } },
      packages: {
        select: {
          id: true,
          trackingNumber: true,
          carrier: true,
          packedAt: true,
          packedByStaff: { select: { name: true } },
          waveItems: {
            orderBy: { updatedAt: "desc" },
            select: {
              status: true,
              error: true,
              updatedAt: true,
              wave: { select: { startedAt: true, createdAt: true, status: true } },
            },
          },
        },
      },
    },
  });

  const orderSns = orders.map((o) => o.orderSn);
  const packageIds = orders.flatMap((o) => o.packages.map((p) => p.id));

  const [printJobs, credits, returns, returnsOnlyRaw] = await Promise.all([
    packageIds.length
      ? prisma.printJob.findMany({
          where: {
            kind: PrintJobKind.LABEL,
            status: PrintJobStatus.PRINTED,
            OR: [{ packageId: { in: packageIds } }, { batchPackageIds: { hasSome: packageIds } }],
          },
          select: { packageId: true, batchPackageIds: true, printedAt: true },
          orderBy: { printedAt: "asc" },
        })
      : Promise.resolve([]),
    orderSns.length
      ? prisma.walletTransaction.findMany({
          where: { orderSn: { in: orderSns }, kind: MoneyKind.CREDIT },
          select: { orderSn: true, platform: true, amountPhp: true, occurredAt: true },
        })
      : Promise.resolve([]),
    orderSns.length
      ? prisma.returnParcel.findMany({
          where: { orderSn: { in: orderSns } },
          select: {
            id: true,
            platform: true,
            orderSn: true,
            category: true,
            digitalReturnTaggedAt: true,
            courierReturnedToSellerAt: true,
            physicallyReceivedAt: true,
          },
        })
      : Promise.resolve([]),
    prisma.returnParcel.findMany({
      where: {
        ...shopFilter,
        orderSn: { notIn: orderSns },
        OR: [
          { orderSn: { contains: q, mode: "insensitive" } },
          { returnSn: { contains: q, mode: "insensitive" } },
          { forwardTrackingNumber: { contains: q, mode: "insensitive" } },
          { rtsTrackingNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        platform: true,
        orderSn: true,
        itemSummary: true,
        variationName: true,
        courier: true,
        category: true,
        forwardTrackingNumber: true,
        rtsTrackingNumber: true,
      },
    }),
  ]);

  const printedAtByPackage = new Map<string, Date>();
  for (const j of printJobs) {
    if (!j.printedAt) continue;
    for (const id of j.packageId ? [j.packageId, ...j.batchPackageIds] : j.batchPackageIds) {
      if (!printedAtByPackage.has(id)) printedAtByPackage.set(id, j.printedAt);
    }
  }

  const results: OrderLookupResult[] = orders.map((o) => {
    const pkgs = o.packages;
    const earliest = (ds: Array<Date | null | undefined>) =>
      ds.filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const items = pkgs.flatMap((p) => p.waveItems);
    const wavedAt = earliest(items.map((i) => i.wave.startedAt ?? (i.wave.status === "PREVIEW" ? null : i.wave.createdAt)));
    const printedAt = earliest([
      ...pkgs.map((p) => printedAtByPackage.get(p.id)),
      ...items.filter((i) => i.status === "PRINTED").map((i) => i.updatedAt),
    ]);
    const failed = items.find((i) => i.status === "FAILED")?.error ?? null;
    const packed = pkgs.find((p) => p.packedAt);
    const credit = credits.filter((c) => c.orderSn === o.orderSn && c.platform === o.platform);
    const ret = returns.filter((r) => r.orderSn === o.orderSn && r.platform === o.platform);
    const firstRet = ret[0];
    const returnLabel = firstRet
      ? firstRet.physicallyReceivedAt
        ? "Return arrived"
        : firstRet.courierReturnedToSellerAt
          ? "Returned to seller"
          : firstRet.category === "FAILED_DELIVERY"
            ? "Failed delivery"
            : "Buyer return requested"
      : null;
    const stages = buildOrderTimeline({
      status: o.status,
      state: o.state,
      cancelRequested: o.cancelRequested,
      platformCreatedAt: o.platformCreatedAt,
      platformUpdatedAt: o.platformUpdatedAt,
      shippedAt: o.shippedAt,
      wavedAt,
      printedAt,
      labelFailed: failed,
      packedAt: packed?.packedAt ?? null,
      packedBy: packed?.packedByStaff?.name ?? null,
      creditedAt: earliest(credit.map((c) => c.occurredAt)),
      creditedPhp: credit.length ? credit.reduce((n, c) => n + Number(c.amountPhp), 0) : null,
      returnedAt: firstRet
        ? (firstRet.physicallyReceivedAt ?? firstRet.courierReturnedToSellerAt ?? firstRet.digitalReturnTaggedAt)
        : null,
      returnLabel,
    });
    const trackingNumbers = pkgs.map((p) => p.trackingNumber).filter((t): t is string => Boolean(t));
    return {
      id: o.id,
      platform: o.platform,
      orderSn: o.orderSn,
      status: o.status,
      headline: orderHeadline(stages, o.status, o.state),
      totalPhp: Number(o.totalPhp),
      isCod: o.isCod,
      shopName: o.shopConnection.shopName,
      courier: pkgs[0]?.carrier ? normalizeCourierName(pkgs[0].carrier) : null,
      trackingNumbers,
      lines: o.lines,
      stages,
      returnParcelIds: ret.map((r) => r.id),
      // Only labels that exist can be reprinted, and never for a cancelled order.
      canReprint: trackingNumbers.length > 0 && !isCancelledOrderState(resolveOrderState(o.status, o.state)) && !o.cancelRequested,
    };
  });

  return {
    orders: results,
    returnsOnly: returnsOnlyRaw.map((r) => ({
      id: r.id,
      platform: r.platform,
      orderSn: r.orderSn,
      itemSummary: r.itemSummary,
      variationName: r.variationName,
      courier: r.courier,
      category: r.category,
      trackingNumber: r.rtsTrackingNumber || r.forwardTrackingNumber,
    })),
  };
}
