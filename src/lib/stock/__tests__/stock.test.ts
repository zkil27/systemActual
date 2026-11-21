import { Platform, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableToSell,
  hasLeftWarehouse,
  planPushes,
  RESTOCK_CONDITIONS,
  shipMovements,
  type PushCandidate,
} from "@/lib/stock/rules";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    garmentVariant: {
      findUniqueOrThrow: vi.fn(),
    },
    stockMovement: {
      groupBy: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

import { recordStaffStockReport } from "@/lib/stock/ledger";

describe("availableToSell", () => {
  it("is on shelf minus unshipped orders minus the safety buffer", () => {
    expect(availableToSell(20, 4, 2)).toBe(14);
    expect(availableToSell(20, 4, 0)).toBe(16);
  });
  it("never goes below zero", () => {
    expect(availableToSell(3, 5, 1)).toBe(0);
  });
});

describe("hasLeftWarehouse", () => {
  it("orders waiting for pickup are still on the shelf", () => {
    expect(hasLeftWarehouse(Platform.SHOPEE, "READY_TO_SHIP", null)).toBe(false);
    expect(hasLeftWarehouse(Platform.TIKTOK, "AWAITING_COLLECTION", new Date())).toBe(false);
  });
  it("shipped, delivered and completed orders have left", () => {
    expect(hasLeftWarehouse(Platform.SHOPEE, "SHIPPED", new Date())).toBe(true);
    expect(hasLeftWarehouse(Platform.TIKTOK, "IN_TRANSIT", null)).toBe(true);
    expect(hasLeftWarehouse(Platform.SHOPEE, "COMPLETED", null)).toBe(true);
  });
  it("a cancellation before pickup never left; after pickup it did (it comes back as a return)", () => {
    expect(hasLeftWarehouse(Platform.SHOPEE, "CANCELLED", null)).toBe(false);
    expect(hasLeftWarehouse(Platform.SHOPEE, "CANCELLED", new Date())).toBe(true);
  });
});

describe("shipMovements", () => {
  const t0 = new Date("2026-11-21T00:00:00Z");
  const order = { platform: Platform.SHOPEE, orderSn: "251121A", shippedAt: new Date("2026-11-21T05:00:00Z"), platformUpdatedAt: new Date() };

  it("subtracts each line once, with a key that can't be recorded twice", () => {
    const m = shipMovements(order, [
      { listingId: "9001", variationId: "77", quantity: 2, variant: { id: "gv1", startingStockSetAt: t0 } },
    ]);
    expect(m).toEqual([{ garmentVariantId: "gv1", delta: -2, sourceKey: "ship:SHOPEE:251121A:9001:77" }]);
    expect(shipMovements(order, [{ listingId: "9001", variationId: "77", quantity: 2, variant: { id: "gv1", startingStockSetAt: t0 } }])).toEqual(m);
  });

  it("ignores orders shipped before the owner's count, and items not counted yet", () => {
    const early = { ...order, shippedAt: new Date("2026-11-20T23:00:00Z") };
    expect(shipMovements(early, [{ listingId: "1", variationId: "1", quantity: 1, variant: { id: "gv1", startingStockSetAt: t0 } }])).toEqual([]);
    expect(shipMovements(order, [{ listingId: "1", variationId: "1", quantity: 1, variant: { id: "gv2", startingStockSetAt: null } }])).toEqual([]);
    expect(shipMovements(order, [{ listingId: "1", variationId: "1", quantity: 1, variant: null }])).toEqual([]);
  });
});

describe("returns going back on the shelf", () => {
  it("good and torn-pouch returns restock; damaged, wrong or missing don't", () => {
    expect(RESTOCK_CONDITIONS.has("GOOD_RESTOCKABLE")).toBe(true);
    expect(RESTOCK_CONDITIONS.has("DAMAGED_PACKAGING")).toBe(true);
    for (const c of ["DAMAGED_ITEM", "WRONG_OR_SWAPPED_ITEM", "MISSING_PIECE"]) expect(RESTOCK_CONDITIONS.has(c)).toBe(false);
  });
});

describe("planPushes", () => {
  const row = (id: string, target: number, pushedStock: number | null): PushCandidate => ({
    listingVariantId: id,
    platform: Platform.SHOPEE,
    shopConnectionId: "s",
    listingId: "9001",
    variationId: id,
    warehouseId: null,
    target,
    pushedStock,
  });

  it("only sends listings whose number changed, lowest stock first", () => {
    const plan = planPushes([row("a", 10, 10), row("b", 5, 6), row("c", 0, 2), row("d", 7, null)]);
    expect(plan.map((p) => p.listingVariantId)).toEqual(["c", "b", "d"]);
  });
});

describe("recordStaffStockReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.garmentVariant.findUniqueOrThrow.mockResolvedValue({
      id: "gv-1",
      label: "Black, M",
      startingStockSetAt: new Date("2026-11-20T00:00:00Z"),
      garment: { name: "Ribbed Crop Top" },
      listings: [],
    });
    mockPrisma.stockMovement.groupBy.mockResolvedValue([
      { garmentVariantId: "gv-1", _sum: { delta: 7 } },
    ]);
    mockPrisma.stockMovement.create.mockResolvedValue({ id: "sm-1" });
  });

  it("zeros out shelf count for EMPTY_SHELF and records staff audit note", async () => {
    const res = await recordStaffStockReport({
      variantId: "gv-1",
      mode: "EMPTY_SHELF",
      staffMemberId: "staff-1",
      staffName: "Ana",
      clientKey: "key-empty-1",
    });

    expect(res).toEqual({
      duplicate: false,
      garmentName: "Ribbed Crop Top",
      variantLabel: "Black, M",
      previousOnShelf: 7,
      newOnShelf: 0,
      delta: -7,
    });
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        garmentVariantId: "gv-1",
        delta: -7,
        reason: "ADJUSTMENT",
        sourceKey: "empty:key-empty-1",
        staffMemberId: "staff-1",
        note: "Shelf empty (0 left) reported by Ana",
      },
    });
  });

  it("deducts DEFECTIVE quantity capped at current shelf count", async () => {
    const res = await recordStaffStockReport({
      variantId: "gv-1",
      mode: "DEFECTIVE",
      quantity: 12,
      note: "Oil stain",
      staffMemberId: "staff-1",
      staffName: "Joy",
      clientKey: "key-defect-1",
    });

    expect(res).toEqual({
      duplicate: false,
      garmentName: "Ribbed Crop Top",
      variantLabel: "Black, M",
      previousOnShelf: 7,
      newOnShelf: 0,
      delta: -7,
    });
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        garmentVariantId: "gv-1",
        delta: -7,
        reason: "ADJUSTMENT",
        sourceKey: "defect:key-defect-1",
        staffMemberId: "staff-1",
        note: "Damaged on shelf (-7): Oil stain",
      },
    });
  });

  it("is idempotent on duplicate clientKey (P2002)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.16.0",
    });
    mockPrisma.stockMovement.create.mockRejectedValueOnce(p2002);

    const res = await recordStaffStockReport({
      variantId: "gv-1",
      mode: "EMPTY_SHELF",
      staffMemberId: "staff-1",
      staffName: "Ana",
      clientKey: "dup-key-1",
    });

    expect(res.duplicate).toBe(true);
    expect(res.delta).toBe(0);
    expect(res.newOnShelf).toBe(7);
  });
});
