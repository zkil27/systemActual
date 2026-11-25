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
  });
});
