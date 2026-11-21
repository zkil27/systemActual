import * as XLSX from "xlsx";
import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { classifyReturnCategory, normalizeCourierName } from "./normalizer";
import type { NormalizedOrder } from "@/lib/ledger/normalize";

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

function parseReturnsFromRawRows(
  rawRows: Record<string, unknown>[],
  defaultPlatform: Platform = Platform.SHOPEE
): { rows: ParsedImportRow[]; skipped: number } {
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

export function parseMarketplaceSpreadsheet(
  buffer: Buffer,
  defaultPlatform: Platform = Platform.SHOPEE
): { rows: ParsedImportRow[]; skipped: number } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], skipped: 0 };
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return parseReturnsFromRawRows(rawRows, defaultPlatform);
}

export interface ParsedStockImportRow {
  platform: Platform;
  listingId: string;
  variationId: string;
  name: string;
  variationName: string | null;
  availableStock: number;
}

export interface ParsedOrderImportResult {
  platform: Platform;
  order: NormalizedOrder;
}

export type DetectedSpreadsheet =
  | { kind: "returns"; rows: ParsedImportRow[]; skipped: number }
  | { kind: "orders"; orders: ParsedOrderImportResult[]; skipped: number }
  | { kind: "stock"; items: ParsedStockImportRow[]; skipped: number };

const ORDER_STATUS_MAP: Record<string, string> = {
  "TO PAY": "UNPAID",
  UNPAID: "UNPAID",
  "TO SHIP": "READY_TO_SHIP",
  READY_TO_SHIP: "READY_TO_SHIP",
  AWAITING_SHIPMENT: "AWAITING_SHIPMENT",
  PROCESSED: "PROCESSED",
  AWAITING_COLLECTION: "AWAITING_COLLECTION",
  SHIPPING: "SHIPPED",
  SHIPPED: "SHIPPED",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
};

function mapImportedOrderStatus(raw: string, platform: Platform): string {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (platform === Platform.TIKTOK && (upper === "TO SHIP" || upper === "READY_TO_SHIP")) {
    return "AWAITING_SHIPMENT";
  }
  return ORDER_STATUS_MAP[upper] ?? (upper.replace(/\s+/g, "_") || (platform === Platform.TIKTOK ? "AWAITING_SHIPMENT" : "READY_TO_SHIP"));
}

/**
 * Auto-detects whether an uploaded Shopee/TikTok CSV or XLSX is a Returns
 * export, an Orders export, or a Products/Stock export.
 */
export function detectAndParseSpreadsheet(
  buffer: Buffer,
  defaultPlatform: Platform = Platform.SHOPEE
): DetectedSpreadsheet {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { kind: "returns", rows: [], skipped: 0 };
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (!rawRows.length) return { kind: "returns", rows: [], skipped: 0 };

  const headers = Object.keys(rawRows[0]).map((h) => h.trim().toLowerCase());
  const hasOrderCol = headers.some((h) =>
    ["order id", "order sn", "order_sn", "order_id", "platform order no"].includes(h)
  );
  const hasReturnCol = headers.some((h) =>
    [
      "return id",
      "return sn",
      "reverse order id",
      "return_sn",
      "return_id",
      "return status",
      "return reason",
      "failed delivery time",
      "returned to seller time",
      "return created time",
      "return tracking number",
    ].includes(h)
  );
  const hasStockCol = headers.some((h) => ["stock", "available stock", "inventory", "quantity", "qty"].includes(h));
  const hasProductCol = headers.some((h) =>
    ["product id", "item id", "product_id", "item_id", "product name", "item name"].includes(h)
  );

  // 1. Product / Stock export (no Order ID column)
  if (!hasOrderCol && hasProductCol && hasStockCol) {
    const items: ParsedStockImportRow[] = [];
    let skipped = 0;
    for (const raw of rawRows) {
      const name = pickColumn(raw, ["Product Name", "Item Name", "Product", "Item"]);
      const listingId = pickColumn(raw, ["Product ID", "Item ID", "product_id", "item_id"]) || name;
      if (!listingId || !name) {
        skipped++;
        continue;
      }
      const platformHint = pickColumn(raw, ["Platform", "Channel", "Store", "Marketplace"]).toLowerCase();
      const platform = platformHint.includes("tiktok")
        ? Platform.TIKTOK
        : platformHint.includes("shopee")
          ? Platform.SHOPEE
          : defaultPlatform;
      const variationId = pickColumn(raw, ["Variation ID", "Model ID", "SKU ID", "sku_id", "model_id"]) || "0";
      const variationName =
        pickColumn(raw, ["Variation Name", "Variation", "Model Name", "SKU Name", "Color/Size"]) || null;
      const stockRaw = Number(pickColumn(raw, ["Available Stock", "Stock", "Inventory", "Quantity", "Qty"]) || 0);
      items.push({
        platform,
        listingId,
        variationId,
        name,
        variationName,
        availableStock: Number.isFinite(stockRaw) && stockRaw >= 0 ? Math.round(stockRaw) : 0,
      });
    }
    return { kind: "stock", items, skipped };
  }

  // 2. Order export (has Order ID, no return columns, and statuses are order statuses)
  if (hasOrderCol && !hasReturnCol) {
    const sampleStatuses = rawRows
      .slice(0, 10)
      .map((r) => pickColumn(r, ["Order Status", "Status"]).toLowerCase());
    const looksLikeReturns = sampleStatuses.some(
      (s) => s.includes("return") || s.includes("refund") || s.includes("failed") || s.includes("rts")
    );
    if (!looksLikeReturns) {
      const grouped = new Map<string, { platform: Platform; rows: Record<string, unknown>[] }>();
      let skipped = 0;
      for (const raw of rawRows) {
        const orderSn = pickColumn(raw, ["Order ID", "Order SN", "order_sn", "order_id", "Platform Order No"]);
        if (!orderSn) {
          skipped++;
          continue;
        }
        const platformHint = pickColumn(raw, ["Platform", "Channel", "Store", "Marketplace"]).toLowerCase();
        const platform = platformHint.includes("tiktok")
          ? Platform.TIKTOK
          : platformHint.includes("shopee")
            ? Platform.SHOPEE
            : defaultPlatform;
        const key = `${platform}:${orderSn}`;
        const entry = grouped.get(key) ?? { platform, rows: [] };
        entry.rows.push(raw);
        grouped.set(key, entry);
      }

      const orders: ParsedOrderImportResult[] = [];
      for (const [key, { platform, rows }] of grouped) {
        const orderSn = key.split(":")[1];
        const first = rows[0];
        const rawStatus = pickColumn(first, ["Order Status", "Status"]) || "READY_TO_SHIP";
        const status = mapImportedOrderStatus(rawStatus, platform);
        const createdAt =
          parseFlexibleDate(pickColumn(first, ["Order Creation Date", "Created Time", "Create Time", "Order Time"])) ??
          new Date();
        const updatedAt =
          parseFlexibleDate(pickColumn(first, ["Update Time", "Order Complete Time", "Ship Time"])) ?? createdAt;
        const trackingNumber = pickColumn(first, ["Tracking Number", "Tracking No", "Waybill"]) || null;
        const carrier = normalizeCourierName(
          pickColumn(first, ["Shipping Option", "Courier", "Logistics", "Shipping Provider", "Carrier"])
        );
        const packageNumber = pickColumn(first, ["Package ID", "Package Number"]) || orderSn;
        const payment = pickColumn(first, ["Payment Method", "Payment"]).toLowerCase();
        const isCod = payment.includes("cod") || payment.includes("cash on delivery");
        const totalNum = Number(
          pickColumn(first, ["Order Total", "Total Amount", "Grand Total", "Amount"]).replace(/[^\d.-]/g, "") || 0
        );

        const lines = rows.map((r, idx) => {
          const name = pickColumn(r, ["Product Name", "Item Name", "Product", "Item"]) || "Fashion Item";
          const variationName = pickColumn(r, ["Variation Name", "Variation", "Model Name", "SKU Name"]) || null;
          const listingId = pickColumn(r, ["Product ID", "Item ID", "product_id", "item_id"]) || name;
          const variationId =
            pickColumn(r, ["Variation ID", "Model ID", "SKU ID", "sku_id", "model_id"]) ||
            variationName ||
            String(idx);
          const qty = Math.max(1, Math.round(Number(pickColumn(r, ["Quantity", "Qty", "Pieces"]) || 1) || 1));
          const price = Number(
            pickColumn(r, ["Deal Price", "Unit Price", "Price", "Order Total"]).replace(/[^\d.-]/g, "") || 199
          );
          return {
            listingId,
            variationId,
            name,
            variationName,
            imageUrl: null,
            quantity: qty,
            unitPricePhp: Number.isFinite(price) && price > 0 ? price : 199,
          };
        });

        orders.push({
          platform,
          order: {
            orderSn,
            status,
            isCod,
            totalPhp:
              Number.isFinite(totalNum) && totalNum > 0
                ? totalNum
                : lines.reduce((s, l) => s + l.unitPricePhp * l.quantity, 0),
            createdAt,
            updatedAt,
            shippedAt: status === "SHIPPED" || status === "IN_TRANSIT" || status === "COMPLETED" ? updatedAt : null,
            cancelBy: null,
            cancelReason: null,
            cancelRequested: status === "IN_CANCEL" || status === "CANCELLED",
            lines,
            packages: [
              {
                packageNumber,
                trackingNumber,
                carrier,
                channelId: null,
                status: null,
              },
            ],
          },
        });
      }
      return { kind: "orders", orders, skipped };
    }
  }

  const res = parseReturnsFromRawRows(rawRows, defaultPlatform);
  return { kind: "returns", ...res };
}
