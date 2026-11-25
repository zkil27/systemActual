import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { returnCheckLine, summarizeReturnChecks } from "@/lib/analytics/return-check";

const at = new Date("2026-11-26T02:00:00Z");

describe("summarizeReturnChecks", () => {
  it("counts partial and wrong-item parcels and how much is short", () => {
    const s = summarizeReturnChecks(
      [
        // 3 pieces refunded ₱447, 1 came back worth ₱149.
        { physicalCondition: "MISSING_PIECE", piecesMissing: 2, piecesWrong: 0, itemCheckedAt: at, orderTotalPhp: 447, receivedValuePhp: 149 },
        // Wrong item: nothing of value came back.
        { physicalCondition: "WRONG_OR_SWAPPED_ITEM", piecesMissing: 0, piecesWrong: 1, itemCheckedAt: at, orderTotalPhp: 199, receivedValuePhp: 0 },
        // All good.
        { physicalCondition: "GOOD_RESTOCKABLE", piecesMissing: 0, piecesWrong: 0, itemCheckedAt: at, orderTotalPhp: 199, receivedValuePhp: 199 },
        // Old parcel-level scan: counted, no money estimate.
        { physicalCondition: "MISSING_PIECE", piecesMissing: null, piecesWrong: null, itemCheckedAt: null, orderTotalPhp: 199, receivedValuePhp: null },
      ],
      { count: 2, totalPhp: 398.4 }
    );
    expect(s).toEqual({
      arrivedCount: 4,
      itemCheckedCount: 3,
      partialCount: 2,
      wrongItemCount: 1,
      shortPhp: 497,
      refundedNotBackCount: 2,
      refundedNotBackPhp: 398,
    });
  });
});

describe("returnCheckLine", () => {
  it("is quiet on a clean day", () => {
    expect(returnCheckLine(summarizeReturnChecks([], { count: 0, totalPhp: 0 }))).toBeNull();
  });
  it("names what to look at", () => {
    expect(
      returnCheckLine({
        arrivedCount: 5,
        itemCheckedCount: 5,
        partialCount: 2,
        wrongItemCount: 1,
        shortPhp: 398,
        refundedNotBackCount: 0,
        refundedNotBackPhp: 0,
      })
    ).toBe("2 partial returns · 1 wrong item · PHP 398 refunded for pieces not back");
  });
});
