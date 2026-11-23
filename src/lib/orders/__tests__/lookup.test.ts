import { describe, expect, it } from "vitest";
import { buildOrderTimeline, orderHeadline, type TimelineInput } from "@/lib/orders/lookup";
import { buildCourierRates, itemKey, ratePct } from "@/lib/analytics/rates";
import { buildDailySeries, moneyRowsToCsv } from "@/lib/money/breakdown";
import { deadlineCountdown } from "@/lib/ui/dispute";

const t = (h: number) => new Date(Date.UTC(2026, 10, 20, h));

const base: TimelineInput = {
  status: "READY_TO_SHIP",
  cancelRequested: false,
  platformCreatedAt: t(0),
  platformUpdatedAt: t(1),
  shippedAt: null,
  wavedAt: null,
  printedAt: null,
  labelFailed: null,
  packedAt: null,
  packedBy: null,
  creditedAt: null,
  creditedPhp: null,
  returnedAt: null,
  returnLabel: null,
};

describe("order timeline", () => {
  it("walks ordered → credited in order", () => {
    const stages = buildOrderTimeline({
      ...base,
      status: "COMPLETED",
      wavedAt: t(2),
      printedAt: t(3),
      packedAt: t(4),
      packedBy: "Ana",
      shippedAt: t(5),
      platformUpdatedAt: t(30),
      creditedAt: t(40),
      creditedPhp: 168.5,
    });
    expect(stages.map((s) => s.id)).toEqual(["ordered", "waved", "printed", "packed", "handed_over", "delivered", "credited"]);
    expect(stages.every((s) => s.at)).toBe(true);
    expect(stages.find((s) => s.id === "packed")?.detail).toBe("by Ana");
    expect(stages.find((s) => s.id === "credited")?.detail).toBe("₱168.50");
    expect(orderHeadline(stages, "COMPLETED")).toBe("Money credited");
  });

  it("not delivered until the shop says so", () => {
    const stages = buildOrderTimeline({ ...base, status: "SHIPPED", shippedAt: t(5) });
    expect(stages.find((s) => s.id === "delivered")?.at).toBeNull();
    expect(orderHeadline(stages, "SHIPPED")).toBe("Handed to courier");
  });

  it("a return replaces Delivered and is flagged", () => {
    const stages = buildOrderTimeline({ ...base, shippedAt: t(5), returnedAt: t(50), returnLabel: "Returned to seller" });
    expect(stages.some((s) => s.id === "delivered")).toBe(false);
    expect(stages.find((s) => s.id === "returned")).toMatchObject({ label: "Returned to seller", alert: true });
    expect(orderHeadline(stages, "TO_RETURN")).toBe("Returned to seller");
  });

  it("cancelled and failed labels show in red", () => {
    const stages = buildOrderTimeline({ ...base, status: "CANCELLED", labelFailed: "Label not ready" });
    expect(stages[1]).toMatchObject({ id: "cancelled", label: "Cancelled", alert: true });
    expect(stages.find((s) => s.id === "printed")).toMatchObject({ alert: true, detail: "Label not ready" });
    expect(orderHeadline(stages, "CANCELLED")).toBe("Cancelled");
    expect(buildOrderTimeline({ ...base, cancelRequested: true })[1].label).toBe("Buyer asked to cancel");
  });
});

describe("rates", () => {
  it("needs enough shipped to say anything", () => {
    expect(ratePct(1, 5)).toBeNull();
    expect(ratePct(3, 40)).toBe(7.5);
    expect(ratePct(0, 0, 0)).toBeNull();
  });

  it("normalizes item names for matching", () => {
    expect(itemKey("  Ribbed   Top ")).toBe(itemKey("ribbed top"));
  });

  it("merges courier spellings and computes per-courier rates", () => {
    const rows = buildCourierRates({
      shipped: [
        { courier: "J&T Express", count: 80 },
        { courier: "SPX Express", count: 20 },
      ],
      failed: [{ courier: "J&T Express", count: 8 }],
      missing: [{ courier: "SPX Express", count: 1 }],
    });
    const jt = rows.find((r) => r.failed === 8)!;
    expect(jt).toMatchObject({ shipped: 80, failRatePct: 10, missingRatePct: 0 });
    expect(rows[0].shipped).toBeGreaterThanOrEqual(rows[1].shipped);
  });
});

describe("money breakdown helpers", () => {
  it("fills missing days with zero, oldest first", () => {
    const series = buildDailySeries(
      [
        { occurredAt: new Date("2026-11-22T02:00:00Z"), amount: 100 },
        { occurredAt: new Date("2026-11-22T10:00:00Z"), amount: 50.255 },
      ],
      "2026-11-23",
      3
    );
    expect(series).toEqual([
      { date: "2026-11-21", amountPhp: 0 },
      { date: "2026-11-22", amountPhp: 150.26 },
      { date: "2026-11-23", amountPhp: 0 },
    ]);
  });

  it("CSV quotes separators and defuses spreadsheet formulas", () => {
    const csv = moneyRowsToCsv([
      {
        id: "1",
        platform: "SHOPEE",
        kind: "ADJUSTMENT",
        rawType: "=HYPERLINK(\"x\")",
        amountPhp: -12.5,
        occurredAt: "2026-11-22T16:30:00.000Z",
        orderSn: null,
        shopName: "Kyna, PH",
      },
    ]);
    const line = csv.split("\r\n")[1];
    expect(line).toContain('"Kyna, PH"');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line.endsWith("-12.50")).toBe(true);
    expect(line.startsWith("2026-11-23 00:30")).toBe(true);
  });
});

describe("deadline countdown", () => {
  const now = Date.UTC(2026, 10, 23, 0);
  it("formats hours, days and passed deadlines", () => {
    expect(deadlineCountdown(new Date(now + 5.5 * 3600_000).toISOString(), now)).toEqual({
      label: "Dispute due in 5h 30m",
      tone: "urgent",
    });
    expect(deadlineCountdown(new Date(now + 3 * 86400_000).toISOString(), now)).toEqual({
      label: "Dispute due in 3 days",
      tone: "soon",
    });
    expect(deadlineCountdown(new Date(now - 2 * 3600_000).toISOString(), now)?.tone).toBe("past");
    expect(deadlineCountdown(null, now)).toBeNull();
  });
});
