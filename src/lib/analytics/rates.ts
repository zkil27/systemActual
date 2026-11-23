import { ReturnCategory } from "@prisma/client";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { prisma } from "@/lib/prisma";

/** Rates use a trailing window so a quiet "Today" doesn't show 100% from one parcel. */
export const RATE_WINDOW_DAYS = 30;
/** Below this many shipped, a rate is noise: show the count only. */
export const MIN_SHIPPED_FOR_RATE = 10;

/** Percent rounded to one decimal, or null when the sample is too small. */
export function ratePct(part: number, whole: number, minWhole = MIN_SHIPPED_FOR_RATE): number | null {
  if (whole < minWhole || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function itemKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface CourierRate {
  courier: string;
  shipped: number;
  failed: number;
  missing: number;
  failRatePct: number | null;
  missingRatePct: number | null;
}

/** Merge per-courier shipped / failed / missing counts (raw courier names) into normalized rows. */
export function buildCourierRates(input: {
  shipped: Array<{ courier: string | null; count: number }>;
  failed: Array<{ courier: string | null; count: number }>;
  missing: Array<{ courier: string | null; count: number }>;
}): CourierRate[] {
  const rows = new Map<string, CourierRate>();
  const row = (raw: string | null) => {
    const courier = normalizeCourierName(raw);
    let r = rows.get(courier);
    if (!r) {
      r = { courier, shipped: 0, failed: 0, missing: 0, failRatePct: null, missingRatePct: null };
      rows.set(courier, r);
    }
    return r;
  };
  for (const s of input.shipped) row(s.courier).shipped += s.count;
  for (const f of input.failed) row(f.courier).failed += f.count;
  for (const m of input.missing) row(m.courier).missing += m.count;
  return [...rows.values()]
    .map((r) => ({ ...r, failRatePct: ratePct(r.failed, r.shipped), missingRatePct: ratePct(r.missing, r.shipped) }))
    .sort((a, b) => b.shipped - a.shipped || b.failed - a.failed);
}

/** Courier failure and missing rates over the trailing window. */
export async function getCourierRates(now: Date = new Date()): Promise<CourierRate[]> {
  const since = new Date(now.getTime() - RATE_WINDOW_DAYS * 24 * 3600_000);
  const [shipped, failed, missing] = await Promise.all([
    prisma.package.groupBy({
      by: ["carrier"],
      where: { order: { shippedAt: { gte: since, lte: now }, shopConnection: { isDemo: false } } },
      _count: { _all: true },
    }),
    prisma.returnParcel.groupBy({
      by: ["courier"],
      where: {
        category: ReturnCategory.FAILED_DELIVERY,
        digitalReturnTaggedAt: { gte: since, lte: now },
        shopConnection: { isDemo: false },
      },
      _count: { _all: true },
    }),
    prisma.returnParcel.groupBy({
      by: ["courier"],
      where: {
        courierReturnedToSellerAt: { gte: since, lte: now },
        physicallyReceivedAt: null,
        resolvedAt: null,
        expectsPhysicalReturn: true,
        digitalStatus: { not: "CANCELLED_RETURN" },
        shopConnection: { isDemo: false },
      },
      _count: { _all: true },
    }),
  ]);
  return buildCourierRates({
    shipped: shipped.map((s) => ({ courier: s.carrier, count: s._count._all })),
    failed: failed.map((f) => ({ courier: f.courier, count: f._count._all })),
    missing: missing.map((m) => ({ courier: m.courier, count: m._count._all })),
  });
}

/**
 * Return rate per item name over the trailing window: returns tagged / pieces
 * shipped. Matched on the listing name, which is what return parcels carry.
 */
export async function getItemReturnRates(
  itemNames: string[],
  now: Date = new Date()
): Promise<Map<string, { shipped: number; returned: number; ratePct: number | null }>> {
  const out = new Map<string, { shipped: number; returned: number; ratePct: number | null }>();
  const names = [...new Set(itemNames.filter(Boolean))];
  if (!names.length) return out;
  const since = new Date(now.getTime() - RATE_WINDOW_DAYS * 24 * 3600_000);
  const [shipped, returned] = await Promise.all([
    prisma.orderLine.groupBy({
      by: ["name"],
      where: { name: { in: names }, order: { shippedAt: { gte: since, lte: now } } },
      _sum: { quantity: true },
    }),
    prisma.returnParcel.groupBy({
      by: ["itemSummary"],
      where: { itemSummary: { in: names }, digitalReturnTaggedAt: { gte: since, lte: now } },
      _sum: { quantity: true },
    }),
  ]);
  const shippedBy = new Map(shipped.map((s) => [itemKey(s.name), s._sum.quantity ?? 0]));
  const returnedBy = new Map(returned.map((r) => [itemKey(r.itemSummary), r._sum.quantity ?? 0]));
  for (const n of names) {
    const k = itemKey(n);
    const s = shippedBy.get(k) ?? 0;
    const r = returnedBy.get(k) ?? 0;
    out.set(k, { shipped: s, returned: r, ratePct: ratePct(r, s) });
  }
  return out;
}
