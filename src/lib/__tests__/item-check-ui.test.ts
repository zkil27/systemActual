import { describe, expect, it } from "vitest";
import {
  clearMark,
  conditionFromMarks,
  countChoices,
  markProblem,
  marksSummary,
  needsItemCheck,
  setMarkCount,
  toSubmission,
} from "@/lib/ui/item-check-ui";

const top = { lineKey: "1:1", quantity: 2 };
const skirt = { lineKey: "2:2", quantity: 1 };

describe("needsItemCheck", () => {
  it("keeps one-piece parcels on the normal buttons", () => {
    expect(needsItemCheck([skirt])).toBe(false);
    expect(needsItemCheck([])).toBe(false);
  });
  it("shows items when there is more than one piece", () => {
    expect(needsItemCheck([top])).toBe(true);
    expect(needsItemCheck([skirt, { lineKey: "3:3", quantity: 1 }])).toBe(true);
  });
});

describe("countChoices", () => {
  it("offers a few numbers and All, never a counter", () => {
    expect(countChoices(1)).toEqual([]);
    expect(countChoices(2).map((c) => c.label)).toEqual(["1", "All"]);
    expect(countChoices(6).map((c) => c.label)).toEqual(["1", "2", "3", "All"]);
    expect(countChoices(6).at(-1)?.count).toBe(6);
  });
});

describe("marking", () => {
  it("starts a problem at every piece, then a count narrows it", () => {
    let marks = markProblem({}, top, "MISSING");
    expect(marks[top.lineKey]).toEqual({ problem: "MISSING", count: 2 });
    marks = setMarkCount(marks, top, 1);
    expect(marks[top.lineKey].count).toBe(1);
    // Same problem again keeps the count; a different problem resets it.
    expect(markProblem(marks, top, "MISSING")[top.lineKey].count).toBe(1);
    expect(markProblem(marks, top, "WRONG")[top.lineKey]).toEqual({ problem: "WRONG", count: 2 });
  });

  it("keeps counts inside the line and clears back to received", () => {
    const marks = markProblem({}, top, "DAMAGED");
    expect(setMarkCount(marks, top, 9)[top.lineKey].count).toBe(2);
    expect(setMarkCount({}, top, 1)).toEqual({});
    expect(clearMark(marks, top.lineKey)).toEqual({});
  });
});

describe("toSubmission", () => {
  it("sends only marked lines, as the server reads them", () => {
    const marks = setMarkCount(markProblem(markProblem({}, top, "MISSING"), skirt, "WRONG"), top, 1);
    expect(toSubmission([top, skirt], marks)).toEqual([
      { lineKey: "1:1", missing: 1 },
      { lineKey: "2:2", wrong: 1 },
    ]);
    expect(toSubmission([top, skirt], {})).toEqual([]);
  });
});

describe("conditionFromMarks", () => {
  it("lets the worst item win, like the server", () => {
    expect(conditionFromMarks({}, false)).toBe("GOOD_RESTOCKABLE");
    expect(conditionFromMarks({}, true)).toBe("DAMAGED_PACKAGING");
    expect(conditionFromMarks(markProblem({}, top, "DAMAGED"), true)).toBe("DAMAGED_ITEM");
    expect(conditionFromMarks(markProblem(markProblem({}, top, "DAMAGED"), skirt, "MISSING"), false)).toBe("MISSING_PIECE");
    expect(conditionFromMarks(markProblem(markProblem({}, top, "MISSING"), skirt, "WRONG"), false)).toBe(
      "WRONG_OR_SWAPPED_ITEM"
    );
  });
});

describe("marksSummary", () => {
  it("says how many pieces are fine", () => {
    expect(marksSummary([top, skirt], {})).toBe("All 3 pieces OK");
    expect(marksSummary([top, skirt], setMarkCount(markProblem({}, top, "MISSING"), top, 1))).toBe("2 of 3 pieces OK");
  });
});
