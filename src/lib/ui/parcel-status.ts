/**
 * One status per parcel, shared by Home, Returns and the parcel sheet so
 * every screen uses the same words and colours.
 * Priority: Missing > Issue > Arrived > Overdue > On the way.
 */
export type StatusTone = "missing" | "issue" | "arrived" | "overdue" | "neutral";

export interface ParcelStatus {
  label: string;
  tone: StatusTone;
}

export const ISSUE_CONDITIONS = new Set([
  "DAMAGED_ITEM",
  "WRONG_OR_SWAPPED_ITEM",
  "MISSING_PIECE",
]);

export interface ParcelStatusInput {
  isMissingDiscrepancy: boolean;
  physicalCondition: string | null;
  physicallyReceivedAt: string | null;
  courierReturnedToSellerAt?: string | null;
  isOverdueRts?: boolean;
  /** False for refund-only returns: nothing is coming back. */
  expectsPhysicalReturn?: boolean;
  digitalStatus?: string;
}

export function getParcelStatus(p: ParcelStatusInput): ParcelStatus {
  if (p.isMissingDiscrepancy) return { label: "Missing", tone: "missing" };
  if (p.physicalCondition && ISSUE_CONDITIONS.has(p.physicalCondition)) {
    return { label: "Issue", tone: "issue" };
  }
  if (p.physicallyReceivedAt) return { label: "Arrived", tone: "arrived" };
  if (p.digitalStatus === "CANCELLED_RETURN") return { label: "Cancelled", tone: "neutral" };
  if (p.expectsPhysicalReturn === false) return { label: "Refund only", tone: "neutral" };
  if (p.courierReturnedToSellerAt) return { label: "Returned to seller", tone: "neutral" };
  if (p.isOverdueRts) return { label: "Overdue", tone: "overdue" };
  return { label: "On the way", tone: "neutral" };
}

export function categoryLabel(category: string): string {
  return category === "FAILED_DELIVERY" ? "Failed delivery" : "Buyer return";
}
