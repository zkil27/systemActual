import { describe, expect, it } from "vitest";
import { RETURN_FILTERS, parseReturnFilter, returnsUrl } from "@/lib/ui/returns-filter";

describe("returns filter URL mapping", () => {
  it("round-trips every filter through the URL", () => {
    for (const f of RETURN_FILTERS) {
      const url = new URL(returnsUrl(f.id), "http://x");
      expect(parseReturnFilter(url.searchParams.get("filter"))).toBe(f.id);
    }
  });

  it("uses the bare /returns path for All", () => {
    expect(returnsUrl("all")).toBe("/returns");
    expect(returnsUrl("missing")).toBe("/returns?filter=missing");
  });

  it("falls back to All for missing or unknown values", () => {
    expect(parseReturnFilter(null)).toBe("all");
    expect(parseReturnFilter("")).toBe("all");
    expect(parseReturnFilter("drop table")).toBe("all");
  });

  it("keeps the filters the Home screen links to", () => {
    for (const id of ["missing", "failed", "refund", "overdue"]) {
      expect(parseReturnFilter(id)).toBe(id);
    }
  });
});
