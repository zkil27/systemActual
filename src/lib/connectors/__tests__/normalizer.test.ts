import { describe, expect, it } from "vitest";
import { Platform, ReturnCategory } from "@prisma/client";
import {
  classifyReturnCategory,
  isDiscrepancyParcel,
  normalizeCourierName,
  pickEarliestTimestamp,
} from "@/lib/connectors/normalizer";

describe("Return classification & timestamp truth rules", () => {
  it("strictly separates Failed Delivery from Buyer Return/Refund", () => {
    expect(
      classifyReturnCategory({
        platform: Platform.SHOPEE,
        hasBuyerReturnSn: false,
        rawStatus: "TO_RETURN",
        reason: "Buyer refused COD delivery",
      })
    ).toBe(ReturnCategory.FAILED_DELIVERY);

    expect(
      classifyReturnCategory({
        platform: Platform.TIKTOK,
        hasBuyerReturnSn: true,
        rawStatus: "RETURN_REQUESTED",
        reason: "Wrong size ordered",
      })
    ).toBe(ReturnCategory.RETURN_REFUND);

    expect(
      classifyReturnCategory({
        platform: Platform.TIKTOK,
        hasBuyerReturnSn: true,
        rawStatus: "FAILED_DELIVERY",
        reason: "Recipient unreachable after 2 attempts",
      })
    ).toBe(ReturnCategory.FAILED_DELIVERY);
  });

  it("preserves the earliest driver tag timestamp across later re-polls", () => {
    const yesterday = new Date("2026-11-19T06:00:00Z");
    const todayPoll = new Date("2026-11-20T06:00:00Z");
    expect(pickEarliestTimestamp(yesterday, todayPoll)?.toISOString()).toBe(
      yesterday.toISOString()
    );
    expect(pickEarliestTimestamp(null, todayPoll)?.toISOString()).toBe(
      todayPoll.toISOString()
    );
  });

  it("flags courier-claimed returns that have not been physically scanned as discrepancies", () => {
    expect(
      isDiscrepancyParcel({
        courierReturnedToSellerAt: new Date("2026-11-20T05:00:00Z"),
        physicallyReceivedAt: null,
      })
    ).toBe(true);

    expect(
      isDiscrepancyParcel({
        courierReturnedToSellerAt: new Date("2026-11-20T05:00:00Z"),
        physicallyReceivedAt: new Date("2026-11-20T07:00:00Z"),
      })
    ).toBe(false);
  });

  it("normalizes PH courier names consistently", () => {
    expect(normalizeCourierName("Shopee Xpress Standard")).toBe("SPX Express");
    expect(normalizeCourierName("J&T Express PH")).toBe("J&T Express");
    expect(normalizeCourierName("Flash Express")).toBe("Flash Express");
  });
});
