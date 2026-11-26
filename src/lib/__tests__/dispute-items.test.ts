import { describe, expect, it } from "vitest";
import { PhysicalCondition, Platform, ReturnCategory } from "@prisma/client";
import { buildDisputeAppealDraft, itemCheckBlock } from "@/lib/reports/dispute-template";

const top = { name: "Ribbed Top", variationName: "Black, M", expectedQty: 2, goodQty: 1, damagedQty: 0, wrongQty: 0, missingQty: 1 };
const skirt = { name: "Tennis Skirt", variationName: null, expectedQty: 1, goodQty: 1, damagedQty: 0, wrongQty: 0, missingQty: 0 };

describe("itemCheckBlock", () => {
  it("lists every item when something didn't come back", () => {
    expect(itemCheckBlock([top, skirt]).filter(Boolean)).toEqual([
      "Item-by-item check at our warehouse:",
      "- Ribbed Top (Black, M): expected 2 — 1 good, 1 missing",
      "- Tennis Skirt: expected 1 — 1 good",
    ]);
  });

  it("adds nothing for an unchecked or simple one-piece parcel", () => {
    expect(itemCheckBlock(undefined)).toEqual([]);
    expect(itemCheckBlock([skirt])).toEqual([]);
  });
});

describe("buildDisputeAppealDraft with an item check", () => {
  it("puts the item findings in the appeal", () => {
    const draft = buildDisputeAppealDraft({
      platform: Platform.SHOPEE,
      orderSn: "2611ABC",
      returnSn: "R1",
      forwardTrackingNumber: "SPX1",
      rtsTrackingNumber: null,
      courier: "SPX Express",
      category: ReturnCategory.RETURN_REFUND,
      returnReason: "Wrong size",
      itemSummary: "Ribbed Top +1 more",
      variationName: null,
      quantity: 3,
      digitalReturnTaggedAt: new Date("2026-11-20T00:00:00Z"),
      courierReturnedToSellerAt: new Date("2026-11-24T00:00:00Z"),
      physicallyReceivedAt: new Date("2026-11-25T00:00:00Z"),
      physicalCondition: PhysicalCondition.MISSING_PIECE,
      photoCount: 2,
      itemChecks: [top, skirt],
    });
    expect(draft).toContain("INCOMPLETE / MISSING piece(s)");
    expect(draft).toContain("Ribbed Top (Black, M): expected 2 — 1 good, 1 missing");
    // Blank paragraph separators are preserved instead of stripped by filter(Boolean).
    expect(draft).toContain("Subject: Seller Dispute Appeal — Order 2611ABC\n\nHello Shopee Dispute Team,\n\n");
    expect(draft).toContain("\n\nItem-by-item check at our warehouse:\n");
    expect(draft).toContain("\n\nThank you,\nKyna Clothing Shop");
  });

  it("preserves paragraph blank lines in missing-parcel drafts", () => {
    const draft = buildDisputeAppealDraft({
      platform: Platform.TIKTOK,
      orderSn: "TT-999",
      returnSn: null,
      forwardTrackingNumber: "JT1",
      rtsTrackingNumber: null,
      courier: "J&T Express",
      category: ReturnCategory.FAILED_DELIVERY,
      returnReason: null,
      itemSummary: "Skort",
      variationName: "Black, M",
      quantity: 1,
      digitalReturnTaggedAt: new Date("2026-11-20T00:00:00Z"),
      courierReturnedToSellerAt: new Date("2026-11-24T00:00:00Z"),
      physicallyReceivedAt: null,
      physicalCondition: null,
    });
    expect(draft).toContain("Subject: Missing Returned Parcel Claim — Order TT-999\n\nHello TikTok Shop Support Team,\n\n");
    expect(draft).not.toContain("- Return ID:");
    expect(draft).toContain("\n\nThank you,\nKyna Clothing Shop");
  });
});
