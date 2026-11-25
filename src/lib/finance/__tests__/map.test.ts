import { describe, expect, it } from "vitest";
import {
  buildFinanceRecord,
  flattenNumbers,
  itemKeyOf,
  mapShopeeEscrow,
  mapTikTokOrderStatements,
  type FinanceLineInput,
} from "../map";

describe("flattenNumbers", () => {
  it("reads numbers and numeric strings, nests objects, skips arrays and text", () => {
    expect(
      flattenNumbers({ a: 1, b: "2.50", c: "x", d: { e: -3 }, f: [{ g: 9 }], h: null })
    ).toEqual({ a: 1, b: 2.5, "d.e": -3 });
  });
});

describe("mapShopeeEscrow", () => {
  const resp = {
    order_sn: "2611ABC",
    order_income: {
      escrow_amount: 158.32,
      buyer_total_amount: 238,
      commission_fee: 17.91,
      service_fee: 9.95,
      seller_transaction_fee: 5.33,
      order_ams_commission_fee: 0,
      final_shipping_fee: -0,
      reverse_shipping_fee: 0,
      withholding_tax: 0.79,
      items: [{ commission_fee: 99 }],
    },
  };

  it("takes the payout and named fees, never from per-item lists", () => {
    const f = mapShopeeEscrow(resp)!;
    expect(f).toMatchObject({
      netPayoutPhp: 158.32,
      commissionPhp: 17.91,
      serviceFeePhp: 9.95,
      transactionFeePhp: 5.33,
      affiliatePhp: 0,
      withholdingTaxPhp: 0.79,
      settledAt: null,
    });
    expect(f.breakdown.buyer_total_amount).toBe(238);
  });

  it("is null without a payout", () => {
    expect(mapShopeeEscrow({ order_income: { commission_fee: 1 } })).toBeNull();
    expect(mapShopeeEscrow(null)).toBeNull();
  });
});

describe("mapTikTokOrderStatements", () => {
  it("adds up settlements and adjustments, fees as positive pesos", () => {
    const f = mapTikTokOrderStatements({
      order_id: "577",
      statement_transactions: [
        {
          settlement_amount: "170.00",
          statement_time: 1795000000,
          shipping_cost_amount: "-20.00",
          fee_breakdown: { platform_commission_amount: "-12.00", transaction_fee_amount: "-4.00", affiliate_commission_amount: "-10.00" },
          sku_statement_transactions: [{ platform_commission_amount: "-12.00" }],
        },
        { settlement_amount: "-5.00", statement_time: 1795100000 },
      ],
    })!;
    expect(f).toMatchObject({
      netPayoutPhp: 165,
      commissionPhp: 12,
      transactionFeePhp: 4,
      affiliatePhp: 10,
      shippingPhp: 20,
    });
    expect(f.settledAt?.toISOString()).toBe(new Date(1795100000 * 1000).toISOString());
    expect(Object.keys(f.breakdown).some((k) => k.endsWith("statement_time"))).toBe(false);
  });

  it("is null before the order is settled", () => {
    expect(mapTikTokOrderStatements({ statement_transactions: [] })).toBeNull();
    expect(mapTikTokOrderStatements({ statement_transactions: [{ fee_amount: "-3" }] })).toBeNull();
    expect(mapTikTokOrderStatements({})).toBeNull();
  });
});

describe("buildFinanceRecord", () => {
  const top: FinanceLineInput = {
    listingId: "1", variationId: "1", name: "Ribbed Top", imageUrl: null, quantity: 2, unitPricePhp: 199,
    garmentId: "g1", unitCostPhp: 82, piecesBackGood: 0,
  };
  const skirt: FinanceLineInput = {
    listingId: "2", variationId: "9", name: "Skirt", imageUrl: null, quantity: 1, unitPricePhp: 249,
    garmentId: null, unitCostPhp: 82, piecesBackGood: 0,
  };
  const figures = {
    netPayoutPhp: 520, commissionPhp: 40, serviceFeePhp: 20, transactionFeePhp: 10, affiliatePhp: 0,
    shippingPhp: 50, withholdingTaxPhp: 2.6, settledAt: null, breakdown: {},
  };

  it("profit is payout minus the cost of pieces kept; the rest of what the shop kept is 'other'", () => {
    const r = buildFinanceRecord(figures, 697, [top, skirt]);
    expect(r).toMatchObject({
      pieces: 3,
      buyerPaidPhp: 697,
      netPayoutPhp: 520,
      costPhp: 246,
      profitPhp: 274,
      otherPhp: 54.4,
    });
    expect(r.buyerPaidPhp).toBeCloseTo(
      r.netPayoutPhp + r.commissionPhp + r.serviceFeePhp + r.transactionFeePhp + r.affiliatePhp + r.shippingPhp + r.withholdingTaxPhp + r.otherPhp
    );
  });

  it("splits the payout over lines by price and adds up exactly", () => {
    const r = buildFinanceRecord(figures, 697, [top, skirt]);
    expect(r.lines.map((l) => l.netPayoutPhp)).toEqual([319.88, 200.12]);
    expect(r.lines.map((l) => l.itemKey)).toEqual(["g1", "lv:2:9"]);
  });

  it("doesn't count pieces that came back good as a cost", () => {
    const r = buildFinanceRecord(figures, 697, [{ ...top, piecesBackGood: 1 }, skirt]);
    expect(r.costPhp).toBe(164);
    expect(r.piecesBackGood).toBe(1);
    expect(r.profitPhp).toBe(356);
  });

  it("splits by pieces when prices are missing", () => {
    const r = buildFinanceRecord({ ...figures, netPayoutPhp: 90 }, 100, [
      { ...top, unitPricePhp: 0, quantity: 2 },
      { ...skirt, unitPricePhp: 0, quantity: 1 },
    ]);
    expect(r.lines.map((l) => l.netPayoutPhp)).toEqual([60, 30]);
  });
});

describe("itemKeyOf", () => {
  it("prefers the linked item", () => {
    expect(itemKeyOf({ garmentId: "g", listingId: "1", variationId: "2" })).toBe("g");
    expect(itemKeyOf({ garmentId: null, listingId: "1", variationId: "2" })).toBe("lv:1:2");
  });
});
