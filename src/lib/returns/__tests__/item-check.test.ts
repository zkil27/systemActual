import { describe, expect, it } from "vitest";
import { ItemCheckResult, PhysicalCondition, ReturnCategory } from "@prisma/client";
import {
  applyItemChecks,
  checkFromCondition,
  deriveParcelCondition,
  describeLine,
  expectedLinesFromItems,
  isSinglePiece,
  lineKeyOf,
  priceLines,
  returnCheckSummary,
  summaryFromStoredChecks,
  type CheckedLine,
} from "../item-check";

const top = { name: "Ribbed Top", variationName: "Black, M", quantity: 2, imageUrl: "a.jpg", listingId: "9001", variationId: "77" };
const skirt = { name: "Tennis Skirt", variationName: "White, S", quantity: 1, imageUrl: null, listingId: "9002", variationId: "88", unitPricePhp: 249 };

function ok(res: ReturnType<typeof applyItemChecks>): CheckedLine[] {
  if (!res.ok) throw new Error(res.error);
  return res.lines;
}

describe("lineKeyOf", () => {
  it("uses ids when the shop gave them", () => {
    expect(lineKeyOf(top)).toBe("9001:77");
  });
  it("falls back to name and colour/size, ignoring case", () => {
    expect(lineKeyOf({ name: "Ribbed Top", variationName: "Black" })).toBe(lineKeyOf({ name: "ribbed top", variationName: "BLACK" }));
  });
});

describe("expectedLinesFromItems", () => {
  it("merges one-line-per-piece TikTok items and keeps a price", () => {
    const lines = expectedLinesFromItems([
      { ...top, quantity: 1 },
      { ...top, quantity: 1, unitPricePhp: 199 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineKey: "9001:77", quantity: 2, unitPricePhp: 199 });
  });

  it("accepts numeric ids and skips junk entries", () => {
    const lines = expectedLinesFromItems([null, "x", { name: "" }, { name: "Shorts", listingId: 5, variationId: 6, quantity: "3" }]);
    expect(lines).toEqual([
      expect.objectContaining({ lineKey: "5:6", quantity: 3, unitPricePhp: null }),
    ]);
  });

  it("returns nothing for a parcel without an item list", () => {
    expect(expectedLinesFromItems(null)).toEqual([]);
  });

  it("treats a zero or missing quantity as one piece", () => {
    expect(expectedLinesFromItems([{ name: "Tee", quantity: 0 }])[0].quantity).toBe(1);
  });
});

describe("isSinglePiece", () => {
  it("is true only for one line of one piece", () => {
    expect(isSinglePiece(expectedLinesFromItems([skirt]))).toBe(true);
    expect(isSinglePiece(expectedLinesFromItems([top]))).toBe(false);
    expect(isSinglePiece(expectedLinesFromItems([skirt, { ...top, quantity: 1 }]))).toBe(false);
  });
});

describe("applyItemChecks", () => {
  const expected = expectedLinesFromItems([top, skirt]);

  it("counts every untouched piece as received good", () => {
    const lines = ok(applyItemChecks(expected, []));
    expect(lines.map((l) => [l.goodQty, l.result])).toEqual([
      [2, ItemCheckResult.ALL_GOOD],
      [1, ItemCheckResult.ALL_GOOD],
    ]);
  });

  it("splits a line between good and the marked problem", () => {
    const [first] = ok(applyItemChecks(expected, [{ lineKey: "9001:77", missing: 1 }]));
    expect(first).toMatchObject({ goodQty: 1, missingQty: 1, result: ItemCheckResult.SOME_MISSING });
  });

  it("reports the worst problem on a line", () => {
    const [first] = ok(applyItemChecks(expected, [{ lineKey: "9001:77", damaged: 1, wrong: 1 }]));
    expect(first.result).toBe(ItemCheckResult.WRONG_ITEM);
    expect(first.goodQty).toBe(0);
  });

  it("rejects more pieces than expected", () => {
    const res = applyItemChecks(expected, [{ lineKey: "9002:88", missing: 1, damaged: 1 }]);
    expect(res.ok).toBe(false);
  });

  it("rejects unknown or duplicate lines and bad counts", () => {
    expect(applyItemChecks(expected, [{ lineKey: "nope", missing: 1 }]).ok).toBe(false);
    expect(applyItemChecks(expected, [{ lineKey: "9002:88" }, { lineKey: "9002:88" }]).ok).toBe(false);
    expect(applyItemChecks(expected, [{ lineKey: "9002:88", missing: -1 }]).ok).toBe(false);
    expect(applyItemChecks(expected, [{ lineKey: "9002:88", missing: 0.5 }]).ok).toBe(false);
  });
});

describe("checkFromCondition", () => {
  const [line] = expectedLinesFromItems([skirt]);
  it.each([
    [PhysicalCondition.GOOD_RESTOCKABLE, { goodQty: 1 }],
    [PhysicalCondition.DAMAGED_PACKAGING, { goodQty: 1 }],
    [PhysicalCondition.DAMAGED_ITEM, { damagedQty: 1, goodQty: 0 }],
    [PhysicalCondition.WRONG_OR_SWAPPED_ITEM, { wrongQty: 1, goodQty: 0 }],
    [PhysicalCondition.MISSING_PIECE, { missingQty: 1, goodQty: 0 }],
  ])("maps %s", (condition, expectedCounts) => {
    expect(checkFromCondition(line, condition)).toMatchObject(expectedCounts);
  });
});

describe("deriveParcelCondition", () => {
  const expected = expectedLinesFromItems([top, skirt]);
  const lines = (input: Parameters<typeof applyItemChecks>[1]) => ok(applyItemChecks(expected, input));

  it("is good when everything came back", () => {
    expect(deriveParcelCondition(lines([]), false)).toBe(PhysicalCondition.GOOD_RESTOCKABLE);
  });
  it("is packaging-only when just the pouch is torn", () => {
    expect(deriveParcelCondition(lines([]), true)).toBe(PhysicalCondition.DAMAGED_PACKAGING);
  });
  it("lets the worst item win: wrong > missing > damaged", () => {
    expect(deriveParcelCondition(lines([{ lineKey: "9001:77", damaged: 1 }]), true)).toBe(PhysicalCondition.DAMAGED_ITEM);
    expect(
      deriveParcelCondition(lines([{ lineKey: "9001:77", damaged: 1 }, { lineKey: "9002:88", missing: 1 }]), false)
    ).toBe(PhysicalCondition.MISSING_PIECE);
    expect(
      deriveParcelCondition(lines([{ lineKey: "9001:77", missing: 2 }, { lineKey: "9002:88", wrong: 1 }]), false)
    ).toBe(PhysicalCondition.WRONG_OR_SWAPPED_ITEM);
  });
});

describe("priceLines + returnCheckSummary", () => {
  const expected = expectedLinesFromItems([top, skirt]);

  it("uses the shop's price where known and splits the refund for the rest", () => {
    const priced = priceLines(ok(applyItemChecks(expected, [])), ReturnCategory.RETURN_REFUND, 447);
    expect(priced.map((l) => [l.pricePhp, l.priceSource])).toEqual([
      [149, "PRO_RATA"],
      [249, "RETURN"],
    ]);
  });

  it("values only what came back; wrong items count as nothing", () => {
    const lines = ok(applyItemChecks(expected, [{ lineKey: "9001:77", missing: 1 }, { lineKey: "9002:88", wrong: 1 }]));
    const summary = returnCheckSummary(priceLines(lines, ReturnCategory.RETURN_REFUND, 447));
    expect(summary).toEqual({
      piecesExpected: 3,
      piecesGood: 1,
      piecesDamaged: 0,
      piecesWrong: 1,
      piecesMissing: 1,
      receivedValuePhp: 149,
      valueIsEstimate: true,
    });
  });

  it("counts damaged pieces as came back", () => {
    const lines = ok(applyItemChecks(expectedLinesFromItems([skirt]), [{ lineKey: "9002:88", damaged: 1 }]));
    expect(returnCheckSummary(priceLines(lines, ReturnCategory.RETURN_REFUND, 249)).receivedValuePhp).toBe(249);
  });

  it("labels known prices from a failed delivery as order prices", () => {
    const priced = priceLines(ok(applyItemChecks(expectedLinesFromItems([skirt]), [])), ReturnCategory.FAILED_DELIVERY, 249);
    expect(priced[0].priceSource).toBe("ORDER_LINE");
  });

  it("leaves the value at zero when nothing is known", () => {
    const priced = priceLines(ok(applyItemChecks(expectedLinesFromItems([{ name: "Tee" }]), [])), ReturnCategory.RETURN_REFUND, 0);
    expect(priced[0]).toMatchObject({ pricePhp: null, priceSource: null });
    expect(returnCheckSummary(priced)).toMatchObject({ receivedValuePhp: 0, valueIsEstimate: false });
  });
});

describe("describeLine", () => {
  it("says what came back in plain words", () => {
    const [first] = ok(applyItemChecks(expectedLinesFromItems([top]), [{ lineKey: "9001:77", missing: 1 }]));
    expect(describeLine(first)).toBe("Ribbed Top (Black, M): expected 2 — 1 good, 1 missing");
  });
});

describe("summaryFromStoredChecks", () => {
  it("clears the summary when the remaining scan had no item check", () => {
    expect(summaryFromStoredChecks([], new Date())).toEqual({
      piecesGood: null,
      piecesDamaged: null,
      piecesWrong: null,
      piecesMissing: null,
      receivedValuePhp: null,
      itemCheckedAt: null,
    });
  });

  it("adds up saved lines, valuing good and damaged pieces", () => {
    const at = new Date("2026-11-26T01:00:00Z");
    expect(
      summaryFromStoredChecks(
        [
          { goodQty: 1, damagedQty: 1, wrongQty: 0, missingQty: 0, unitPricePhp: "199.00" },
          { goodQty: 0, damagedQty: 0, wrongQty: 1, missingQty: 1, unitPricePhp: null },
        ],
        at
      )
    ).toEqual({ piecesGood: 1, piecesDamaged: 1, piecesWrong: 1, piecesMissing: 1, receivedValuePhp: 398, itemCheckedAt: at });
  });
});
