import { describe, expect, it } from "vitest";
import { redactOutboundPackageForStaff, redactParcelForStaff } from "@/lib/auth";

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
      itemsJson: [
        {
          name: "Korean Pleated Tennis Skirt",
          variationName: "Black, M",
          quantity: 1,
          imageUrl: "https://example.com/skirt.png",
          unitPricePhp: 199,
        },
        {
          name: "Ribbed Crop Top",
          variationName: "White, S",
          quantity: 2,
          imageUrl: "https://example.com/top.png",
          unitPricePhp: 149,
        },
      ],
      orderTotalPhp: 497,
      estimatedUnitCostPhp: 246,
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

    const lines = safe.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      lineKey: "n:ribbed crop top:white, s",
      name: "Ribbed Crop Top",
      variationName: "White, S",
      quantity: 2,
      imageUrl: "https://example.com/top.png",
    });
    expect("unitPricePhp" in lines[0]).toBe(false);
    // Nothing that looks like money or a price anywhere in what staff receive.
    expect(JSON.stringify(safe)).not.toMatch(/Php|price|497|246|149/i);
  });

  it("gives item lines with shop ids a stable key, without the ids' prices", () => {
    const safe = redactParcelForStaff({
      id: "p2",
      platform: "TIKTOK",
      orderSn: "5770001",
      returnSn: "R1",
      forwardTrackingNumber: null,
      rtsTrackingNumber: null,
      courier: "J&T Express",
      category: "RETURN_REFUND",
      digitalStatus: "COURIER_RETURNED",
      returnReason: null,
      itemSummary: "Tee",
      variationName: null,
      quantity: 2,
      itemImageUrl: null,
      // TikTok: one line per piece, merged for staff.
      itemsJson: [
        { name: "Tee", variationName: "Pink", quantity: 1, imageUrl: null, listingId: "17", variationId: "42", unitPricePhp: 175 },
        { name: "Tee", variationName: "Pink", quantity: 1, imageUrl: null, listingId: "17", variationId: "42", unitPricePhp: 175 },
      ],
      digitalReturnTaggedAt: null,
      courierReturnedToSellerAt: null,
      physicallyReceivedAt: null,
      physicalCondition: null,
    });
    expect(safe.lines).toEqual([{ lineKey: "17:42", name: "Tee", variationName: "Pink", quantity: 2, imageUrl: null }]);
    expect(JSON.stringify(safe)).not.toMatch(/Php|price|175/i);
  });

  it("never exposes totalPhp, unitPricePhp, or isCod on outbound packages", () => {
    const dbPackage = {
      id: "pkg-1",
      trackingNumber: "SPXPH999888",
      carrier: "SPX Express",
      packedAt: null,
      packedByStaff: null,
      order: {
        id: "ord-1",
        orderSn: "261122ABC123",
        platform: "SHOPEE",
        status: "PROCESSED",
        cancelRequested: false,
        isCod: true,
        totalPhp: 398,
        lines: [
          {
            id: "line-1",
            name: "Kyna PH Ribbed Crop Top for Women",
            variationName: "Black, M",
            imageUrl: "https://example.com/top.png",
            quantity: 2,
            unitPricePhp: 199,
          },
        ],
      },
      waveItems: [
        {
          status: "PRINTED",
          position: 13,
          wave: { parcelCount: 120 },
        },
      ],
    };

    const safe = redactOutboundPackageForStaff(dbPackage) as unknown as Record<string, unknown>;
    expect(safe.orderSn).toBe("261122ABC123");
    expect(safe.totalPieces).toBe(2);
    expect(safe.isMultiPiece).toBe(true);
    expect(safe.isCancelled).toBe(false);
    expect(safe.wavePosition).toBe(14);
    expect(safe.waveTotal).toBe(120);
    expect(safe.canReprint).toBe(true);
    expect("totalPhp" in safe).toBe(false);
    expect("isCod" in safe).toBe(false);
    expect("orderTotalPhp" in safe).toBe(false);
    expect("estimatedUnitCostPhp" in safe).toBe(false);

    const lines = safe.lines as Array<Record<string, unknown>>;
    expect(lines[0]).toMatchObject({
      id: "line-1",
      shortName: "Ribbed Crop Top",
      variationName: "Black, M",
      quantity: 2,
    });
    expect("unitPricePhp" in lines[0]).toBe(false);
  });
});
