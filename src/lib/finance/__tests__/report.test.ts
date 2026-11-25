import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { csvCell, manilaStamp, toCsv } from "../csv";
import {
  emptyTotals,
  estimateWithholding,
  parseMonth,
  pickItems,
  recomputableMonths,
  sumTotals,
  type ItemMonth,
} from "../report";
import { financeCandidateWhere, isRateLimited, manilaMonth } from "../sync";

describe("months", () => {
  it("uses the Manila month, so 11 PM on Nov 30 UTC is already December", () => {
    expect(manilaMonth(new Date("2026-11-30T16:30:00Z"))).toBe("2026-12");
    expect(manilaMonth(new Date("2026-11-30T15:30:00Z"))).toBe("2026-11");
  });

  it("recomputes this month and the two before, across a year change", () => {
    expect(recomputableMonths(new Date("2026-02-10T04:00:00Z"))).toEqual(["2026-02", "2026-01", "2025-12"]);
  });

  it("falls back to this month for a bad month", () => {
    const now = new Date("2026-11-26T04:00:00Z");
    expect(parseMonth("2026-13", now)).toBe("2026-11");
    expect(parseMonth("2026-09", now)).toBe("2026-09");
    expect(parseMonth(null, now)).toBe("2026-11");
  });
});

describe("sumTotals", () => {
  it("adds both shops", () => {
    const a = { ...emptyTotals(), orders: 2, pieces: 3, netPayoutPhp: 100.1, profitPhp: 40.05 };
    const b = { ...emptyTotals(), orders: 1, pieces: 1, netPayoutPhp: 50.2, profitPhp: 9.95 };
    expect(sumTotals([a, b])).toMatchObject({ orders: 3, pieces: 4, netPayoutPhp: 150.3, profitPhp: 50 });
  });
});

describe("pickItems", () => {
  const item = (itemKey: string, pieces: number, net: number, cost: number): ItemMonth => ({
    itemKey, garmentId: null, name: itemKey, imageUrl: null, pieces, netPayoutPhp: net, costPhp: cost, profitPhp: net - cost,
  });
  it("lists best by profit and weakest by margin, ignoring one-off sales", () => {
    const { best, weak } = pickItems(
      [item("top", 10, 1500, 820), item("skirt", 5, 600, 410), item("rare", 1, 100, 90), item("shorts", 4, 400, 380)],
      2
    );
    expect(best.map((i) => i.itemKey)).toEqual(["top", "skirt"]);
    expect(weak.map((i) => i.itemKey)).toEqual(["shorts", "skirt"]);
  });
});

describe("estimateWithholding", () => {
  it("is 1% of half the payouts", () => {
    expect(estimateWithholding(100_000)).toBe(500);
    expect(estimateWithholding(-5)).toBe(0);
  });
});

describe("financeCandidateWhere", () => {
  it("asks about completed, unsaved, recent orders not checked in the last 6 hours", () => {
    const now = new Date("2026-11-26T00:00:00Z");
    const w = financeCandidateWhere("shop1", now);
    expect(w).toMatchObject({ shopConnectionId: "shop1", status: "COMPLETED", financeSavedAt: null });
    expect((w.OR as Array<Record<string, unknown>>)[1]).toEqual({
      financeCheckedAt: { lt: new Date("2026-11-25T18:00:00Z") },
    });
  });
});

describe("isRateLimited", () => {
  it("spots throttling messages", () => {
    expect(isRateLimited(new Error("Too many requests"))).toBe(true);
    expect(isRateLimited(new Error("error_param"))).toBe(false);
  });
});

describe("csv", () => {
  it("quotes commas and quotes, neutralises formulas, keeps numbers plain", () => {
    expect(csvCell('Top, "black"')).toBe('"Top, ""black"""');
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvCell(-12.5)).toBe("-12.50");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(null)).toBe("");
  });
  it("dates include the year, in Manila time", () => {
    expect(manilaStamp(new Date("2026-11-19T06:00:00Z"))).toBe("2026-11-19 14:00");
    expect(manilaStamp(new Date("2026-12-31T16:30:00Z"))).toBe("2027-01-01 00:30");
  });
  it("starts with a BOM and uses CRLF", () => {
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("﻿A,B\r\n1,x\r\n");
  });
});

describe("formatProfitTelegram", () => {
  it("summarises the month in plain words", async () => {
    const { formatProfitTelegram } = await import("../telegram");
    const text = formatProfitTelegram({
      month: "2026-11",
      months: ["2026-11"],
      live: true,
      totals: { ...emptyTotals(), orders: 120, pieces: 150, buyerPaidPhp: 30000, netPayoutPhp: 24000, costPhp: 12300, profitPhp: 11700 },
      byShop: [],
      bestItems: [{ itemKey: "g1", garmentId: "g1", name: "Ribbed Top", imageUrl: null, pieces: 40, netPayoutPhp: 6400, costPhp: 3280, profitPhp: 3120 }],
      weakItems: [],
      waitingCount: 8,
      taxEstimatePhp: 120,
    });
    expect(text).toContain("PROFIT — November 2026");
    expect(text).toContain("Profit: PHP 11,700 (margin 49%)");
    expect(text).toContain("Shops took: PHP 6,000 (20%)");
    expect(text).toContain("Earns the most: Ribbed Top (PHP 3,120)");
    expect(text).toContain("Waiting for payout details: 8 orders");
  });
});
