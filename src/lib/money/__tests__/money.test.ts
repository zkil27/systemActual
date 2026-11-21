import { MoneyKind, Platform } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { mapShopeeWalletTransaction, mapTikTokStatement, shopeeKind } from "@/lib/money/map";
import { isMoneySyncDue, MONEY_EVERY_MS } from "@/lib/money/sync";
import { summarizeMoney } from "@/lib/money/summary";
import { nextSyncWindow } from "@/lib/ledger/window";
import { getManilaDayBounds } from "@/lib/time";

describe("Shopee wallet transactions", () => {
  it("escrow paid to the seller (type 101) is credited", () => {
    const row = mapShopeeWalletTransaction({
      transaction_id: 900001,
      status: "COMPLETED",
      transaction_type: "ESCROW_VERIFIED_ADD",
      amount: 168.5,
      create_time: 1795000000,
      order_sn: "251118AAAA0001",
    });
    expect(row).toEqual({
      externalId: "900001",
      kind: MoneyKind.CREDIT,
      rawType: "ESCROW_VERIFIED_ADD",
      amountPhp: 168.5,
      occurredAt: new Date(1795000000 * 1000),
      orderSn: "251118AAAA0001",
    });
  });

  it("ad charges (type 450) are ads, not credit; numeric codes work too", () => {
    expect(shopeeKind(450)).toEqual({ name: "PAID_ADS_CHARGE", kind: MoneyKind.ADS });
    expect(shopeeKind("101").kind).toBe(MoneyKind.CREDIT);
    expect(shopeeKind("WITHDRAWAL_COMPLETED").kind).toBe(MoneyKind.WITHDRAWAL);
    expect(shopeeKind("SOMETHING_NEW").kind).toBe(MoneyKind.OTHER);
  });

  it("skips transactions that aren't completed", () => {
    expect(
      mapShopeeWalletTransaction({ transaction_id: 1, status: "PENDING", transaction_type: 101, amount: 1, create_time: 1795000000 })
    ).toBeNull();
  });
});

describe("TikTok statements", () => {
  it("counts a statement only once PAID, on its payment time", () => {
    const paid = mapTikTokStatement({ id: "7238804564097517339", payment_status: "PAID", settlement_amount: "1250.75", payment_time: 1795050000 });
    expect(paid).toMatchObject({ kind: MoneyKind.CREDIT, amountPhp: 1250.75, occurredAt: new Date(1795050000 * 1000) });
    expect(mapTikTokStatement({ id: "x", payment_status: "PROCESSING", settlement_amount: "10", payment_time: 0 })).toBeNull();
  });
});

describe("summarizeMoney", () => {
  it("credited is order income only; ads and adjustments are separate; GMV is separate", () => {
    const s = summarizeMoney(
      [
        { platform: Platform.SHOPEE, kind: MoneyKind.CREDIT, amount: 10000 },
        { platform: Platform.TIKTOK, kind: MoneyKind.CREDIT, amount: 2500.5 },
        { platform: Platform.SHOPEE, kind: MoneyKind.ADS, amount: -800 },
        { platform: Platform.SHOPEE, kind: MoneyKind.ADJUSTMENT, amount: -35 },
        { platform: Platform.SHOPEE, kind: MoneyKind.WITHDRAWAL, amount: -9000 },
      ],
      { count: 412, totalPhp: 81988 },
      null
    );
    expect(s).toMatchObject({
      creditedPhp: 12500.5,
      creditedShopeePhp: 10000,
      creditedTikTokPhp: 2500.5,
      adsPhp: -800,
      adjustmentsPhp: -35,
      ordersPlacedCount: 412,
      ordersPlacedPhp: 81988,
    });
  });
});

describe("Manila day and sync windows", () => {
  it("a credit at 11:30 PM Manila belongs to that Manila day, not the UTC one", () => {
    const { start, end } = getManilaDayBounds("2026-11-20");
    const lateNight = new Date("2026-11-20T15:30:00Z"); // 23:30 Manila
    const nextMorning = new Date("2026-11-20T16:30:00Z"); // 00:30 Nov 21 Manila
    expect(lateNight >= start && lateNight < end).toBe(true);
    expect(nextMorning >= start && nextMorning < end).toBe(false);
  });

  it("wallet windows stay inside Shopee's 15-day limit", () => {
    const w = nextSyncWindow(null, new Date("2026-11-21T00:00:00Z"));
    expect(w.to.getTime() - w.from.getTime()).toBeLessThanOrEqual(15 * 24 * 3600_000);
  });

  it("money is pulled at most every 15 minutes", () => {
    const now = Date.now();
    expect(isMoneySyncDue(null, now)).toBe(true);
    expect(isMoneySyncDue(new Date(now - MONEY_EVERY_MS + 1000), now)).toBe(false);
    expect(isMoneySyncDue(new Date(now - MONEY_EVERY_MS), now)).toBe(true);
  });
});
