import { describe, expect, it } from "vitest";
import {
  getManilaDateRangeBounds,
  getManilaDateString,
  getManilaDayBounds,
  isWithinBounds,
} from "@/lib/time";

describe("Asia/Manila (UTC+8) calendar boundaries", () => {
  it("maps 23:55 Manila time to the same Manila calendar day, not next UTC day", () => {
    const { start, end } = getManilaDayBounds("2026-11-20");
    // 2026-11-20 23:55:00+08:00 == 2026-11-20 15:55:00Z
    const lateManila = new Date("2026-11-20T23:55:00+08:00");
    expect(getManilaDateString(lateManila)).toBe("2026-11-20");
    expect(isWithinBounds(lateManila, start, end)).toBe(true);
  });

  it("maps 00:05 Manila time to the next Manila calendar day, even though UTC is still previous day", () => {
    const { start, end } = getManilaDayBounds("2026-11-21");
    // 2026-11-21 00:05:00+08:00 == 2026-11-20 16:05:00Z
    const earlyManila = new Date("2026-11-21T00:05:00+08:00");
    expect(getManilaDateString(earlyManila)).toBe("2026-11-21");
    expect(isWithinBounds(earlyManila, start, end)).toBe(true);

    const prevBounds = getManilaDayBounds("2026-11-20");
    expect(isWithinBounds(earlyManila, prevBounds.start, prevBounds.end)).toBe(false);
  });

  it("computes Manila preset and custom inclusive date range bounds", () => {
    const now = new Date("2026-11-21T13:30:00+08:00");
    expect(getManilaDateRangeBounds({ range: "all", now })).toBeNull();

    const today = getManilaDateRangeBounds({ range: "today", now })!;
    expect(today.start?.toISOString()).toBe("2026-11-20T16:00:00.000Z");
    expect(today.end?.toISOString()).toBe("2026-11-21T16:00:00.000Z");

    const seven = getManilaDateRangeBounds({ range: "7days", now })!;
    expect(seven.start?.toISOString()).toBe("2026-11-14T16:00:00.000Z");
    expect(seven.end?.toISOString()).toBe("2026-11-21T16:00:00.000Z");

    // Reversed from/to still produces valid ordered bounds
    const reversed = getManilaDateRangeBounds({ from: "2026-11-20", to: "2026-11-18", now })!;
    expect(reversed.start?.toISOString()).toBe("2026-11-17T16:00:00.000Z");
    expect(reversed.end?.toISOString()).toBe("2026-11-20T16:00:00.000Z");
  });
});
