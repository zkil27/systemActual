import { Platform } from "@prisma/client";

/**
 * "Black,M", "Black, M" and "M / Black" are the same variation. Lowercase,
 * split on anything that isn't a letter or digit, sort the words.
 * Exact equality after this, no fuzzy guessing: the owner still confirms links.
 */
export function normalizeVariationLabel(label: string | null | undefined): string {
  return (label ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export interface LabeledVariant {
  id: string;
  label: string | null;
}

/**
 * Pairs two listings' variations by normalized label. A label that appears
 * more than once on either side is never auto-paired (ambiguous); it's left
 * for the owner to pair by hand.
 */
export function pairVariations(a: LabeledVariant[], b: LabeledVariant[]) {
  const index = (list: LabeledVariant[]) => {
    const map = new Map<string, LabeledVariant[]>();
    for (const v of list) {
      const key = normalizeVariationLabel(v.label);
      map.set(key, [...(map.get(key) ?? []), v]);
    }
    return map;
  };
  const ia = index(a);
  const ib = index(b);
  const pairs: Array<[string, string]> = [];
  const paired = new Set<string>();
  for (const [key, as] of ia) {
    const bs = ib.get(key);
    if (as.length === 1 && bs?.length === 1) {
      pairs.push([as[0].id, bs[0].id]);
      paired.add(as[0].id).add(bs[0].id);
    }
  }
  return {
    pairs,
    leftoverA: a.filter((v) => !paired.has(v.id)),
    leftoverB: b.filter((v) => !paired.has(v.id)),
  };
}

/** Shopee model name from its tier options, e.g. tier_index [0,2] → "Black,M". */
export function shopeeModelLabel(
  tierVariation: Array<{ option_list?: Array<{ option?: string }> }> | undefined,
  tierIndex: number[] | undefined
): string | null {
  if (!tierVariation?.length || !tierIndex?.length) return null;
  const parts = tierIndex.map((idx, tier) => tierVariation[tier]?.option_list?.[idx]?.option).filter(Boolean);
  return parts.length ? parts.join(",") : null;
}

/**
 * Orders whose stock the platform has already taken out of "available" but that
 * are still physically in the warehouse (not yet picked up by the courier).
 */
export const COMMITTED_ORDER_STATUSES: Record<Platform, string[]> = {
  [Platform.SHOPEE]: ["UNPAID", "READY_TO_SHIP", "PROCESSED", "RETRY_SHIP", "IN_CANCEL"],
  [Platform.TIKTOK]: ["UNPAID", "ON_HOLD", "AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION"],
};

export interface StartingStockView {
  /** On-hand estimate seen from each shop: its "available" + units committed to unshipped orders on both shops. */
  byPlatform: Partial<Record<Platform, number>>;
  /** What we'll use unless the owner changes it: the lower estimate. */
  suggested: number | null;
  /** The shops disagree, so the owner should check. */
  conflict: boolean;
}

/**
 * While BigSeller kept the shops in sync, both showed the same "available"
 * number, i.e. on-hand minus everything committed on BOTH shops. So on-hand
 * = available + committed (all shops). If the shops show different available
 * numbers, take the lower one and flag it.
 */
export function computeStartingStock(
  listings: Array<{ platform: Platform; availableStock: number | null }>,
  committedUnits: number
): StartingStockView {
  const byPlatform: Partial<Record<Platform, number>> = {};
  for (const l of listings) {
    if (l.availableStock === null || l.availableStock === undefined) continue;
    const onHand = Math.max(0, l.availableStock) + committedUnits;
    const prev = byPlatform[l.platform];
    byPlatform[l.platform] = prev === undefined ? onHand : Math.min(prev, onHand);
  }
  const values = Object.values(byPlatform) as number[];
  const availables = listings
    .map((l) => l.availableStock)
    .filter((n): n is number => n !== null && n !== undefined);
  return {
    byPlatform,
    suggested: values.length ? Math.min(...values) : null,
    conflict: new Set(availables).size > 1,
  };
}
