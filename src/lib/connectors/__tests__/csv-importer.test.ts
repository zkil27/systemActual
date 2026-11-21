import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { detectAndParseSpreadsheet, parseMarketplaceSpreadsheet } from "@/lib/connectors/csv-importer";

describe("Shopee / TikTok spreadsheet importer", () => {
  it("parses mixed Failed Delivery and Buyer Return rows cleanly", () => {
    const sampleRows = [
      {
        "Order SN": "261120SP001",
        "Tracking Number": "SPXPH111222",
        "Shipping Option": "SPX Express",
        "Order Status": "Returned to Seller",
        "Return Reason": "Buyer refused COD",
        "Product Name": "Korean Pleated Tennis Skirt",
        "Variation Name": "Black - M",
        Quantity: 2,
        "Order Total": 398,
        "Failed Delivery Time": "2026-11-20 13:15:00",
      },
      {
        "Order ID": "579410TT002",
        Platform: "TikTok Shop",
        "Return ID": "RET-TT-99",
        "Return Tracking Number": "JT999888",
        Courier: "J&T Express",
        "Return Status": "Return Requested",
        "Buyer Reason": "Wrong size ordered",
        "Product Name": "Ribbed Cotton Baby Tee",
        Variation: "Rose - Free Size",
        Qty: 1,
        "Refund Amount": 199,
        "Return Created Time": "2026-11-20 10:30:00",
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, "Returns");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { rows, skipped } = parseMarketplaceSpreadsheet(buf, Platform.SHOPEE);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(2);

    expect(rows[0].platform).toBe(Platform.SHOPEE);
    expect(rows[0].category).toBe(ReturnCategory.FAILED_DELIVERY);
    expect(rows[0].digitalStatus).toBe(DigitalStatus.COURIER_RETURNED);
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].courierReturnedToSellerAt).not.toBeNull();

    expect(rows[1].platform).toBe(Platform.TIKTOK);
    expect(rows[1].category).toBe(ReturnCategory.RETURN_REFUND);
    expect(rows[1].returnSn).toBe("RET-TT-99");
    expect(rows[1].rtsTrackingNumber).toBe("JT999888");
  });

  it("auto-detects Orders and Product Stock spreadsheets", () => {
    const orderSheet = XLSX.utils.json_to_sheet([
      {
        "Order ID": "261121ORD1",
        "Order Status": "To Ship",
        "Shipping Option": "J&T Express",
        "Tracking Number": "JT12345",
        "Product Name": "Ribbed Top",
        "Variation Name": "Black, M",
        Quantity: 2,
        "Order Total": 398,
      },
    ]);
    const orderWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(orderWb, orderSheet, "Orders");
    const orderRes = detectAndParseSpreadsheet(
      XLSX.write(orderWb, { type: "buffer", bookType: "xlsx" }) as Buffer,
      Platform.SHOPEE
    );
    expect(orderRes.kind).toBe("orders");
    if (orderRes.kind === "orders") {
      expect(orderRes.orders).toHaveLength(1);
      expect(orderRes.orders[0].order.status).toBe("READY_TO_SHIP");
      expect(orderRes.orders[0].order.lines[0].quantity).toBe(2);
    }

    const stockSheet = XLSX.utils.json_to_sheet([
      {
        "Product ID": "P999",
        "Variation ID": "V1",
        "Product Name": "Pleated Skirt",
        Variation: "White, S",
        Stock: 35,
      },
    ]);
    const stockWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(stockWb, stockSheet, "Stock");
    const stockRes = detectAndParseSpreadsheet(
      XLSX.write(stockWb, { type: "buffer", bookType: "xlsx" }) as Buffer,
      Platform.TIKTOK
    );
    expect(stockRes.kind).toBe("stock");
    if (stockRes.kind === "stock") {
      expect(stockRes.items).toEqual([
        {
          platform: Platform.TIKTOK,
          listingId: "P999",
          variationId: "V1",
          name: "Pleated Skirt",
          variationName: "White, S",
          availableStock: 35,
        },
      ]);
    }
  });
});
