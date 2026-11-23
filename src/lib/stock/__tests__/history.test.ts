import { StockReason } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isUndoable, UNDO_WINDOW_MS, withRunningBalance } from "@/lib/stock/history";
import { effectiveBuffer, effectiveLowStock, DEFAULT_LOW_STOCK } from "@/lib/catalog/garments";

describe("stock history", () => {
  it("walks the running balance back from today's count", () => {
    // Newest first: +10 delivery, -2 shipped, starting 20 → now 28.
    const rows = withRunningBalance([{ delta: 10 }, { delta: -2 }, { delta: 20 }], 28);
    expect(rows.map((r) => r.balanceAfter)).toEqual([28, 18, 20]);
  });

  it("only fresh supplier deliveries can be undone", () => {
    const now = new Date("2026-11-23T04:00:00Z");
    const fresh = { reason: StockReason.SUPPLIER_IN, sourceKey: "in:abc", createdAt: new Date(now.getTime() - 60_000) };
    expect(isUndoable(fresh, now)).toBe(true);
    expect(isUndoable({ ...fresh, createdAt: new Date(now.getTime() - UNDO_WINDOW_MS - 1) }, now)).toBe(false);
    expect(isUndoable({ ...fresh, reason: StockReason.ADJUSTMENT }, now)).toBe(false);
    expect(isUndoable({ ...fresh, sourceKey: "undo:abc" }, now)).toBe(false);
  });
});

describe("per-garment overrides", () => {
  it("falls back to the shop-wide buffer and the default low-stock line", () => {
    expect(effectiveBuffer(null, 3)).toBe(3);
    expect(effectiveBuffer(undefined, 3)).toBe(3);
    expect(effectiveBuffer(0, 3)).toBe(0);
    expect(effectiveBuffer(-4, 3)).toBe(0);
    expect(effectiveLowStock(null)).toBe(DEFAULT_LOW_STOCK);
    expect(effectiveLowStock(12)).toBe(12);
  });
});
