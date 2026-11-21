import { describe, expect, it } from "vitest";
import {
  choosePickup,
  docCreateFailures,
  docStatuses,
  shopeeShipDecision,
  splitPackageResults,
  trackingNumbers,
} from "@/lib/shipping/shopee-rules";

const now = new Date("2026-11-21T02:00:00Z");
const old = new Date(now.getTime() - 3 * 3600_000);
const order = (status: string, over: Partial<{ cancelRequested: boolean; platformCreatedAt: Date }> = {}) => ({
  status,
  cancelRequested: false,
  platformCreatedAt: old,
  ...over,
});

describe("shopeeShipDecision (always on a freshly re-checked order)", () => {
  it("ships a ready order", () => {
    expect(shopeeShipDecision(order("READY_TO_SHIP"), { status: "LOGISTICS_READY" }, false, now)).toEqual({ kind: "ship" });
    expect(shopeeShipDecision(order("RETRY_SHIP"), { status: "LOGISTICS_PICKUP_RETRY" }, false, now)).toEqual({ kind: "ship" });
  });

  it("never ships a cancelled or cancel-requested order, even mid-wave", () => {
    expect(shopeeShipDecision(order("IN_CANCEL"), { status: null }, false, now).kind).toBe("cancelled");
    expect(shopeeShipDecision(order("READY_TO_SHIP", { cancelRequested: true }), { status: null }, false, now).kind).toBe("cancelled");
    expect(shopeeShipDecision(order("CANCELLED"), { status: null }, true, now).kind).toBe("cancelled");
  });

  it("waits until the order is 1 hour old", () => {
    const fresh = order("READY_TO_SHIP", { platformCreatedAt: new Date(now.getTime() - 30 * 60_000) });
    expect(shopeeShipDecision(fresh, { status: null }, false, now).kind).toBe("wait");
  });

  describe("crash or lost reply after asking Shopee to ship (shipRequested = true)", () => {
    it("now arranged → it was us: carry on to the label, don't ship again", () => {
      expect(shopeeShipDecision(order("PROCESSED"), { status: "LOGISTICS_REQUEST_CREATED" }, true, now)).toEqual({ kind: "arranged" });
      expect(shopeeShipDecision(order("READY_TO_SHIP"), { status: "LOGISTICS_REQUEST_CREATED" }, true, now)).toEqual({ kind: "arranged" });
    });

    it("still ready → the call never went through: safe to ship again", () => {
      expect(shopeeShipDecision(order("READY_TO_SHIP"), { status: "LOGISTICS_READY" }, true, now)).toEqual({ kind: "ship" });
    });
  });

  it("arranged by someone else (BigSeller / Seller Center) → no second label", () => {
    const d = shopeeShipDecision(order("PROCESSED"), { status: "LOGISTICS_REQUEST_CREATED" }, false, now);
    expect(d.kind).toBe("failed");
    if (d.kind === "failed") expect(d.reason).toMatch(/outside Kyna Ops/);
  });

  it("anything else is a failure with a plain reason", () => {
    const d = shopeeShipDecision(order("UNPAID"), { status: null }, false, now);
    expect(d).toEqual({ kind: "failed", reason: "Order is unpaid" });
  });
});

describe("choosePickup", () => {
  it("uses the pickup address and the earliest slot", () => {
    const res = choosePickup({
      info_needed: { pickup: ["address_id", "pickup_time_id"] },
      pickup: {
        address_list: [
          { address_id: 1, address_flag: ["return_address"], time_slot_list: [{ date: 1795000000, pickup_time_id: "x" }] },
          {
            address_id: 2,
            address_flag: ["pickup_address"],
            time_slot_list: [
              { date: 1795090000, pickup_time_id: "later" },
              { date: 1795010000, pickup_time_id: "earliest" },
            ],
          },
        ],
      },
    });
    expect(res).toEqual({ ok: true, pickup: { address_id: 2, pickup_time_id: "earliest" } });
  });

  it("works for couriers that pick a time themselves", () => {
    expect(choosePickup({ info_needed: { pickup: ["address_id"] }, pickup: { address_list: [{ address_id: 9, time_slot_list: [] }] } })).toEqual({
      ok: true,
      pickup: { address_id: 9 },
    });
  });

  it("retries when no slot is offered yet; fails clearly for drop-off-only or no address", () => {
    expect(
      choosePickup({ info_needed: { pickup: ["address_id", "pickup_time_id"] }, pickup: { address_list: [{ address_id: 1, time_slot_list: [] }] } })
    ).toMatchObject({ ok: false, retry: true });
    expect(choosePickup({ info_needed: { dropoff: ["branch_id"] } })).toMatchObject({ ok: false, retry: false, reason: expect.stringMatching(/drop-off/) });
    expect(choosePickup({ info_needed: { pickup: ["address_id"] }, pickup: { address_list: [] } })).toMatchObject({ ok: false, retry: false });
  });
});

describe("mass call results", () => {
  it("splits success, failure, and unknown (treated as maybe-shipped)", () => {
    const res = splitPackageResults(["P1", "P2", "P3"], {
      success_list: [{ package_number: "P1" }],
      fail_list: [{ package_number: "P2", fail_reason: "Pickup slot expired" }],
    });
    expect([...res.ok]).toEqual(["P1"]);
    expect(res.failed.get("P2")).toBe("Pickup slot expired");
    expect(res.unknown).toEqual(["P3"]);
  });

  it("treats an empty tracking number as 'not yet'", () => {
    const tn = trackingNumbers({
      success_list: [
        { package_number: "P1", tracking_number: "SPXPH0123456" },
        { package_number: "P2", tracking_number: "" },
      ],
    });
    expect([...tn.entries()]).toEqual([["P1", "SPXPH0123456"]]);
  });

  it("reads label document creation and readiness per package", () => {
    expect(
      docCreateFailures({ result_list: [{ package_number: "P1" }, { package_number: "P2", fail_error: "logistics.not_ready", fail_message: "Tracking not ready" }] })
    ).toEqual(new Map([["P2", "Tracking not ready"]]));
    const st = docStatuses({
      result_list: [
        { package_number: "P1", status: "READY" },
        { package_number: "P2", status: "PROCESSING" },
        { package_number: "P3", fail_error: "x", fail_message: "Failed to generate" },
      ],
    });
    expect(st.get("P1")).toEqual({ status: "READY" });
    expect(st.get("P2")).toEqual({ status: "PROCESSING" });
    expect(st.get("P3")).toEqual({ status: "FAILED", error: "Failed to generate" });
  });
});
