import { describe, expect, it } from "vitest";
import { stepSelection } from "@/lib/ui/returns-nav";

describe("stepSelection", () => {
  it("returns null for an empty list", () => {
    expect(stepSelection([], null, 1)).toBeNull();
    expect(stepSelection([], "a", -1)).toBeNull();
  });

  it("picks first on down and last on up when nothing is selected", () => {
    expect(stepSelection(["a", "b", "c"], null, 1)).toBe("a");
    expect(stepSelection(["a", "b", "c"], null, -1)).toBe("c");
  });

  it("treats an unknown current id like no selection", () => {
    expect(stepSelection(["a", "b", "c"], "missing", 1)).toBe("a");
    expect(stepSelection(["a", "b", "c"], "missing", -1)).toBe("c");
  });

  it("steps forward and backward through the list", () => {
    expect(stepSelection(["a", "b", "c"], "a", 1)).toBe("b");
    expect(stepSelection(["a", "b", "c"], "b", 1)).toBe("c");
    expect(stepSelection(["a", "b", "c"], "c", -1)).toBe("b");
    expect(stepSelection(["a", "b", "c"], "b", -1)).toBe("a");
  });

  it("clamps at the start and end of the list", () => {
    expect(stepSelection(["a", "b", "c"], "a", -1)).toBe("a");
    expect(stepSelection(["a", "b", "c"], "c", 1)).toBe("c");
    expect(stepSelection(["only"], "only", 1)).toBe("only");
    expect(stepSelection(["only"], "only", -1)).toBe("only");
  });
});
