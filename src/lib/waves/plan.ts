import { Platform } from "@prisma/client";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { formatManilaDateTime } from "@/lib/time";
import {
  groupPickItems,
  matchParcelsForVariant,
  parsePickItemLabel,
  shortenGarmentName,
  type ParsedPickItem,
  type PickGarmentGroup,
  type PickVariantItem,
  type WaveParcel,
  type WaveParcelLine,
} from "./pick-list";

export {
  groupPickItems,
  matchParcelsForVariant,
  parsePickItemLabel,
  shortenGarmentName,
  type ParsedPickItem,
  type PickGarmentGroup,
  type PickVariantItem,
  type WaveParcel,
  type WaveParcelLine,
};

/** Shopee recommends waiting this long: buyers can cancel freely in the first hour. */
export const MIN_ORDER_AGE_MS = 60 * 60_000;
/** Biggest wave in one go (peak day is ~2,000 parcels). */
export const MAX_WAVE_SIZE = 2500;

/** Orders waiting for the seller to arrange shipment. PROCESSED / AWAITING_COLLECTION are already arranged. */
export const READY_ORDER_STATUSES: Record<Platform, string[]> = {
  [Platform.SHOPEE]: ["READY_TO_SHIP", "RETRY_SHIP"],
  [Platform.TIKTOK]: ["AWAITING_SHIPMENT"],
};

/** Package statuses that still need shipment arranged. null = not reported yet. Confirm with live data. */
const READY_PACKAGE_STATUSES: Record<Platform, Set<string>> = {
  [Platform.SHOPEE]: new Set(["LOGISTICS_READY", "LOGISTICS_PICKUP_RETRY", "LOGISTICS_NOT_START"]),
  [Platform.TIKTOK]: new Set(["TO_FULFILL"]),
};

export type SkipReason = "tooNew" | "cancelled" | "notReady" | "split" | "alreadyInWave";

/** Why a package can't go in this wave, or null if it can. */
export function shipBlocker(
  order: { platform: Platform; status: string; cancelRequested: boolean; platformCreatedAt: Date; packageCount: number },
  pkg: { status: string | null; trackingNumber: string | null; inActiveWave: boolean },
  now: Date,
  opts?: { includeNewOrders?: boolean }
): SkipReason | null {
  if (order.cancelRequested || order.status === "CANCELLED" || order.status === "IN_CANCEL") return "cancelled";
  if (!READY_ORDER_STATUSES[order.platform].includes(order.status)) return "notReady";
  if (pkg.status && !READY_PACKAGE_STATUSES[order.platform].has(pkg.status.toUpperCase())) return "notReady";
  if (!opts?.includeNewOrders && now.getTime() - order.platformCreatedAt.getTime() < MIN_ORDER_AGE_MS) return "tooNew";
  // We don't know which items are in which package of a split order: pack those by hand.
  if (order.packageCount > 1) return "split";
  if (pkg.inActiveWave) return "alreadyInWave";
  return null;
}

export interface WaveLine {
  /** Garment variant id when linked, otherwise the listing variation. */
  key: string;
  /** "Ribbed Top - Black, M" */
  label: string;
  quantity: number;
}

export interface WaveCandidate {
  packageId: string;
  orderId: string;
  orderSn: string;
  platform: Platform;
  carrier: string | null;
  channelId: string | null;
  createdAt: Date;
  lines: WaveLine[];
}

export interface PlannedItem extends WaveCandidate {
  groupKey: string;
  groupTitle: string;
  pieces: number;
  single: boolean;
  position: number;
}

const PLATFORM_ORDER: Record<Platform, number> = { [Platform.SHOPEE]: 0, [Platform.TIKTOK]: 1 };
const PLATFORM_NAME: Record<Platform, string> = { [Platform.SHOPEE]: "Shopee", [Platform.TIKTOK]: "TikTok" };

/**
 * Label (and packing) order: shop → courier channel (shipped together) →
 * one-piece orders first → by item, so the same garment comes off the printer
 * together → oldest first.
 */
export function planWave(candidates: WaveCandidate[]): PlannedItem[] {
  const enriched = candidates.map((c) => {
    const lines = [...c.lines].sort((a, b) => a.label.localeCompare(b.label));
    const pieces = lines.reduce((n, l) => n + l.quantity, 0);
    const courier = normalizeCourierName(c.carrier);
    return {
      ...c,
      lines,
      pieces,
      single: pieces === 1,
      groupKey: `${c.platform}|${c.channelId ?? courier}`,
      groupTitle: `${PLATFORM_NAME[c.platform]} · ${courier}`,
      signature: lines.map((l) => `${l.label}×${l.quantity}`).join(" + "),
    };
  });
  enriched.sort(
    (a, b) =>
      PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform] ||
      a.groupTitle.localeCompare(b.groupTitle) ||
      a.groupKey.localeCompare(b.groupKey) ||
      Number(b.single) - Number(a.single) ||
      a.signature.localeCompare(b.signature) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.orderSn.localeCompare(b.orderSn)
  );
  return enriched.map(({ signature, ...item }, position) => {
    void signature;
    return { ...item, position };
  });
}

export type WavePieceMode = "all" | "singles" | "multis";

export interface WaveSummary {
  total: number;
  singles: number;
  multis: number;
  groups: Array<{ key: string; title: string; count: number; items: Array<{ label: string; qty: number }> }>;
  skipped: Record<SkipReason | "notRechecked", number>;
  pieceMode?: WavePieceMode;
  includeNewOrders?: boolean;
  checkedKeys?: Record<string, boolean>;
}

/** Pick totals per group, in label order (first appearance). */
export function summarizeWave(items: PlannedItem[], skipped: WaveSummary["skipped"]): WaveSummary {
  const groups: WaveSummary["groups"] = [];
  const byKey = new Map<string, { group: WaveSummary["groups"][number]; qty: Map<string, { label: string; qty: number }> }>();
  for (const it of items) {
    let g = byKey.get(it.groupKey);
    if (!g) {
      g = { group: { key: it.groupKey, title: it.groupTitle, count: 0, items: [] }, qty: new Map() };
      byKey.set(it.groupKey, g);
      groups.push(g.group);
    }
    g.group.count++;
    for (const l of it.lines) {
      const row = g.qty.get(l.key) ?? { label: l.label, qty: 0 };
      row.qty += l.quantity;
      g.qty.set(l.key, row);
    }
  }
  for (const g of byKey.values()) g.group.items = [...g.qty.values()];
  return {
    total: items.length,
    singles: items.filter((i) => i.single).length,
    multis: items.filter((i) => !i.single).length,
    groups,
    skipped,
  };
}

const LINE_CHARS = 44;
const LINES_PER_PAGE = 25;

function fit(s: string, max = LINE_CHARS) {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/** Pick list as 4x6 pages (one array of lines per page). */
export function pickListPages(summary: WaveSummary, createdAt: Date): string[][] {
  const lines = [
    `PICK LIST  ${formatManilaDateTime(createdAt)}`,
    `${summary.total} parcels: ${summary.singles} single, ${summary.multis} multi`,
    "",
  ];
  summary.groups.forEach((g, idx) => {
    if (idx > 0) lines.push("--------------------------------------------");
    lines.push(fit(`${g.title.toUpperCase()} (${g.count} parcels)`));
    for (const it of g.items) {
      const prefix = `${String(it.qty).padStart(3)} x `;
      const rawLine = `${prefix}${it.label}`;
      if (rawLine.length <= LINE_CHARS) {
        lines.push(rawLine);
      } else {
        const parsed = parsePickItemLabel(it.label);
        const compact = parsed.variation ? `${parsed.shortGarmentName} - ${parsed.variation}` : parsed.shortGarmentName;
        lines.push(fit(`${prefix}${compact}`));
      }
    }
    lines.push("");
  });
  const body = LINES_PER_PAGE - 1;
  const count = Math.max(1, Math.ceil(lines.length / body));
  return Array.from({ length: count }, (_, i) => [
    `Page ${i + 1}/${count}`,
    ...lines.slice(i * body, (i + 1) * body),
  ]);
}
