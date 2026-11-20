import * as XLSX from "xlsx";
import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { classifyReturnCategory, normalizeCourierName } from "./normalizer";

export interface ParsedImportRow {
  platform: Platform;
  orderSn: string;
  returnSn: string | null;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: ReturnCategory;
  digitalStatus: DigitalStatus;
  returnReason: string | null;
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  orderTotalPhp: number;
  digitalReturnTaggedAt: Date;
  courierReturnedToSellerAt: Date | null;
  rawStatus: string;
}

function pickColumn(row: Record<string, unknown>, candidates: string[]): string {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === cand.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== "") {
      return String(row[found]).trim();
    }
  }
  for (const cand of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase().includes(cand.toLowerCase()));
    if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== "") {
      return String(row[found]).trim();
    }
  }
  return "";
}

function parseFlexibleDate(val: string): Date | null {
  if (!val) return null;
  const trimmed = val.trim();
  // Excel serial date
  if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    const utcMs = (serial - 25569) * 86400 * 1000;
    return new Date(utcMs);
  }
  // If string has no timezone, treat as Asia/Manila (+08:00)
  const normalized = trimmed.replace(/\//g, "-").replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(normalized)) {
    const withTime = normalized.includes("T") ? normalized : `${normalized}T10:00:00`;
    const d = new Date(`${withTime}+08:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const direct = new Date(trimmed);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

export function parseMarketplaceSpreadsheet(
  buffer: Buffer,
  defaultPlatform: Platform = Platform.SHOPEE
): { rows: ParsedImportRow[]; skipped: number } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], skipped: 0 };
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const rows: ParsedImportRow[] = [];
  let skipped = 0;

  for (const raw of rawRows) {
    const orderSn = pickColumn(raw, [
      "Order ID",
      "Order SN",
      "order_sn",
      "order_id",
      "Platform Order No",
      "Package ID",
    ]);
    if (!orderSn) {
      skipped++;
      continue;
    }

    const platformHint = pickColumn(raw, ["Platform", "Channel", "Store", "Marketplace"]).toLowerCase();
    const platform: Platform = platformHint.includes("tiktok")
      ? Platform.TIKTOK
      : platformHint.includes("shopee")
      ? Platform.SHOPEE
      : defaultPlatform;

    const returnSn =
      pickColumn(raw, ["Return SN", "Return ID", "Reverse Order ID", "return_sn", "return_id"]) ||
      null;
    const forwardTracking =
      pickColumn(raw, ["Tracking Number", "Tracking No", "Waybill", "Forward Tracking"]) || null;
    const rtsTracking =
      pickColumn(raw, ["Return Tracking Number", "RTS Tracking", "Reverse Tracking"]) || null;
    const courier = normalizeCourierName(
      pickColumn(raw, ["Shipping Option", "Courier", "Logistics", "Shipping Provider", "Carrier"])
    );
    const rawStatus =
      pickColumn(raw, [
        "Return Status",
        "Order Status",
        "Logistics Status",
        "Status",
        "Package Status",
      ]) || "FAILED_DELIVERY_TAGGED";
    const reason =
      pickColumn(raw, [
        "Return Reason",
        "Cancel Reason",
        "Failed Reason",
        "Reason",
        "Buyer Reason",
      ]) || null;

    const categoryHint = pickColumn(raw, ["Return Type", "Category", "Type"]).toLowerCase();
    const category: ReturnCategory = categoryHint.includes("failed")
      ? ReturnCategory.FAILED_DELIVERY
      : categoryHint.includes("refund") || categoryHint.includes("buyer")
      ? ReturnCategory.RETURN_REFUND
      : classifyReturnCategory({
          platform,
          hasBuyerReturnSn: Boolean(returnSn),
          rawStatus,
          reason,
        });

    const upperStatus = rawStatus.toUpperCase();
    const isCourierReturned =
      upperStatus.includes("RETURNED TO SELLER") ||
      upperStatus.includes("RETURNED_TO_SELLER") ||
      upperStatus.includes("DELIVERED BACK") ||
      upperStatus.includes("COURIER_RETURNED") ||
      upperStatus.includes("COMPLETED");

    const digitalStatus: DigitalStatus = isCourierReturned
      ? DigitalStatus.COURIER_RETURNED
      : category === ReturnCategory.RETURN_REFUND
      ? DigitalStatus.RETURN_REQUESTED
      : upperStatus.includes("TRANSIT") || upperStatus.includes("RETURNING")
      ? DigitalStatus.RETURNING_TO_SELLER
      : DigitalStatus.FAILED_DELIVERY_TAGGED;

    const taggedDate =
      parseFlexibleDate(
        pickColumn(raw, [
          "Return Created Time",
          "Failed Delivery Time",
          "RTS Time",
          "Tagged At",
          "Return Time",
          "Update Time",
          "Order Creation Date",
        ])
      ) ?? new Date();

    const courierReturnedDate =
      parseFlexibleDate(
        pickColumn(raw, [
          "Returned To Seller Time",
          "Delivered Back Time",
          "Courier Returned Time",
        ])
      ) ?? (isCourierReturned ? taggedDate : null);

    const itemSummary =
      pickColumn(raw, ["Product Name", "Item Name", "Item", "Product"]) || "Fashion Item";
    const variationName =
      pickColumn(raw, ["Variation Name", "Variation", "Color/Size", "Variant", "Model Name"]) ||
      null;
    const qtyRaw = Number(pickColumn(raw, ["Quantity", "Qty", "Pieces"]) || 1);
    const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;

    const totalRaw = Number(
      pickColumn(raw, ["Order Total", "Refund Amount", "Total Amount", "Price", "Amount"]).replace(
        /[^\d.-]/g,
        ""
      ) || 199 * quantity
    );
    const orderTotalPhp = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 199 * quantity;

    rows.push({
      platform,
      orderSn,
      returnSn,
      forwardTrackingNumber: forwardTracking,
      rtsTrackingNumber: rtsTracking,
      courier,
      category,
      digitalStatus,
      returnReason: reason,
      itemSummary,
      variationName,
      quantity,
      orderTotalPhp,
      digitalReturnTaggedAt: taggedDate,
      courierReturnedToSellerAt: courierReturnedDate,
      rawStatus,
    });
  }

  return { rows, skipped };
}
