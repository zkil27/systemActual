/**
 * Per-order fees and payout from Shopee (v2.payment.get_escrow_detail) and
 * TikTok (finance order statement transactions), in one shape.
 *
 * Only the net payout is trusted as the headline: Shopee escrow_amount,
 * TikTok settlement_amount. Named fees are picked up when the field exists;
 * whatever else the shop kept lands in "other", so the totals always add up
 * even if a field name differs from what we expect. Field names are checked
 * against live data with `npm run capture:live`.
 */

export interface FinanceFigures {
  netPayoutPhp: number;
  commissionPhp: number;
  serviceFeePhp: number;
  transactionFeePhp: number;
  affiliatePhp: number;
  shippingPhp: number;
  withholdingTaxPhp: number;
  /** When the shop paid out, if the response says. */
  settledAt: Date | null;
  /** Every numeric field the shop sent (flattened), for checking names later. */
  breakdown: Record<string, number>;
}

type Raw = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * Numeric fields of an object, nested objects as "a.b", up to `depth` levels.
 * Arrays are skipped: per-SKU lists repeat the order's fees and would double count.
 */
export function flattenNumbers(obj: unknown, depth = 3, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj as Raw)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const n = num(v);
    if (n !== null) out[key] = n;
    else if (v && typeof v === "object" && !Array.isArray(v) && depth > 1) {
      Object.assign(out, flattenNumbers(v, depth - 1, key));
    }
  }
  return out;
}

const leaf = (key: string) => key.slice(key.lastIndexOf(".") + 1);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sum of |value| for fields whose own name (last part) matches. Fees come signed either way. */
function sumAbs(flat: Record<string, number>, names: RegExp): number {
  let total = 0;
  for (const [k, v] of Object.entries(flat)) if (names.test(leaf(k))) total += Math.abs(v);
  return round2(total);
}

const COMMISSION = /^(commission_fee|platform_commission_amount|platform_commission)$/;
const SERVICE = /^(service_fee|sfp_service_fee_amount|service_fee_amount)$/;
const TRANSACTION = /^(seller_transaction_fee|transaction_fee|transaction_fee_amount)$/;
const AFFILIATE = /^(order_ams_commission_fee|affiliate_commission_amount|affiliate_partner_commission_amount|affiliate_ads_commission_amount)$/;
const SHIPPING = /^(final_shipping_fee|reverse_shipping_fee|shipping_cost_amount)$/;
const WITHHOLDING = /^(withholding_tax|withholding_tax_amount|withholding_vat|withholding_vat_amount)$/;

function figuresFrom(flat: Record<string, number>, net: number, settledAt: Date | null): FinanceFigures {
  return {
    netPayoutPhp: round2(net),
    commissionPhp: sumAbs(flat, COMMISSION),
    serviceFeePhp: sumAbs(flat, SERVICE),
    transactionFeePhp: sumAbs(flat, TRANSACTION),
    affiliatePhp: sumAbs(flat, AFFILIATE),
    shippingPhp: sumAbs(flat, SHIPPING),
    withholdingTaxPhp: sumAbs(flat, WITHHOLDING),
    settledAt,
    breakdown: flat,
  };
}

/** Shopee get_escrow_detail response → figures, or null when there's no payout yet. */
export function mapShopeeEscrow(resp: unknown): FinanceFigures | null {
  const income = (resp as Raw | null)?.order_income;
  if (!income || typeof income !== "object") return null;
  const flat = flattenNumbers(income, 2);
  const net = num((income as Raw).escrow_amount);
  if (net === null) return null;
  return figuresFrom(flat, net, null);
}

/** TikTok order statement transactions → figures, or null when the order isn't settled yet. */
export function mapTikTokOrderStatements(data: unknown): FinanceFigures | null {
  const list = (data as Raw | null)?.statement_transactions;
  if (!Array.isArray(list) || list.length === 0) return null;
  const flat: Record<string, number> = {};
  let net = 0;
  let any = false;
  let latest: number | null = null;
  list.forEach((tx, i) => {
    if (!tx || typeof tx !== "object") return;
    const t = tx as Raw;
    const amount = num(t.settlement_amount);
    if (amount === null) return;
    any = true;
    net += amount;
    // One transaction per settlement or adjustment; key them apart so nothing merges.
    for (const [k, v] of Object.entries(flattenNumbers(t, 3))) flat[list.length > 1 ? `${i}.${k}` : k] = v;
    for (const field of ["statement_time", "settlement_time", "order_settled_time", "payment_time"]) {
      const s = num(t[field]);
      if (s !== null && s > 0) latest = Math.max(latest ?? 0, s);
    }
  });
  if (!any) return null;
  // Timestamps aren't money; keep them out of the fee sums.
  for (const k of Object.keys(flat)) if (/_time$/.test(leaf(k))) delete flat[k];
  return figuresFrom(flat, net, latest !== null ? new Date(latest * 1000) : null);
}

// ---------------------------------------------------------------- Profit

export interface FinanceLineInput {
  listingId: string;
  variationId: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPricePhp: number;
  /** Linked item, if any. */
  garmentId: string | null;
  /** Our cost per piece (item's own cost, else the shop default). */
  unitCostPhp: number;
  /** Pieces of this line that came back good on a return. */
  piecesBackGood: number;
}

export interface FinanceRecord {
  pieces: number;
  piecesBackGood: number;
  buyerPaidPhp: number;
  netPayoutPhp: number;
  commissionPhp: number;
  serviceFeePhp: number;
  transactionFeePhp: number;
  affiliatePhp: number;
  shippingPhp: number;
  withholdingTaxPhp: number;
  otherPhp: number;
  costPhp: number;
  profitPhp: number;
  lines: Array<{
    itemKey: string;
    garmentId: string | null;
    name: string;
    imageUrl: string | null;
    pieces: number;
    netPayoutPhp: number;
    costPhp: number;
  }>;
}

export function itemKeyOf(line: { garmentId: string | null; listingId: string; variationId: string }): string {
  return line.garmentId ?? `lv:${line.listingId}:${line.variationId}`;
}

/**
 * What the order earned. Profit = payout - cost of the pieces the buyer kept
 * (pieces that came back good are back on the shelf, not a cost). The payout
 * is split over lines by their price, for profit per item.
 */
export function buildFinanceRecord(
  figures: FinanceFigures,
  buyerPaidPhp: number,
  lines: FinanceLineInput[]
): FinanceRecord {
  const named =
    figures.commissionPhp +
    figures.serviceFeePhp +
    figures.transactionFeePhp +
    figures.affiliatePhp +
    figures.shippingPhp +
    figures.withholdingTaxPhp;
  const value = lines.reduce((n, l) => n + Math.max(0, l.unitPricePhp) * l.quantity, 0);
  const pieces = lines.reduce((n, l) => n + l.quantity, 0);
  let allocated = 0;
  const out = lines.map((l, i) => {
    const share =
      value > 0 ? (Math.max(0, l.unitPricePhp) * l.quantity) / value : pieces > 0 ? l.quantity / pieces : 0;
    // The last line takes the rounding remainder so lines add up to the payout.
    const net = i === lines.length - 1 ? round2(figures.netPayoutPhp - allocated) : round2(figures.netPayoutPhp * share);
    allocated = round2(allocated + net);
    const kept = Math.max(0, l.quantity - Math.min(l.quantity, Math.max(0, l.piecesBackGood)));
    return {
      itemKey: itemKeyOf(l),
      garmentId: l.garmentId,
      name: l.name,
      imageUrl: l.imageUrl,
      pieces: l.quantity,
      netPayoutPhp: net,
      costPhp: round2(kept * l.unitCostPhp),
    };
  });
  const cost = round2(out.reduce((n, l) => n + l.costPhp, 0));
  return {
    pieces,
    piecesBackGood: lines.reduce((n, l) => n + Math.min(l.quantity, Math.max(0, l.piecesBackGood)), 0),
    buyerPaidPhp: round2(buyerPaidPhp),
    netPayoutPhp: figures.netPayoutPhp,
    commissionPhp: figures.commissionPhp,
    serviceFeePhp: figures.serviceFeePhp,
    transactionFeePhp: figures.transactionFeePhp,
    affiliatePhp: figures.affiliatePhp,
    shippingPhp: figures.shippingPhp,
    withholdingTaxPhp: figures.withholdingTaxPhp,
    otherPhp: round2(buyerPaidPhp - figures.netPayoutPhp - named),
    costPhp: cost,
    profitPhp: round2(figures.netPayoutPhp - cost),
    lines: out,
  };
}
