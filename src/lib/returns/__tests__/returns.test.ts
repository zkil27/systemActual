import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { classifyReturnCategory, mergeDigitalStatus } from "@/lib/connectors/normalizer";
import {
  classifyTikTokReturn,
  findDeliveryFailed,
  findReturnedToSeller,
  hasCourierCustody,
  isFailedDeliveryCandidate,
} from "@/lib/returns/classify";
import { returnDedupeKey } from "@/lib/returns/keys";
import { mapFailedDelivery, mapShopeeReturn, mapTikTokReturn, tiktokTrackingEvents } from "@/lib/returns/map";
import { isActiveSince, isExpectedAtDoor, isMissingDiscrepancy, isOverdueRts } from "@/lib/returns/rules";
import {
  shopeeInTransitReturn,
  shopeeNormalReturn,
  shopeeRefundOnly,
  shopeeReturnOnTheSpot,
  shopeeReverseDelivered,
  shopeeReverseWarehouse,
  tiktokRefundOnly,
  tiktokReturnAndRefund,
} from "./fixtures";

const ctx = { shopConnectionId: "shop1", forwardTrackingNumber: "SPXFWD123", orderCarrier: "SPX Express" };

describe("Shopee returns are classified from platform fields", () => {
  it("Return on the Spot is a failed delivery, coming back on the original waybill", () => {
    const p = mapShopeeReturn(shopeeReturnOnTheSpot, ctx);
    expect(p.category).toBe(ReturnCategory.FAILED_DELIVERY);
    expect(p.returnRequestType).toBe(2);
    expect(p.expectsPhysicalReturn).toBe(true);
    expect(p.forwardTrackingNumber).toBe("SPXFWD123");
    expect(p.rtsTrackingNumber).toBeNull();
    expect(p.digitalStatus).toBe(DigitalStatus.RETURNING_TO_SELLER);
    expect(returnDedupeKey(p.category, p.returnSn, p.orderSn)).toBe(`F:${p.orderSn}`);
  });

  it("a normal return is a buyer return with the new waybill from reverse tracking", () => {
    const p = mapShopeeReturn(shopeeNormalReturn, { ...ctx, reverse: shopeeReverseDelivered });
    expect(p.category).toBe(ReturnCategory.RETURN_REFUND);
    expect(p.rtsTrackingNumber).toBe("SPXRET000222");
    expect(p.courierReturnedToSellerAt?.getTime()).toBe(1795200000 * 1000);
    expect(p.disputeDeadlineAt?.getTime()).toBe(1795300000 * 1000);
  });

  it("falls back to the return list tracking number before reverse info arrives", () => {
    expect(mapShopeeReturn(shopeeNormalReturn, ctx).rtsTrackingNumber).toBe("SPXRET000111");
  });

  it("an in-transit return is a buyer return on the original waybill", () => {
    const p = mapShopeeReturn(shopeeInTransitReturn, ctx);
    expect(p.category).toBe(ReturnCategory.RETURN_REFUND);
    expect(p.rtsTrackingNumber).toBeNull();
    expect(p.forwardTrackingNumber).toBe("SPXFWD123");
  });

  it("refund-only is not expected at the door", () => {
    const p = mapShopeeReturn(shopeeRefundOnly, ctx);
    expect(p.expectsPhysicalReturn).toBe(false);
    expect(p.returnType).toBe("REFUND_ONLY");
  });

  it("REFUND_PAID alone never means the courier delivered it back (old bug)", () => {
    const p = mapShopeeReturn({ ...shopeeNormalReturn, status: "REFUND_PAID" }, ctx);
    expect(p.courierReturnedToSellerAt).toBeNull();
    expect(p.digitalStatus).toBe(DigitalStatus.RESOLVED_REFUNDED);
  });

  it("with warehouse validation, uses the warehouse→seller leg", () => {
    const p = mapShopeeReturn(shopeeNormalReturn, { ...ctx, reverse: shopeeReverseWarehouse });
    expect(p.rtsTrackingNumber).toBe("SPXRTS-TO-SELLER");
    expect(p.courierReturnedToSellerAt).toBeNull();
  });

  it("cancelled requests are not expected", () => {
    const p = mapShopeeReturn({ ...shopeeNormalReturn, status: "CANCELLED" }, ctx);
    expect(isExpectedAtDoor({ expectsPhysicalReturn: p.expectsPhysicalReturn!, digitalStatus: p.digitalStatus })).toBe(false);
  });
});

describe("TikTok returns", () => {
  it("merges per-unit lines and keeps the return waybill", () => {
    const p = mapTikTokReturn(tiktokReturnAndRefund, ctx);
    expect(p.category).toBe(ReturnCategory.RETURN_REFUND);
    expect(p.quantity).toBe(2);
    expect(p.items).toHaveLength(1);
    expect(p.rtsTrackingNumber).toBe("JTRET0001");
    expect(p.digitalStatus).toBe(DigitalStatus.RETURN_IN_TRANSIT);
    expect(p.courierReturnedToSellerAt).toBeNull();
  });

  it("REFUND type is refund-only", () => {
    const p = mapTikTokReturn(tiktokRefundOnly, ctx);
    expect(p.expectsPhysicalReturn).toBe(false);
    expect(p.courierReturnedToSellerAt).toBeNull();
  });

  it("a completed return-and-refund means the seller has the parcel", () => {
    expect(classifyTikTokReturn({ return_type: "RETURN_AND_REFUND", return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE" }).courierDelivered).toBe(true);
    expect(classifyTikTokReturn({ return_type: "RETURN_AND_REFUND", return_status: "RETURN_OR_REFUND_REQUEST_CANCEL" }).digitalStatus).toBe(
      DigitalStatus.CANCELLED_RETURN
    );
  });

  it("detects TikTok BUYER_SHIPPED_ITEM delivered to seller via 48h SELLER_RESPOND_RECEIVE_PACKAGE deadline", () => {
    const updateSec = 1795311579; // 2026-11-22T01:39:39Z (09:39 Manila)
    const transitDeadlineSec = updateSec + 14 * 24 * 3600; // 14-day transit window
    const deliveredDeadlineSec = updateSec + 2 * 24 * 3600; // 48-hour seller inspection window

    const inTransit = mapTikTokReturn(
      {
        ...tiktokReturnAndRefund,
        update_time: updateSec,
        seller_next_action_response: [
          { action: "SELLER_RESPOND_RECEIVE_PACKAGE", deadline: transitDeadlineSec },
        ],
      },
      ctx
    );
    expect(inTransit.digitalStatus).toBe(DigitalStatus.RETURN_IN_TRANSIT);
    expect(inTransit.courierReturnedToSellerAt).toBeNull();
    expect(inTransit.disputeDeadlineAt).toBeNull();

    const delivered = mapTikTokReturn(
      {
        ...tiktokReturnAndRefund,
        update_time: updateSec,
        seller_next_action_response: [
          { action: "SELLER_RESPOND_RECEIVE_PACKAGE", deadline: deliveredDeadlineSec },
        ],
      },
      ctx
    );
    expect(delivered.digitalStatus).toBe(DigitalStatus.COURIER_RETURNED);
    expect(delivered.courierReturnedToSellerAt?.getTime()).toBe(updateSec * 1000);
    expect(delivered.disputeDeadlineAt?.getTime()).toBe(deliveredDeadlineSec * 1000);
  });
});

describe("failed deliveries from the order ledger", () => {
  const shippedAt = new Date("2026-11-15T02:00:00Z");

  it("only orders cancelled after the courier had them", () => {
    expect(isFailedDeliveryCandidate({ status: "CANCELLED", shippedAt, packageStatuses: ["LOGISTICS_DELIVERY_FAILED"] })).toBe(true);
    expect(isFailedDeliveryCandidate({ status: "CANCELLED", shippedAt: null, packageStatuses: [] })).toBe(false);
    expect(isFailedDeliveryCandidate({ status: "SHIPPED", shippedAt, packageStatuses: [] })).toBe(false);
    expect(isFailedDeliveryCandidate({ status: "CANCELLED", shippedAt, packageStatuses: ["LOGISTICS_LOST"] })).toBe(false);
  });

  it("Shopee TO_RETURN is never treated as a failed delivery", () => {
    expect(isFailedDeliveryCandidate({ status: "TO_RETURN", shippedAt, packageStatuses: [] })).toBe(false);
  });

  it("maps the order with every line and the courier timestamps", () => {
    const events = tiktokTrackingEvents({
      tracking: [
        { description: "Out for delivery", update_time_millis: 1795000000000 },
        { description: "Delivery attempt failed - buyer refused", update_time_millis: 1795010000000 },
        { description: "Parcel returned to seller", update_time_millis: 1795400000000 },
      ],
    });
    const p = mapFailedDelivery(Platform.TIKTOK, "shop1", {
      orderSn: "577086512123700000",
      status: "CANCELLED",
      totalPhp: 398,
      platformCreatedAt: new Date("2026-11-14T00:00:00Z"),
      platformUpdatedAt: new Date("2026-11-20T00:00:00Z"),
      cancelReason: "Package delivery failed",
      lines: [
        { name: "Ribbed Top", variationName: "Black, M", imageUrl: null, quantity: 1, listingId: "a", variationId: "1" },
        { name: "Wide Leg Pants", variationName: "Beige, L", imageUrl: null, quantity: 1, listingId: "b", variationId: "2" },
      ],
      packages: [{ trackingNumber: "JT0012345678", carrier: "J&T Express" }],
    }, events);
    expect(p.category).toBe(ReturnCategory.FAILED_DELIVERY);
    expect(p.itemSummary).toBe("Ribbed Top +1 more");
    expect(p.quantity).toBe(2);
    expect(p.forwardTrackingNumber).toBe("JT0012345678");
    expect(p.digitalReturnTaggedAt?.getTime()).toBe(1795010000000);
    expect(p.courierReturnedToSellerAt?.getTime()).toBe(1795400000000);
    expect(p.digitalStatus).toBe(DigitalStatus.COURIER_RETURNED);
  });

  it("never sets taggedAt after courierReturnedToSellerAt when failed-delivery event is missing", () => {
    const returnedAtMs = new Date("2026-11-19T11:58:00Z").getTime();
    const events = tiktokTrackingEvents({
      tracking: [
        { description: "In transit", update_time_millis: new Date("2026-11-17T08:00:00Z").getTime() },
        { description: "Parcel returned to seller", update_time_millis: returnedAtMs },
      ],
    });
    const p = mapFailedDelivery(Platform.TIKTOK, "shop1", {
      orderSn: "577086512123700001",
      status: "CANCELLED",
      totalPhp: 199,
      platformCreatedAt: new Date("2026-11-14T00:00:00Z"),
      platformUpdatedAt: new Date("2026-11-21T06:44:00Z"),
      cancelReason: "Package delivery failed",
      lines: [
        { name: "Skort", variationName: "Maroon, L", imageUrl: null, quantity: 1, listingId: "a", variationId: "1" },
      ],
      packages: [{ trackingNumber: "JT0099999999", carrier: "J&T Express" }],
    }, events);
    expect(p.courierReturnedToSellerAt?.getTime()).toBe(returnedAtMs);
    expect(p.digitalReturnTaggedAt?.getTime()).toBe(returnedAtMs);
  });

  it("Return on the Spot and the cancelled order merge into one parcel", () => {
    const ros = mapShopeeReturn(shopeeReturnOnTheSpot, ctx);
    expect(returnDedupeKey(ros.category, ros.returnSn, ros.orderSn)).toBe(
      returnDedupeKey(ReturnCategory.FAILED_DELIVERY, null, shopeeReturnOnTheSpot.order_sn)
    );
  });
});

describe("keys", () => {
  it("two returns on one order stay separate", () => {
    expect(returnDedupeKey(ReturnCategory.RETURN_REFUND, "R1", "O1")).not.toBe(
      returnDedupeKey(ReturnCategory.RETURN_REFUND, "R2", "O1")
    );
  });
});

describe("tracking text", () => {
  const ev = (description: string, t: number, status?: string) => ({ time: new Date(t), description, status });
  it("finds the earliest delivered-back event", () => {
    expect(findReturnedToSeller([ev("In transit", 1), ev("Successfully returned to seller", 5), ev("Returned to seller", 9)])?.getTime()).toBe(5);
    expect(findReturnedToSeller([ev("Delivered to buyer", 1)])).toBeNull();
  });
  it("matches Shopee 'Parcel has been returned to you' without matching future-tense 'will be returned to you'", () => {
    expect(
      findReturnedToSeller([
        ev("Parcel will be returned to you due to unsuccessful delivery attempts to buyer", 10),
        ev("Parcel has been arrived at the delivery hub : Taytay,TTP_PDC", 20),
        ev("Parcel has been returned to you", 30),
      ])?.getTime()
    ).toBe(30);
    expect(
      findReturnedToSeller([
        ev("Parcel will be returned to you due to unsuccessful delivery attempts to buyer", 10),
      ])
    ).toBeNull();
  });
  it("finds the failed-delivery event including Shopee Flash Express wording", () => {
    expect(findDeliveryFailed([ev("Delivery unsuccessful: consignee refused", 3)])?.getTime()).toBe(3);
    expect(
      findDeliveryFailed([
        ev("Delivery attempt to buyer was unsuccessful :Recipient Missed Delivery", 5),
        ev("Parcel will be returned to you due to unsuccessful delivery attempts to buyer", 9),
      ])?.getTime()
    ).toBe(5);
    expect(
      findDeliveryFailed([ev("Parcel will be returned to you due to unsuccessful delivery attempts to buyer", 9)])?.getTime()
    ).toBe(9);
  });
  it("requires actual courier pickup/transit events for courier custody", () => {
    expect(hasCourierCustody([])).toBe(false);
    expect(hasCourierCustody([ev("Order created", 1), ev("Waiting for pickup", 2)])).toBe(false);
    expect(
      hasCourierCustody([
        ev("The seller is preparing your package, and will hand it over to our carrier for shipping.", 1, "20101"),
        ev("The shipping carrier is on the way to pick up your package. Driver phone number: 639922733219", 2, "20201"),
        ev("Your package was not collected by our carrier for the following reason: Seller is preparing package.", 3, "20301"),
        ev("Your package delivery was canceled.", 4, "110101"),
      ])
    ).toBe(false);
    expect(hasCourierCustody([ev("Your package has been collected by our carrier in Rizal.", 2, "30901")])).toBe(true);
    expect(hasCourierCustody([ev("Order created", 1), ev("Picked up by courier", 2)])).toBe(true);
    expect(hasCourierCustody([ev("Arrived at sorting facility", 2)])).toBe(true);
    expect(hasCourierCustody([ev("Delivery attempt failed", 2)])).toBe(true);
    expect(hasCourierCustody([ev("Parcel has been returned to you", 2)])).toBe(true);
  });
  it("distinguishes TikTok 70201 'is being returned to the seller' from 80101 'has been returned to the seller'", () => {
    const timeline = [
      ev("Sorry, this package can no longer be delivered for the following reason: Package rejected by customer.", 10, "40601"),
      ev("Your package is being returned to the seller in Laguna.", 20, "70201"),
      ev("Return package out for delivery.", 30, "70207"),
      ev("Your package has been returned to the seller in Rizal.", 40, "80101"),
    ];
    expect(findDeliveryFailed(timeline)?.getTime()).toBe(10);
    expect(findReturnedToSeller(timeline)?.getTime()).toBe(40);
    expect(findReturnedToSeller(timeline.slice(0, 3))).toBeNull();
  });
});

describe("spreadsheet text classifier", () => {
  it("'rts' no longer matches shirts, skirts or shorts", () => {
    for (const reason of ["Customer ordered 3 shirts", "skirts too long", "Shorts"]) {
      expect(
        classifyReturnCategory({ platform: Platform.SHOPEE, hasBuyerReturnSn: true, rawStatus: "REQUESTED", reason }),
        reason
      ).toBe(ReturnCategory.RETURN_REFUND);
    }
    expect(classifyReturnCategory({ platform: Platform.SHOPEE, rawStatus: "RTS", reason: null })).toBe(
      ReturnCategory.FAILED_DELIVERY
    );
  });
});

describe("status never moves backwards", () => {
  it("keeps COURIER_RETURNED over a stale in-transit poll, lets outcomes win", () => {
    expect(mergeDigitalStatus(DigitalStatus.COURIER_RETURNED, DigitalStatus.RETURN_IN_TRANSIT)).toBe(DigitalStatus.COURIER_RETURNED);
    expect(mergeDigitalStatus(DigitalStatus.COURIER_RETURNED, DigitalStatus.RESOLVED_REFUNDED)).toBe(DigitalStatus.RESOLVED_REFUNDED);
    expect(mergeDigitalStatus(undefined, DigitalStatus.RETURN_REQUESTED)).toBe(DigitalStatus.RETURN_REQUESTED);
  });
});

describe("missing / overdue rules", () => {
  const now = new Date("2026-11-21T02:00:00Z");
  const base = {
    category: ReturnCategory.FAILED_DELIVERY,
    digitalStatus: DigitalStatus.RETURNING_TO_SELLER,
    expectsPhysicalReturn: true,
    digitalReturnTaggedAt: new Date("2026-11-08T00:00:00Z"),
    courierReturnedToSellerAt: null,
    physicallyReceivedAt: null,
  };

  it("a failed delivery 13 days out is overdue", () => {
    expect(isOverdueRts(base, 10, now)).toBe(true);
  });

  it("refund-only and cancelled parcels are never missing or overdue", () => {
    const delivered = { ...base, courierReturnedToSellerAt: new Date("2026-11-20T00:00:00Z") };
    expect(isMissingDiscrepancy(delivered)).toBe(true);
    expect(isMissingDiscrepancy({ ...delivered, expectsPhysicalReturn: false })).toBe(false);
    expect(isMissingDiscrepancy({ ...delivered, digitalStatus: DigitalStatus.CANCELLED_RETURN })).toBe(false);
    expect(isOverdueRts({ ...base, expectsPhysicalReturn: false }, 10, now)).toBe(false);
  });

  it("respects missingSinceAt baseline cutoff", () => {
    const delivered = { ...base, courierReturnedToSellerAt: new Date("2026-11-20T00:00:00Z") };
    const before = new Date("2026-11-19T00:00:00Z");
    const exact = new Date("2026-11-20T00:00:00Z");
    const after = new Date("2026-11-21T00:00:00Z");
    expect(isMissingDiscrepancy(delivered, null)).toBe(true);
    expect(isMissingDiscrepancy(delivered, before)).toBe(true);
    expect(isMissingDiscrepancy(delivered, exact)).toBe(true);
    expect(isMissingDiscrepancy(delivered, after)).toBe(false);
  });

  it("applies soft go-live cutoff across active and overdue checks", () => {
    const startAt = new Date("2026-11-21T16:00:00Z"); // 2026-11-22 00:00 Manila
    const preTaggedOpen = {
      ...base,
      digitalReturnTaggedAt: new Date("2026-11-08T00:00:00Z"),
      courierReturnedToSellerAt: null,
      physicallyReceivedAt: null,
    };
    const preTaggedResolved = {
      ...preTaggedOpen,
      digitalStatus: DigitalStatus.RESOLVED_REFUNDED,
    };
    const preReturned = {
      ...preTaggedOpen,
      courierReturnedToSellerAt: new Date("2026-11-20T08:00:00Z"),
    };
    const returnedAfterStart = {
      ...preTaggedOpen,
      courierReturnedToSellerAt: new Date("2026-11-22T02:00:00Z"),
    };
    const scannedAfterStart = {
      ...preReturned,
      physicallyReceivedAt: new Date("2026-11-22T03:00:00Z"),
    };
    const taggedAfterStart = {
      ...base,
      digitalReturnTaggedAt: new Date("2026-11-22T01:00:00Z"),
      courierReturnedToSellerAt: null,
      physicallyReceivedAt: null,
    };

    expect(isActiveSince(preTaggedOpen, null)).toBe(true);
    expect(isActiveSince(preTaggedOpen, startAt)).toBe(true);
    expect(isActiveSince(preTaggedResolved, startAt)).toBe(false);
    expect(isActiveSince(preReturned, startAt)).toBe(false);
    expect(isActiveSince(returnedAfterStart, startAt)).toBe(true);
    expect(isActiveSince(scannedAfterStart, startAt)).toBe(true);
    expect(isActiveSince(taggedAfterStart, startAt)).toBe(true);

    // Pre-go-live unreturned parcel is hidden from Overdue; post-go-live one >10d is Overdue
    expect(isOverdueRts(preTaggedOpen, 10, now, startAt)).toBe(false);
    expect(isOverdueRts(taggedAfterStart, 10, new Date("2026-12-03T00:00:00Z"), startAt)).toBe(true);
  });
});

describe("open parcels are refreshed however old", () => {
  it("still rechecks a parcel tagged 20 days ago (the old sync stopped at 7)", async () => {
    const { openParcelsWhere } = await import("@/lib/returns/sync");
    const now = new Date("2026-11-21T02:00:00Z").getTime();
    const where = openParcelsWhere("shop1", now);
    const since = (where.digitalReturnTaggedAt as { gte: Date }).gte.getTime();
    const twentyDaysAgo = now - 20 * 24 * 3600_000;
    expect(twentyDaysAgo).toBeGreaterThanOrEqual(since);
    expect(where.expectsPhysicalReturn).toBe(true);
  });
});
