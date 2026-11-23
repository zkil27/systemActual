import { describe, expect, it } from "vitest";
import { chooseTikTokHandover, chooseTikTokPickup, tiktokLabel, tiktokShipDecision, tiktokShipErrors } from "@/lib/shipping/tiktok-rules";

const now = new Date("2026-11-21T02:00:00Z");
const nowSec = Math.floor(now.getTime() / 1000);
const order = (status: string, over: Partial<{ cancelRequested: boolean; platformCreatedAt: Date }> = {}) => ({
  status,
  cancelRequested: false,
  platformCreatedAt: new Date(now.getTime() - 3 * 3600_000),
  ...over,
});

describe("tiktokShipDecision (on a freshly re-checked order)", () => {
  it("ships a ready package", () => {
    expect(tiktokShipDecision(order("AWAITING_SHIPMENT"), { status: "TO_FULFILL" }, false, now)).toEqual({ kind: "ship" });
    expect(tiktokShipDecision(order("AWAITING_SHIPMENT"), { status: null }, false, now)).toEqual({ kind: "ship" });
  });

  it("never ships cancelled or cancel-requested orders", () => {
    expect(tiktokShipDecision(order("CANCELLED"), { status: null }, false, now).kind).toBe("cancelled");
    expect(tiktokShipDecision(order("AWAITING_SHIPMENT", { cancelRequested: true }), { status: "TO_FULFILL" }, false, now).kind).toBe("cancelled");
    expect(tiktokShipDecision(order("AWAITING_SHIPMENT"), { status: "CANCELLED" }, true, now).kind).toBe("cancelled");
  });

  it("waits until the order is 1 hour old unless includeNewOrders is enabled", () => {
    const young = order("AWAITING_SHIPMENT", { platformCreatedAt: new Date(now.getTime() - 10 * 60_000) });
    expect(tiktokShipDecision(young, { status: "TO_FULFILL" }, false, now).kind).toBe("wait");
    expect(tiktokShipDecision(young, { status: "TO_FULFILL" }, false, now, { includeNewOrders: true })).toEqual({ kind: "ship" });
  });

  it("after a lost reply: arranged now means it was us; still ready means ship again", () => {
    expect(tiktokShipDecision(order("AWAITING_COLLECTION"), { status: "PROCESSING" }, true, now)).toEqual({ kind: "arranged" });
    expect(tiktokShipDecision(order("AWAITING_SHIPMENT"), { status: "PROCESSING" }, true, now)).toEqual({ kind: "arranged" });
    expect(tiktokShipDecision(order("AWAITING_SHIPMENT"), { status: "TO_FULFILL" }, true, now)).toEqual({ kind: "ship" });
  });

  it("arranged by someone else gets no second label", () => {
    expect(tiktokShipDecision(order("AWAITING_COLLECTION"), { status: "PROCESSING" }, false, now)).toMatchObject({
      kind: "failed",
      reason: expect.stringMatching(/outside Kyna Ops/),
    });
  });

  it("partially shipped orders are left for a person", () => {
    expect(tiktokShipDecision(order("PARTIALLY_SHIPPING"), { status: "TO_FULFILL" }, false, now)).toEqual({
      kind: "failed",
      reason: "Order is partially shipping",
    });
  });
});

describe("chooseTikTokPickup", () => {
  it("takes the earliest open slot that hasn't ended", () => {
    const res = chooseTikTokPickup(
      {
        can_pickup: true,
        pickup_slots: [
          { start_time: nowSec + 7200, end_time: nowSec + 10800, avaliable: true },
          { start_time: nowSec - 7200, end_time: nowSec - 3600, avaliable: true }, // ended
          { start_time: nowSec + 3600, end_time: nowSec + 7200, avaliable: false }, // full
          { start_time: nowSec + 5400, end_time: nowSec + 9000, avaliable: true },
        ],
      },
      now
    );
    expect(res).toEqual({ ok: true, slot: { start_time: nowSec + 5400, end_time: nowSec + 9000 } });
  });

  it("no slots listed: the courier picks the time", () => {
    expect(chooseTikTokPickup({ can_pickup: true, pickup_slots: [] }, now)).toEqual({ ok: true, slot: null });
  });

  it("all slots full: retry later; pickup not offered: fail clearly", () => {
    expect(chooseTikTokPickup({ can_pickup: true, pickup_slots: [{ start_time: nowSec + 1, end_time: nowSec + 2, avaliable: false }] }, now)).toMatchObject({
      ok: false,
      retry: true,
    });
    expect(chooseTikTokPickup({ can_pickup: false, can_drop_off: true }, now)).toMatchObject({ ok: false, retry: false });
  });

  it("chooseTikTokHandover falls back to DROP_OFF when pickup is unavailable", () => {
    expect(chooseTikTokHandover({ can_pickup: false, can_drop_off: true }, now)).toEqual({
      ok: true,
      handoverMethod: "DROP_OFF",
      slot: null,
    });
    expect(chooseTikTokHandover({ can_pickup: true, pickup_slots: [] }, now)).toEqual({
      ok: true,
      handoverMethod: "PICKUP",
      slot: null,
    });
  });
});

describe("tiktokShipErrors", () => {
  it("a code-0 reply can still list failed packages", () => {
    const res = tiktokShipErrors({
      errors: [{ code: 21011053, message: "Shipment time is outside of the pick-up time slot.", detail: { package_id: "PKG2" } }],
    });
    expect(res.byPackage).toEqual(new Map([["PKG2", "Shipment time is outside of the pick-up time slot."]]));
    expect(res.unattributed).toEqual([]);
  });

  it("errors with no package id are flagged so nobody is assumed shipped", () => {
    expect(tiktokShipErrors({ errors: [{ code: 36009003, message: "Internal error" }] }).unattributed).toEqual(["Internal error"]);
    expect(tiktokShipErrors({}).byPackage.size).toBe(0);
  });
});

describe("tiktokLabel", () => {
  it("reads the label URL and tracking number; ignores non-https URLs", () => {
    expect(tiktokLabel({ doc_url: "https://p16.tiktokcdn.com/label.pdf", tracking_number: " JT0012345678 " })).toEqual({
      url: "https://p16.tiktokcdn.com/label.pdf",
      trackingNumber: "JT0012345678",
    });
    expect(tiktokLabel({ doc_url: "http://evil.example/label.pdf" })).toEqual({ url: null, trackingNumber: null });
    expect(tiktokLabel(null)).toEqual({ url: null, trackingNumber: null });
  });
});
