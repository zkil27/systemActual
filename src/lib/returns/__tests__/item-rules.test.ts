import { describe, expect, it } from "vitest";
import { DigitalStatus, ReturnCategory } from "@prisma/client";
import { isPartialReturn, isRefundedNotBack, isWrongItemReturn } from "../rules";

describe("isPartialReturn / isWrongItemReturn", () => {
  it("reads piece counts when the parcel was checked item by item", () => {
    expect(isPartialReturn({ physicalCondition: "WRONG_OR_SWAPPED_ITEM", piecesMissing: 1, piecesWrong: 1 })).toBe(true);
    expect(isWrongItemReturn({ physicalCondition: "WRONG_OR_SWAPPED_ITEM", piecesMissing: 1, piecesWrong: 1 })).toBe(true);
    expect(isPartialReturn({ physicalCondition: "MISSING_PIECE", piecesMissing: 0, piecesWrong: 0 })).toBe(false);
  });

  it("falls back to the parcel condition for older scans", () => {
    expect(isPartialReturn({ physicalCondition: "MISSING_PIECE" })).toBe(true);
    expect(isPartialReturn({ physicalCondition: "GOOD_RESTOCKABLE", piecesMissing: null })).toBe(false);
    expect(isWrongItemReturn({ physicalCondition: "WRONG_OR_SWAPPED_ITEM", piecesWrong: null })).toBe(true);
    expect(isWrongItemReturn({ physicalCondition: null })).toBe(false);
  });
});

describe("isRefundedNotBack", () => {
  const base = {
    category: ReturnCategory.RETURN_REFUND,
    digitalStatus: DigitalStatus.RESOLVED_REFUNDED,
    expectsPhysicalReturn: true,
    physicallyReceivedAt: null,
    resolvedAt: null,
    digitalReturnTaggedAt: new Date("2026-11-20T00:00:00Z"),
  };

  it("flags a paid refund with nothing scanned back", () => {
    expect(isRefundedNotBack(base)).toBe(true);
  });

  it("ignores failed deliveries, refund-only returns, scanned, closed and pre-go-live parcels", () => {
    expect(isRefundedNotBack({ ...base, category: ReturnCategory.FAILED_DELIVERY })).toBe(false);
    expect(isRefundedNotBack({ ...base, expectsPhysicalReturn: false })).toBe(false);
    expect(isRefundedNotBack({ ...base, physicallyReceivedAt: new Date() })).toBe(false);
    expect(isRefundedNotBack({ ...base, resolvedAt: new Date() })).toBe(false);
    expect(isRefundedNotBack({ ...base, digitalStatus: DigitalStatus.RETURN_IN_TRANSIT })).toBe(false);
    expect(isRefundedNotBack(base, new Date("2026-11-21T00:00:00Z"))).toBe(false);
  });
});
