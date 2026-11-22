import { describe, expect, it } from "vitest";
import { formatBadgeCount, formatPeso, manilaDayLabel, shortCourier, updatedAgo } from "@/lib/ui/format";

describe("formatBadgeCount", () => {
  it("hides the badge at zero or below", () => {
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(-3)).toBeNull();
    expect(formatBadgeCount(Number.NaN)).toBeNull();
  });

  it("shows the count up to 99, then 99+", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(2000)).toBe("99+");
  });
});

describe("small formatters", () => {
  it("formats pesos without decimals", () => {
    expect(formatPeso(1640)).toBe("₱1,640");
    expect(formatPeso(81.6)).toBe("₱82");
  });

  it("drops the Express suffix from courier names", () => {
    expect(shortCourier("SPX Express")).toBe("SPX");
    expect(shortCourier("J&T Express")).toBe("J&T");
    expect(shortCourier("Ninja Van")).toBe("Ninja Van");
  });

  it("labels a Manila calendar date without shifting the day", () => {
    expect(manilaDayLabel("2026-11-18")).toBe("Nov 18");
    expect(manilaDayLabel("2026-01-01")).toBe("Jan 1");
  });
});

describe("updatedAgo", () => {
  const now = Date.parse("2026-11-22T10:00:00Z");
  it("reads naturally for recent times", () => {
    expect(updatedAgo(null, now)).toBe("");
    expect(updatedAgo("2026-11-22T09:59:40Z", now)).toBe("just now");
    expect(updatedAgo("2026-11-22T09:56:00Z", now)).toBe("4 min ago");
    expect(updatedAgo("2026-11-22T07:30:00Z", now)).toBe("2 hr ago");
  });
  it("falls back to a date after a day", () => {
    expect(updatedAgo("2026-11-20T10:00:00Z", now)).not.toMatch(/ago/);
  });
});
