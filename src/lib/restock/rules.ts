import { getManilaDateString } from "@/lib/time";

export type PurchaseOrderStatusValue =
  | "DRAFT"
  | "ORDERED"
  | "PARTIAL"
  | "RECEIVED"
  | "CANCELLED";

export interface PoLineQtySnapshot {
  orderedQty: number;
  receivedQty: number;
  damagedQty: number;
}

/**
 * Computes the next PurchaseOrderStatus from its current status and lines.
 * Once any line has received or damaged pieces recorded, the order transitions
 * to PARTIAL or RECEIVED unless it was already CANCELLED.
 */
export function derivePurchaseOrderStatus(
  currentStatus: PurchaseOrderStatusValue,
  lines: ReadonlyArray<PoLineQtySnapshot>
): PurchaseOrderStatusValue {
  if (currentStatus === "CANCELLED") return "CANCELLED";
  if (lines.length === 0) return currentStatus;

  const anyRecorded = lines.some((l) => l.receivedQty + l.damagedQty > 0);
  if (!anyRecorded) return currentStatus;

  const allFulfilled = lines.every(
    (l) => l.receivedQty + l.damagedQty >= l.orderedQty
  );
  return allFulfilled ? "RECEIVED" : "PARTIAL";
}

export interface PoReceiveDeltaResult {
  nextReceivedQty: number;
  nextDamagedQty: number;
  stockDelta: number;
  remainingAfter: number;
}

/**
 * Applies a good + damaged receive increment to a PO line.
 * Only good pieces (`goodAdd`) increase warehouse shelf stock.
 */
export function applyPoReceive(
  line: PoLineQtySnapshot,
  goodAdd: number,
  damagedAdd: number
): PoReceiveDeltaResult {
  const safeGood = Math.max(0, Math.trunc(goodAdd));
  const safeDamaged = Math.max(0, Math.trunc(damagedAdd));
  const nextReceivedQty = line.receivedQty + safeGood;
  const nextDamagedQty = line.damagedQty + safeDamaged;
  const remainingAfter = Math.max(
    0,
    line.orderedQty - nextReceivedQty - nextDamagedQty
  );
  return {
    nextReceivedQty,
    nextDamagedQty,
    stockDelta: safeGood,
    remainingAfter,
  };
}

/**
 * True when a received PO line carried a unit cost that meaningfully differs
 * from the garment's current unitCostPhp (or when the garment has none yet).
 */
export function needsCostConfirmation(
  poUnitCostPhp: number | null | undefined,
  garmentUnitCostPhp: number | null | undefined
): boolean {
  if (
    poUnitCostPhp === null ||
    poUnitCostPhp === undefined ||
    !Number.isFinite(poUnitCostPhp) ||
    poUnitCostPhp <= 0
  ) {
    return false;
  }
  if (
    garmentUnitCostPhp === null ||
    garmentUnitCostPhp === undefined ||
    !Number.isFinite(garmentUnitCostPhp)
  ) {
    return true;
  }
  return Math.abs(poUnitCostPhp - garmentUnitCostPhp) >= 0.01;
}

/**
 * True when an open supplier order (ORDERED or PARTIAL) is past its expected
 * Manila calendar date.
 */
export function isPurchaseOrderOverdue(
  po: { status: PurchaseOrderStatusValue; expectedAt: Date | null },
  now: Date = new Date()
): boolean {
  if (po.status !== "ORDERED" && po.status !== "PARTIAL") return false;
  if (!po.expectedAt) return false;
  return getManilaDateString(po.expectedAt) < getManilaDateString(now);
}

/**
 * Calendar days overdue in Manila time (0 when not overdue).
 */
export function daysOverdueManila(
  expectedAt: Date | null,
  now: Date = new Date()
): number {
  if (!expectedAt) return 0;
  const exp = getManilaDateString(expectedAt);
  const cur = getManilaDateString(now);
  if (exp >= cur) return 0;
  const [ey, em, ed] = exp.split("-").map(Number);
  const [cy, cm, cd] = cur.split("-").map(Number);
  const expUtc = Date.UTC(ey, em - 1, ed);
  const curUtc = Date.UTC(cy, cm - 1, cd);
  return Math.max(0, Math.round((curUtc - expUtc) / 86_400_000));
}

export interface ReorderInputItem {
  variantId: string;
  garmentId: string;
  garmentName: string;
  variantLabel: string;
  imageUrl: string | null;
  binLocation: string | null;
  onShelfCount: number;
  committed: number;
  safetyBuffer: number;
  lowStockThreshold: number;
  soldLast7Days: number;
  onOrderQty: number;
  unitCostPhp: number | null;
  lastSupplier: {
    id: string;
    name: string;
    leadTimeDays: number;
  } | null;
}

export interface ReorderSuggestion {
  variantId: string;
  garmentId: string;
  garmentName: string;
  variantLabel: string;
  imageUrl: string | null;
  binLocation: string | null;
  onShelfCount: number;
  committed: number;
  available: number;
  onOrderQty: number;
  soldLast7Days: number;
  dailyRate: number;
  daysLeft: number | null;
  leadTimeDays: number;
  suggestedQty: number;
  unitCostPhp: number | null;
  urgency: "out" | "urgent" | "low";
  reason: string;
  lastSupplier: {
    id: string;
    name: string;
    leadTimeDays: number;
  } | null;
}

const URGENCY_RANK: Record<ReorderSuggestion["urgency"], number> = {
  out: 0,
  urgent: 1,
  low: 2,
};

/**
 * Computes lead-time-aware restock suggestions from on-shelf stock, active
 * shop commitments, 7-day sales velocity, and open supplier orders.
 */
export function computeReorderSuggestions(
  items: ReadonlyArray<ReorderInputItem>
): ReorderSuggestion[] {
  const suggestions: ReorderSuggestion[] = [];

  for (const item of items) {
    const available = Math.max(
      0,
      item.onShelfCount - item.committed - item.safetyBuffer
    );
    const leadTimeDays = Math.max(1, item.lastSupplier?.leadTimeDays ?? 7);
    const dailyRate = Number((Math.max(0, item.soldLast7Days) / 7).toFixed(2));
    const leadTimeDemand = Math.ceil(dailyRate * leadTimeDays);
    const netPosition = available + Math.max(0, item.onOrderQty);
    const reorderPoint = Math.max(item.lowStockThreshold, leadTimeDemand);

    if (netPosition > reorderPoint) continue;

    const targetWindowQty = Math.max(
      Math.ceil(dailyRate * (leadTimeDays + 7)),
      Math.max(1, item.lowStockThreshold) * 2
    );
    const suggestedQty = Math.max(1, targetWindowQty - netPosition);

    const daysLeft =
      available === 0
        ? 0
        : dailyRate > 0
          ? Math.floor(available / dailyRate)
          : null;

    const urgency: ReorderSuggestion["urgency"] =
      available === 0
        ? "out"
        : daysLeft !== null && daysLeft <= leadTimeDays
          ? "urgent"
          : "low";

    let reason: string;
    if (available === 0) {
      reason =
        item.onOrderQty > 0
          ? `Out of stock (${item.onOrderQty} on order)`
          : "Out of stock";
    } else if (daysLeft !== null && daysLeft <= leadTimeDays) {
      reason = `~${daysLeft}d left at ${dailyRate.toFixed(1)}/day (${leadTimeDays}d lead)`;
    } else {
      reason = `${available} available (alert at ${item.lowStockThreshold})`;
    }

    suggestions.push({
      variantId: item.variantId,
      garmentId: item.garmentId,
      garmentName: item.garmentName,
      variantLabel: item.variantLabel,
      imageUrl: item.imageUrl,
      binLocation: item.binLocation,
      onShelfCount: item.onShelfCount,
      committed: item.committed,
      available,
      onOrderQty: item.onOrderQty,
      soldLast7Days: item.soldLast7Days,
      dailyRate,
      daysLeft,
      leadTimeDays,
      suggestedQty,
      unitCostPhp: item.unitCostPhp,
      urgency,
      reason,
      lastSupplier: item.lastSupplier,
    });
  }

  suggestions.sort((a, b) => {
    const rankDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (rankDiff !== 0) return rankDiff;
    if (a.daysLeft !== null && b.daysLeft !== null && a.daysLeft !== b.daysLeft) {
      return a.daysLeft - b.daysLeft;
    }
    if (b.soldLast7Days !== a.soldLast7Days) {
      return b.soldLast7Days - a.soldLast7Days;
    }
    return a.garmentName.localeCompare(b.garmentName);
  });

  return suggestions;
}

export interface StaffPurchaseOrderLineView {
  id: string;
  garmentVariantId: string;
  garmentId: string;
  garmentName: string;
  variantLabel: string;
  imageUrl: string | null;
  binLocation: string | null;
  orderedQty: number;
  receivedQty: number;
  damagedQty: number;
  remainingQty: number;
}

export interface StaffPurchaseOrderView {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatusValue;
  expectedAt: string | null;
  supplierName: string;
  note: string | null;
  lines: StaffPurchaseOrderLineView[];
}

export interface OwnerPurchaseOrderForRedaction {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatusValue;
  expectedAt: Date | string | null;
  note?: string | null;
  totalCostPhp?: unknown;
  supplier: {
    id?: string;
    name: string;
    contact?: string | null;
    notes?: string | null;
  };
  lines: Array<{
    id: string;
    garmentVariantId: string;
    orderedQty: number;
    receivedQty: number;
    damagedQty: number;
    unitCostPhp?: unknown;
    costUpdatePending?: boolean;
    note?: string | null;
    garmentVariant: {
      id?: string;
      label: string;
      garment: {
        id: string;
        name: string;
        imageUrl: string | null;
        binLocation: string | null;
        unitCostPhp?: unknown;
      };
    };
  }>;
}

/**
 * Strips all peso costs, pending cost flags, and private supplier details so
 * staff receiving screens and APIs never leak financial data.
 */
export function redactPurchaseOrderForStaff(
  po: OwnerPurchaseOrderForRedaction
): StaffPurchaseOrderView {
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    expectedAt:
      po.expectedAt instanceof Date
        ? po.expectedAt.toISOString()
        : (po.expectedAt ?? null),
    supplierName: po.supplier.name,
    note: po.note ?? null,
    lines: po.lines.map((line) => ({
      id: line.id,
      garmentVariantId: line.garmentVariantId,
      garmentId: line.garmentVariant.garment.id,
      garmentName: line.garmentVariant.garment.name,
      variantLabel: line.garmentVariant.label,
      imageUrl: line.garmentVariant.garment.imageUrl,
      binLocation: line.garmentVariant.garment.binLocation,
      orderedQty: line.orderedQty,
      receivedQty: line.receivedQty,
      damagedQty: line.damagedQty,
      remainingQty: Math.max(
        0,
        line.orderedQty - line.receivedQty - line.damagedQty
      ),
    })),
  };
}
