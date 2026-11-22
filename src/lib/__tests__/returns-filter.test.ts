import { describe, expect, it } from "vitest";
import {
  EMPTY_DATE_FILTER,
  RETURN_DATE_PRESETS,
  RETURN_FILTERS,
  hasActiveDateFilter,
  parseReturnDateFilter,
  parseReturnFilter,
  returnsUrl,
} from "@/lib/ui/returns-filter";

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
    for (const id of ["returned", "arrived", "missing", "failed", "refund", "overdue"]) {
      expect(parseReturnFilter(id)).toBe(id);
    }
    expect(RETURN_FILTERS.some((f) => f.id === "returned")).toBe(true);
    expect(RETURN_FILTERS.some((f) => f.id === "arrived")).toBe(true);
    expect(returnsUrl("returned", { range: "today" })).toBe("/returns?filter=returned&range=today");
    expect(returnsUrl("arrived", { range: "today" })).toBe("/returns?filter=arrived&range=today");
  });

  it("round-trips date presets and custom date ranges through the URL", () => {
    for (const p of RETURN_DATE_PRESETS) {
      const url = new URL(returnsUrl("failed", { ...EMPTY_DATE_FILTER, range: p.id }), "http://x");
      const parsed = parseReturnDateFilter(url.searchParams);
      expect(parsed.range).toBe(p.id);
      expect(hasActiveDateFilter(parsed)).toBe(p.id !== "all");
    }

    const customUrl = new URL(
      returnsUrl("all", { from: "2026-11-10", to: "2026-11-20" }),
      "http://x"
    );
    expect(customUrl.pathname + customUrl.search).toBe("/returns?from=2026-11-10&to=2026-11-20");
    expect(parseReturnDateFilter(customUrl.searchParams)).toEqual({
      range: "all",
      date: "",
      from: "2026-11-10",
      to: "2026-11-20",
    });

    const singleDayUrl = new URL(returnsUrl("missing", { date: "2026-11-21" }), "http://x");
    expect(parseReturnDateFilter(singleDayUrl.searchParams)).toEqual({
      range: "all",
      date: "2026-11-21",
      from: "",
      to: "",
    });
  });

  it("ignores malformed date params", () => {
    const sp = new URLSearchParams({ range: "bogus", from: "not-a-date", to: "2026-11-21" });
    expect(parseReturnDateFilter(sp)).toEqual({
      range: "all",
      date: "",
      from: "",
      to: "2026-11-21",
    });
  });
});
