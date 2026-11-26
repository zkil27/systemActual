import { describe, expect, it } from "vitest";
import {
  applyPoReceive,
  computeReorderSuggestions,
  daysOverdueManila,
  derivePurchaseOrderStatus,
  isPurchaseOrderOverdue,
  needsCostConfirmation,
  redactPurchaseOrderForStaff,
} from "../rules";

describe("derivePurchaseOrderStatus", () => {
  it("keeps CANCELLED unchanged regardless of lines", () => {
    expect(
      derivePurchaseOrderStatus("CANCELLED", [
        { orderedQty: 10, receivedQty: 10, damagedQty: 0 },
      ])
    ).toBe("CANCELLED");
  });

  it("keeps DRAFT or ORDERED when nothing is received yet", () => {
    expect(
      derivePurchaseOrderStatus("DRAFT", [
        { orderedQty: 10, receivedQty: 0, damagedQty: 0 },
      ])
    ).toBe("DRAFT");
    expect(
      derivePurchaseOrderStatus("ORDERED", [
        { orderedQty: 10, receivedQty: 0, damagedQty: 0 },
      ])
    ).toBe("ORDERED");
  });

  it("moves to PARTIAL when some pieces arrive and RECEIVED once all lines hit orderedQty", () => {
    expect(
      derivePurchaseOrderStatus("ORDERED", [
        { orderedQty: 10, receivedQty: 6, damagedQty: 0 },
        { orderedQty: 5, receivedQty: 0, damagedQty: 0 },
      ])
    ).toBe("PARTIAL");

    expect(
      derivePurchaseOrderStatus("PARTIAL", [
        { orderedQty: 10, receivedQty: 9, damagedQty: 1 },
        { orderedQty: 5, receivedQty: 5, damagedQty: 0 },
      ])
    ).toBe("RECEIVED");
  });
});

describe("applyPoReceive", () => {
  it("counts only good pieces toward stock delta while tracking damaged separately", () => {
    const res = applyPoReceive(
      { orderedQty: 20, receivedQty: 5, damagedQty: 1 },
      10,
      2
    );
    expect(res).toEqual({
      nextReceivedQty: 15,
      nextDamagedQty: 3,
      stockDelta: 10,
      remainingAfter: 2,
    });
  });
});

describe("needsCostConfirmation", () => {
  it("flags when PO cost differs from garment cost by >= 0.01", () => {
    expect(needsCostConfirmation(95, 82)).toBe(true);
    expect(needsCostConfirmation(82, null)).toBe(true);
    expect(needsCostConfirmation(82.004, 82)).toBe(false);
    expect(needsCostConfirmation(null, 82)).toBe(false);
    expect(needsCostConfirmation(0, 82)).toBe(false);
  });
});

describe("isPurchaseOrderOverdue", () => {
  it("compares by Manila calendar date so due-today is not marked overdue early", () => {
    // 2026-11-26T12:00:00 Manila (04:00Z)
    const dueNov26 = new Date("2026-11-26T04:00:00.000Z");
    // Still Nov 26 in Manila (2026-11-26 23:30 Manila = 15:30Z)
    const nov26NightManila = new Date("2026-11-26T15:30:00.000Z");
    // Nov 27 in Manila (2026-11-27 00:30 Manila = 2026-11-26T16:30Z)
    const nov27MorningManila = new Date("2026-11-26T16:30:00.000Z");

    expect(
      isPurchaseOrderOverdue({ status: "ORDERED", expectedAt: dueNov26 }, nov26NightManila)
    ).toBe(false);
    expect(
      isPurchaseOrderOverdue({ status: "ORDERED", expectedAt: dueNov26 }, nov27MorningManila)
    ).toBe(true);
    expect(daysOverdueManila(dueNov26, nov27MorningManila)).toBe(1);
    expect(
      isPurchaseOrderOverdue({ status: "RECEIVED", expectedAt: dueNov26 }, nov27MorningManila)
    ).toBe(false);
  });
});

describe("computeReorderSuggestions", () => {
  it("subtracts open PO qty and flags items whose stock will run out inside lead time", () => {
    const out = computeReorderSuggestions([
      {
        variantId: "v-fast",
        garmentId: "g1",
        garmentName: "Ribbed Top",
        variantLabel: "Black, M",
        imageUrl: null,
        binLocation: "A1",
        onShelfCount: 10,
        committed: 2,
        safetyBuffer: 0,
        lowStockThreshold: 5,
        soldLast7Days: 21, // 3/day * 7d lead = 21 > available(8)
        onOrderQty: 0,
        unitCostPhp: 85,
        lastSupplier: { id: "s1", name: "Tahian A", leadTimeDays: 7 },
      },
      {
        variantId: "v-covered",
        garmentId: "g2",
        garmentName: "Wrap Skirt",
        variantLabel: "Cream, S",
        imageUrl: null,
        binLocation: null,
        onShelfCount: 4,
        committed: 0,
        safetyBuffer: 0,
        lowStockThreshold: 5,
        soldLast7Days: 7,
        onOrderQty: 30, // plenty incoming -> excluded
        unitCostPhp: 120,
        lastSupplier: { id: "s1", name: "Tahian A", leadTimeDays: 7 },
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].variantId).toBe("v-fast");
    expect(out[0].urgency).toBe("urgent");
    expect(out[0].suggestedQty).toBeGreaterThan(0);
  });
});

describe("redactPurchaseOrderForStaff", () => {
  it("strips all peso costs, costUpdatePending, and supplier private contact/notes", () => {
    const safe = redactPurchaseOrderForStaff({
      id: "po-1",
      poNumber: "PO-20261126-001",
      status: "ORDERED",
      expectedAt: new Date("2026-11-30T04:00:00.000Z"),
      note: "Check stitching",
      totalCostPhp: 8500,
      supplier: {
        id: "sup-1",
        name: "Tahian A",
        contact: "0917-000-0000",
        notes: "Private price discount",
      },
      lines: [
        {
          id: "line-1",
          garmentVariantId: "var-1",
          orderedQty: 50,
          receivedQty: 10,
          damagedQty: 2,
          unitCostPhp: 170,
          costUpdatePending: true,
          note: "Secret cost note",
          garmentVariant: {
            id: "var-1",
            label: "Black, M",
            garment: {
              id: "g-1",
              name: "Ribbed Top",
              imageUrl: null,
              binLocation: "A3",
              unitCostPhp: 160,
            },
          },
        },
      ],
    });

    const json = JSON.stringify(safe);
    expect(json).not.toContain("totalCostPhp");
    expect(json).not.toContain("unitCostPhp");
    expect(json).not.toContain("costUpdatePending");
    expect(json).not.toContain("0917-000-0000");
    expect(json).not.toContain("Private price discount");
    expect(json).not.toContain("8500");
    expect(json).not.toContain("170");
    expect(safe.lines[0].remainingQty).toBe(38);
  });
});
