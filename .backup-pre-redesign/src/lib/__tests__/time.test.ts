import { describe, expect, it } from "vitest";
import {
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
});
