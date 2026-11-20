import { describe, expect, it } from "vitest";
import { categoryLabel, getParcelStatus } from "@/lib/ui/parcel-status";

const base = {
  isMissingDiscrepancy: false,
  physicalCondition: null,
  physicallyReceivedAt: null,
  isOverdueRts: false,
};

describe("getParcelStatus", () => {
  it("is On the way when nothing has happened yet", () => {
    expect(getParcelStatus(base)).toEqual({ label: "On the way", tone: "neutral" });
  });

  it("is Arrived once staff scanned it in good condition", () => {
    expect(
      getParcelStatus({
        ...base,
        physicallyReceivedAt: "2026-11-21T03:00:00Z",
        physicalCondition: "GOOD_RESTOCKABLE",
      })
    ).toEqual({ label: "Arrived", tone: "arrived" });
  });

  it("torn packaging alone still counts as Arrived", () => {
    expect(
      getParcelStatus({
        ...base,
        physicallyReceivedAt: "2026-11-21T03:00:00Z",
        physicalCondition: "DAMAGED_PACKAGING",
      }).label
    ).toBe("Arrived");
  });

  it("is Issue for damaged, swapped or incomplete items, even though they arrived", () => {
    for (const physicalCondition of ["DAMAGED_ITEM", "WRONG_OR_SWAPPED_ITEM", "MISSING_PIECE"]) {
      expect(
        getParcelStatus({ ...base, physicallyReceivedAt: "2026-11-21T03:00:00Z", physicalCondition })
      ).toEqual({ label: "Issue", tone: "issue" });
    }
  });

  it("Missing wins over every other state", () => {
    expect(
      getParcelStatus({
        ...base,
        isMissingDiscrepancy: true,
        physicalCondition: "DAMAGED_ITEM",
        isOverdueRts: true,
      }).label
    ).toBe("Missing");
  });

  it("is Overdue only when not yet arrived", () => {
    expect(getParcelStatus({ ...base, isOverdueRts: true }).label).toBe("Overdue");
    expect(
      getParcelStatus({ ...base, isOverdueRts: true, physicallyReceivedAt: "2026-11-21T03:00:00Z" })
        .label
    ).toBe("Arrived");
  });
});

describe("categoryLabel", () => {
  it("keeps Failed delivery and Buyer return as separate words", () => {
    expect(categoryLabel("FAILED_DELIVERY")).toBe("Failed delivery");
    expect(categoryLabel("RETURN_REFUND")).toBe("Buyer return");
  });
});
