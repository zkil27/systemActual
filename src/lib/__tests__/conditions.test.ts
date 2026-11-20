import { describe, expect, it } from "vitest";
import {
  CONDITIONS,
  DEFAULT_CONDITION,
  conditionLabel,
  findCondition,
  isIssueCondition,
} from "@/lib/ui/conditions";
import { ISSUE_CONDITIONS } from "@/lib/ui/parcel-status";

describe("scan conditions", () => {
  it("asks for a photo exactly for damaged, swapped and missing-piece returns", () => {
    const needsPhoto = CONDITIONS.filter((c) => c.needsPhoto).map((c) => c.id).sort();
    expect(needsPhoto).toEqual(["DAMAGED_ITEM", "MISSING_PIECE", "WRONG_OR_SWAPPED_ITEM"]);
  });

  it("agrees with the Issue status used on Home and Returns", () => {
    for (const c of CONDITIONS) {
      expect(isIssueCondition(c.id), c.id).toBe(ISSUE_CONDITIONS.has(c.id));
    }
  });

  it("covers every condition the database accepts", () => {
    expect(CONDITIONS.map((c) => c.id).sort()).toEqual(
      ["DAMAGED_ITEM", "DAMAGED_PACKAGING", "GOOD_RESTOCKABLE", "MISSING_PIECE", "WRONG_OR_SWAPPED_ITEM"]
    );
  });

  it("defaults to good and resellable", () => {
    expect(findCondition(DEFAULT_CONDITION)?.tone).toBe("good");
  });

  it("labels unknown or empty conditions as not checked", () => {
    expect(conditionLabel(null)).toBe("Not checked");
    expect(conditionLabel("SOMETHING_ELSE")).toBe("Not checked");
  });
});
