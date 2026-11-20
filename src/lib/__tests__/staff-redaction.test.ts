import { describe, expect, it } from "vitest";
import { redactParcelForStaff } from "@/lib/auth";

describe("Warehouse staff financial data redaction", () => {
  it("never exposes orderTotalPhp or estimatedUnitCostPhp to staff scanner endpoints", () => {
    const dbParcel = {
      id: "parcel-1",
      platform: "SHOPEE",
      orderSn: "261120SP001",
      returnSn: null,
      forwardTrackingNumber: "SPXPH123456",
      rtsTrackingNumber: "RTS-SPXPH123456",
      courier: "SPX Express",
      category: "FAILED_DELIVERY",
      digitalStatus: "COURIER_RETURNED",
      returnReason: "Buyer refused COD",
      itemSummary: "Korean Pleated Tennis Skirt",
      variationName: "Black • Medium",
      quantity: 1,
      itemImageUrl: "https://example.com/skirt.png",
      orderTotalPhp: 199,
      estimatedUnitCostPhp: 82,
      digitalReturnTaggedAt: new Date("2026-11-20T04:00:00Z"),
      courierReturnedToSellerAt: new Date("2026-11-20T06:00:00Z"),
      physicallyReceivedAt: null,
      physicalCondition: null,
    };

    const safe = redactParcelForStaff(dbParcel) as unknown as Record<string, unknown>;
    expect(safe.itemSummary).toBe("Korean Pleated Tennis Skirt");
    expect(safe.variationName).toBe("Black • Medium");
    expect(safe.alreadyScanned).toBe(false);
    expect("orderTotalPhp" in safe).toBe(false);
    expect("estimatedUnitCostPhp" in safe).toBe(false);
  });
});
