import { Platform } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { classifyReady, ledgerToShip, staleReadyOrders, type ReadyOrderInput } from "@/lib/waves/ready";

const now = new Date("2026-11-21T02:00:00Z");
const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000);
const tenMinAgo = new Date(now.getTime() - 10 * 60_000);

const pkg = (over: Partial<ReadyOrderInput["packages"][number]> = {}) => ({
  carrier: "J&T Express",
  status: "TO_FULFILL",
  trackingNumber: null,
  inActiveWave: false,
  ...over,
});
const tt = (over: Partial<ReadyOrderInput> = {}): ReadyOrderInput => ({
  platform: Platform.TIKTOK,
  status: "AWAITING_SHIPMENT",
  cancelRequested: false,
  platformCreatedAt: twoHoursAgo,
  packages: [pkg()],
  ...over,
});

describe("classifyReady", () => {
  it("puts every to-ship order in exactly one bucket", () => {
    const orders = [
      tt(),
      tt({ packages: [pkg({ carrier: "Ninja Van" })] }),
      tt({ platformCreatedAt: tenMinAgo }),
      tt({ cancelRequested: true }),
      tt({ packages: [pkg(), pkg()] }),
      tt({ packages: [pkg({ inActiveWave: true })] }),
      tt({ packages: [pkg({ status: "PROCESSING" })] }),
      tt({ packages: [] }),
    ];
    const c = classifyReady(orders, now);
    expect(c.totalReady).toBe(2);
    expect(c.byPlatform).toEqual({ SHOPEE: 0, TIKTOK: 2 });
    expect(c.coolingOffByPlatform.TIKTOK).toBe(1);
    expect(c.held.TIKTOK).toEqual({ cancelled: 1, split: 1, alreadyInWave: 1, notReady: 1, noPackage: 1 });
    expect(ledgerToShip(c, "TIKTOK")).toBe(orders.length);
    expect(c.byCourier).toEqual([
      { courier: "J&T Express", count: 1 },
      { courier: "Ninja Van", count: 1 },
    ]);
  });

  it("counts a new split order once, as waiting", () => {
    const c = classifyReady([tt({ platformCreatedAt: tenMinAgo, packages: [pkg(), pkg()] })], now);
    expect(c.coolingOff).toBe(1);
    expect(ledgerToShip(c, "TIKTOK")).toBe(1);
  });

  it("keeps platforms separate", () => {
    const c = classifyReady(
      [tt(), { ...tt(), platform: Platform.SHOPEE, status: "READY_TO_SHIP", packages: [pkg({ status: "LOGISTICS_READY" })] }],
      now
    );
    expect(c.byPlatform).toEqual({ SHOPEE: 1, TIKTOK: 1 });
    expect(ledgerToShip(c, "TIKTOK")).toBe(1);
  });
});

describe("staleReadyOrders", () => {
  const local = [
    { id: "1", orderSn: "A", shopConnectionId: "s1" },
    { id: "2", orderSn: "B", shopConnectionId: "s1" },
    { id: "3", orderSn: "C", shopConnectionId: "s2" },
  ];

  it("returns local ready orders the shop no longer lists", () => {
    const stale = staleReadyOrders(local, new Set(["s1:A"]), new Set(["s1", "s2"]));
    expect(stale.map((o) => o.id)).toEqual(["2", "3"]);
  });

  it("ignores shops whose live pass didn't finish", () => {
    expect(staleReadyOrders(local, new Set(["s1:A"]), new Set(["s1"])).map((o) => o.id)).toEqual(["2"]);
    expect(staleReadyOrders(local, new Set(), new Set())).toEqual([]);
  });
});
