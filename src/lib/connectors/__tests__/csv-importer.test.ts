import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { parseMarketplaceSpreadsheet } from "@/lib/connectors/csv-importer";

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
});
