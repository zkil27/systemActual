import { PhysicalCondition, Platform, ReturnCategory } from "@prisma/client";
import { formatManilaDateTime } from "@/lib/time";

export interface DisputeParcelContext {
  platform: Platform;
  orderSn: string;
  returnSn: string | null;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: ReturnCategory;
  returnReason: string | null;
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  digitalReturnTaggedAt: Date | null;
  courierReturnedToSellerAt: Date | null;
  physicallyReceivedAt: Date | null;
  physicalCondition: PhysicalCondition | null;
  staffNotes?: string | null;
  photoCount?: number;
}

export function buildDisputeAppealDraft(parcel: DisputeParcelContext): string {
  const platformName = parcel.platform === Platform.SHOPEE ? "Shopee" : "TikTok Shop";
  const tracking =
    parcel.rtsTrackingNumber || parcel.forwardTrackingNumber || "N/A";
  const itemDesc = `${parcel.quantity}x ${parcel.itemSummary}${
    parcel.variationName ? ` (${parcel.variationName})` : ""
  }`;

  const isMissingDiscrepancy = Boolean(
    parcel.courierReturnedToSellerAt && !parcel.physicallyReceivedAt
  );

  if (isMissingDiscrepancy) {
    return [
      `Subject: Missing Returned Parcel Claim — Order ${parcel.orderSn}`,
      ``,
      `Hello ${platformName} Support Team,`,
      ``,
      `We are raising a claim for a returned parcel that ${parcel.courier} marked as "Returned to Seller" on ${formatManilaDateTime(
        parcel.courierReturnedToSellerAt
      )} (Manila Time), but has NOT been physically received at our warehouse.`,
      ``,
      `Order Details:`,
      `- Order ID: ${parcel.orderSn}`,
      parcel.returnSn ? `- Return ID: ${parcel.returnSn}` : null,
      `- Tracking Number: ${tracking}`,
      `- Courier: ${parcel.courier}`,
      `- Item: ${itemDesc}`,
      `- Type: ${
        parcel.category === ReturnCategory.FAILED_DELIVERY
          ? "Failed Delivery (RTS)"
          : "Buyer Return / Refund"
      }`,
      ``,
      `Our receiving team scans every returned parcel upon rider handover, and this waybill is confirmed missing from today's received batch. Please provide signed Proof of Delivery (POD) from ${parcel.courier} or process seller compensation for the lost item.`,
      ``,
      `Thank you,`,
      `Kyna Clothing Shop`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const issueLabel =
    parcel.physicalCondition === PhysicalCondition.WRONG_OR_SWAPPED_ITEM
      ? "a WRONG / SWAPPED item (not the garment we shipped)"
      : parcel.physicalCondition === PhysicalCondition.MISSING_PIECE
      ? "INCOMPLETE / MISSING piece(s)"
      : parcel.physicalCondition === PhysicalCondition.DAMAGED_ITEM
      ? "a DAMAGED / unsellable item"
      : "a return discrepancy";

  return [
    `Subject: Seller Dispute Appeal — Order ${parcel.orderSn}`,
    ``,
    `Hello ${platformName} Dispute Team,`,
    ``,
    `We are disputing this return for Order ${parcel.orderSn}. Upon physical inspection at our warehouse on ${formatManilaDateTime(
      parcel.physicallyReceivedAt
    )} (Manila Time), our staff received ${issueLabel}.`,
    ``,
    `Order & Inspection Summary:`,
    `- Order ID: ${parcel.orderSn}`,
    parcel.returnSn ? `- Return ID: ${parcel.returnSn}` : null,
    `- Tracking Number: ${tracking}`,
    `- Courier: ${parcel.courier}`,
    `- Expected Item Shipped: ${itemDesc}`,
    parcel.returnReason ? `- Buyer/Platform Reason: ${parcel.returnReason}` : null,
    parcel.staffNotes ? `- Warehouse Inspection Note: ${parcel.staffNotes}` : null,
    parcel.photoCount && parcel.photoCount > 0
      ? `- Evidence Attached: ${parcel.photoCount} warehouse inspection photo(s) uploaded.`
      : `- Evidence: Warehouse inspection photos available upon request.`,
    ``,
    `We kindly request ${platformName} to review the attached inspection photos and approve seller reimbursement / reject the invalid return.`,
    ``,
    `Thank you,`,
    `Kyna Clothing Shop`,
  ]
    .filter(Boolean)
    .join("\n");
}
