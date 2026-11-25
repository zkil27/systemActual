import { DigitalStatus, DisputeStatus, PhysicalCondition, ReturnCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { planReturnAction, type ReturnActionState } from "@/lib/returns/owner-actions";
import { isMissingDiscrepancy, isOverdueRts, isUrgentDeadline } from "@/lib/returns/rules";
import { desiredRestockFromChecks, desiredReturnRestock } from "@/lib/stock/ledger";

const NOW = new Date("2026-11-23T04:00:00Z");

const base: ReturnActionState = {
  disputeStatus: DisputeStatus.NONE,
  disputeFiledAt: null,
  disputeRef: null,
  reimbursedPhp: null,
  resolvedAt: null,
  resolvedNote: null,
  physicalCondition: null,
  physicallyReceivedAt: null,
};

describe("dispute lifecycle", () => {
  it("filing stamps the filed time once and keeps the parcel open", () => {
    const plan = planReturnAction(base, { action: "set_dispute", status: DisputeStatus.FILED, ref: "C-1" }, NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data).toMatchObject({ disputeStatus: "FILED", disputeFiledAt: NOW, disputeRef: "C-1", reimbursedPhp: null });
    expect(plan.data.resolvedAt).toBeUndefined();

    const earlier = new Date("2026-11-20T00:00:00Z");
    const again = planReturnAction(
      { ...base, disputeStatus: DisputeStatus.FILED, disputeFiledAt: earlier },
      { action: "set_dispute", status: DisputeStatus.FILED, ref: "C-2" },
      NOW
    );
    expect(again.ok && again.data.disputeFiledAt).toEqual(earlier);
  });

  it("won settles the parcel and records the money back", () => {
    const plan = planReturnAction(
      { ...base, disputeStatus: DisputeStatus.FILED, disputeFiledAt: NOW },
      { action: "set_dispute", status: DisputeStatus.WON, reimbursedPhp: 122 },
      NOW
    );
    expect(plan.ok && plan.data).toMatchObject({ disputeStatus: "WON", reimbursedPhp: 122, resolvedAt: NOW, resolvedNote: "Dispute won" });
    expect(plan.ok && plan.event.description).toContain("₱122.00 back");
  });

  it("lost settles without money; moving back to filed reopens", () => {
    const lost = planReturnAction(base, { action: "set_dispute", status: DisputeStatus.LOST }, NOW);
    expect(lost.ok && lost.data).toMatchObject({ resolvedAt: NOW, reimbursedPhp: null });

    const reopened = planReturnAction(
      { ...base, disputeStatus: DisputeStatus.LOST, resolvedAt: NOW, resolvedNote: "Dispute lost" },
      { action: "set_dispute", status: DisputeStatus.FILED },
      NOW
    );
    expect(reopened.ok && reopened.data).toMatchObject({ resolvedAt: null, resolvedNote: null });
  });

  it("clearing a dispute wipes filed time and reimbursement", () => {
    const plan = planReturnAction(
      { ...base, disputeStatus: DisputeStatus.FILED, disputeFiledAt: NOW },
      { action: "set_dispute", status: DisputeStatus.NONE },
      NOW
    );
    expect(plan.ok && plan.data).toMatchObject({ disputeStatus: "NONE", disputeFiledAt: null, reimbursedPhp: null });
  });
});

describe("resolve / reopen / correct", () => {
  it("found and settled close the case with a note", () => {
    const found = planReturnAction(base, { action: "resolve", outcome: "FOUND", note: "under the table" }, NOW);
    expect(found.ok && found.data).toEqual({ resolvedAt: NOW, resolvedNote: "Found: under the table" });
    const settled = planReturnAction(base, { action: "resolve", outcome: "SETTLED" }, NOW);
    expect(settled.ok && settled.data).toEqual({ resolvedAt: NOW, resolvedNote: "Settled" });
  });

  it("reopen refuses an open parcel", () => {
    expect(planReturnAction(base, { action: "reopen" }, NOW)).toMatchObject({ ok: false, status: 409 });
    expect(planReturnAction({ ...base, resolvedAt: NOW }, { action: "reopen" }, NOW)).toMatchObject({ ok: true });
  });

  it("condition fixes need a scanned parcel and a real change", () => {
    const fix = { action: "correct_condition" as const, condition: PhysicalCondition.DAMAGED_ITEM };
    expect(planReturnAction(base, fix, NOW)).toMatchObject({ ok: false, status: 409 });
    const scanned = { ...base, physicallyReceivedAt: NOW, physicalCondition: PhysicalCondition.GOOD_RESTOCKABLE };
    expect(planReturnAction(scanned, { ...fix, condition: PhysicalCondition.GOOD_RESTOCKABLE }, NOW)).toMatchObject({ ok: false });
    const plan = planReturnAction(scanned, fix, NOW);
    expect(plan).toMatchObject({ ok: true, conditionChanged: true, data: { physicalCondition: "DAMAGED_ITEM" } });
  });
});

describe("settled parcels leave Missing / Overdue", () => {
  const missing = {
    category: ReturnCategory.FAILED_DELIVERY,
    digitalStatus: DigitalStatus.COURIER_RETURNED,
    expectsPhysicalReturn: true,
    digitalReturnTaggedAt: new Date("2026-11-01T00:00:00Z"),
    courierReturnedToSellerAt: new Date("2026-11-10T00:00:00Z"),
    physicallyReceivedAt: null,
  };
  it("missing until resolved", () => {
    expect(isMissingDiscrepancy(missing)).toBe(true);
    expect(isMissingDiscrepancy({ ...missing, resolvedAt: NOW })).toBe(false);
  });
  it("overdue until resolved", () => {
    const overdue = { ...missing, courierReturnedToSellerAt: null, digitalStatus: DigitalStatus.RETURNING_TO_SELLER };
    expect(isOverdueRts(overdue, 10, NOW)).toBe(true);
    expect(isOverdueRts({ ...overdue, resolvedAt: NOW }, 10, NOW)).toBe(false);
  });
});

describe("urgent dispute deadline", () => {
  const at = (h: number) => new Date(NOW.getTime() + h * 3600_000);
  it("is due within 24h or passed under 2h ago", () => {
    expect(isUrgentDeadline({ disputeDeadlineAt: at(5) }, NOW)).toBe(true);
    expect(isUrgentDeadline({ disputeDeadlineAt: at(-1) }, NOW)).toBe(true);
    expect(isUrgentDeadline({ disputeDeadlineAt: at(-3) }, NOW)).toBe(false);
    expect(isUrgentDeadline({ disputeDeadlineAt: at(30) }, NOW)).toBe(false);
    expect(isUrgentDeadline({ disputeDeadlineAt: null }, NOW)).toBe(false);
  });
  it("stops being urgent once filed, settled or cancelled", () => {
    expect(isUrgentDeadline({ disputeDeadlineAt: at(5), disputeStatus: "FILED" }, NOW)).toBe(false);
    expect(isUrgentDeadline({ disputeDeadlineAt: at(5), resolvedAt: NOW }, NOW)).toBe(false);
    expect(
      isUrgentDeadline({ disputeDeadlineAt: at(5), digitalStatus: DigitalStatus.CANCELLED_RETURN }, NOW)
    ).toBe(false);
  });
});

describe("restock after a condition fix", () => {
  const items = [
    { variantId: "v1", quantity: 2 },
    { variantId: "v1", quantity: 1 },
    { variantId: "v2", quantity: 0 },
  ];
  it("restockable conditions put every piece back (at least one per line)", () => {
    expect([...desiredReturnRestock("GOOD_RESTOCKABLE", items)]).toEqual([
      ["v1", 3],
      ["v2", 1],
    ]);
    expect(desiredReturnRestock("DAMAGED_PACKAGING", items).get("v1")).toBe(3);
  });
  it("damaged or wrong items put nothing back", () => {
    expect(desiredReturnRestock("DAMAGED_ITEM", items).size).toBe(0);
    expect(desiredReturnRestock(null, items).size).toBe(0);
  });
});

describe("desiredRestockFromChecks", () => {
  it("puts back only the good pieces of each item, adding lines of the same variant", () => {
    expect([
      ...desiredRestockFromChecks([
        { variantId: "v1", goodQty: 2 },
        { variantId: "v2", goodQty: 0 },
        { variantId: "v1", goodQty: 1 },
      ]),
    ]).toEqual([
      ["v1", 3],
      ["v2", 0],
    ]);
  });
});
