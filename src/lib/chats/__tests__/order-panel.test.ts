import { describe, expect, it } from "vitest";
import { buildOrderPanel, orderStatusLabel } from "@/lib/chats/order-panel";

describe("buildOrderPanel", () => {
  it("builds the card from a synced order", () => {
    const panel = buildOrderPanel({
      order: {
        orderSn: "2611205HQ8K2TR",
        status: "SHIPPED",
        cancelRequested: false,
        lines: [
          { name: "Pleated Skirt", variationName: "Black, M", imageUrl: "https://img/a.jpg", quantity: 1 },
          { name: "Baby Tee", variationName: "Rose", imageUrl: null, quantity: 2 },
        ],
        packages: [
          { trackingNumber: null, carrier: null },
          { trackingNumber: "SPXPH0123", carrier: "SPX Express" },
        ],
      },
    });
    expect(panel).toMatchObject({
      orderSn: "2611205HQ8K2TR",
      itemName: "Pleated Skirt",
      variation: "Black, M",
      moreItems: 2,
      statusLabel: "On the way",
      trackingNumber: "SPXPH0123",
    });
    expect(panel?.carrier).toBeTruthy();
  });

  it("uses the sample order for sample chats", () => {
    const panel = buildOrderPanel({
      sampleOrder: {
        orderSn: "S1",
        photoUrl: null,
        itemName: "Skirt",
        variation: null,
        moreItems: 0,
        statusLabel: "Delivered",
        carrier: "J&T Express",
        trackingNumber: null,
      },
    });
    expect(panel?.itemName).toBe("Skirt");
  });

  it("returns null with no order or a broken sample", () => {
    expect(buildOrderPanel({})).toBeNull();
    expect(buildOrderPanel({ order: null, sampleOrder: { nope: true } })).toBeNull();
  });
});

describe("orderStatusLabel", () => {
  it("uses plain words, never raw codes", () => {
    expect(orderStatusLabel("READY_TO_SHIP")).toBe("Getting ready to ship");
    expect(orderStatusLabel("IN_TRANSIT")).toBe("On the way");
    expect(orderStatusLabel("AWAITING_SHIPMENT", true)).toBe("Buyer asked to cancel");
    expect(orderStatusLabel("SOMETHING_NEW")).toBe("Something new");
  });
});
