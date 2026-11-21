import { MoneyKind } from "@prisma/client";

/**
 * Turns Shopee wallet transactions and TikTok statements into one shape.
 * "Credited" means money actually credited to the Shopee wallet or a TikTok
 * statement marked PAID, not orders placed (GMV).
 */

export interface MoneyRow {
  externalId: string;
  kind: MoneyKind;
  rawType: string;
  amountPhp: number;
  occurredAt: Date;
  orderSn: string | null;
}

/**
 * Shopee v2.payment.get_wallet_transaction_list transaction types (code and
 * name, since the response may use either). Order income, including fast-escrow
 * payouts and escrow deductions from returns, counts as CREDIT so the number is
 * net order income.
 */
const SHOPEE_TYPES: Array<[number, string, MoneyKind]> = [
  [101, "ESCROW_VERIFIED_ADD", MoneyKind.CREDIT],
  [102, "ESCROW_VERIFIED_MINUS", MoneyKind.CREDIT],
  [452, "FAST_ESCROW_DISBURSE", MoneyKind.CREDIT],
  [458, "FAST_ESCROW_DEDUCT", MoneyKind.CREDIT],
  [459, "FAST_ESCROW_DISBURSE_REMAIN", MoneyKind.CREDIT],
  [201, "WITHDRAWAL_CREATED", MoneyKind.WITHDRAWAL],
  [202, "WITHDRAWAL_COMPLETED", MoneyKind.WITHDRAWAL],
  [203, "WITHDRAWAL_CANCELLED", MoneyKind.WITHDRAWAL],
  [401, "ADJUSTMENT_ADD", MoneyKind.ADJUSTMENT],
  [402, "ADJUSTMENT_MINUS", MoneyKind.ADJUSTMENT],
  [404, "FBS_ADJUSTMENT_ADD", MoneyKind.ADJUSTMENT],
  [405, "FBS_ADJUSTMENT_MINUS", MoneyKind.ADJUSTMENT],
  [406, "ADJUSTMENT_CENTER_ADD", MoneyKind.ADJUSTMENT],
  [407, "ADJUSTMENT_CENTER_DEDUCT", MoneyKind.ADJUSTMENT],
  [408, "FSF_COST_PASSING_DEDUCT", MoneyKind.ADJUSTMENT],
  [450, "PAID_ADS_CHARGE", MoneyKind.ADS],
  [451, "PAID_ADS_REFUND", MoneyKind.ADS],
  [455, "AFFILIATE_ADS_SELLER_FEE", MoneyKind.ADS],
  [456, "AFFILIATE_ADS_SELLER_FEE_REFUND", MoneyKind.ADS],
  [460, "AFFILIATE_FEE_DEDUCT", MoneyKind.ADS],
];

const BY_CODE = new Map(SHOPEE_TYPES.map(([code, name, kind]) => [String(code), { name, kind }]));
const BY_NAME = new Map(SHOPEE_TYPES.map(([, name, kind]) => [name, { name, kind }]));

export function shopeeKind(transactionType: unknown): { name: string; kind: MoneyKind } {
  const raw = String(transactionType ?? "").trim().toUpperCase();
  return BY_CODE.get(raw) ?? BY_NAME.get(raw) ?? { name: raw || "UNKNOWN", kind: MoneyKind.OTHER };
}

/** One wallet transaction, or null if it isn't final yet. */
export function mapShopeeWalletTransaction(t: Record<string, unknown>): MoneyRow | null {
  const status = String(t.status ?? "COMPLETED").toUpperCase();
  if (status !== "COMPLETED") return null;
  const id = t.transaction_id ?? t.id;
  const created = Number(t.create_time);
  if (id === undefined || id === null || !Number.isFinite(created) || created <= 0) return null;
  const { name, kind } = shopeeKind(t.transaction_type);
  return {
    externalId: String(id),
    kind,
    rawType: name,
    amountPhp: Number(t.amount) || 0,
    occurredAt: new Date(created * 1000),
    orderSn: t.order_sn ? String(t.order_sn) : null,
  };
}

const TIKTOK_CREDITED_STATUSES = new Set(["PAID", "SETTLED"]);

/** One TikTok statement, counted once it's PAID or SETTLED, on its payment time. */
export function mapTikTokStatement(s: Record<string, unknown>): MoneyRow | null {
  const status = String(s.payment_status ?? "").toUpperCase();
  if (!TIKTOK_CREDITED_STATUSES.has(status)) return null;
  const paid = Number(s.payment_time);
  if (!s.id || !Number.isFinite(paid) || paid <= 0) return null;
  return {
    externalId: String(s.id),
    kind: MoneyKind.CREDIT,
    rawType: "STATEMENT_PAID",
    amountPhp: Number(s.settlement_amount) || 0,
    occurredAt: new Date(paid * 1000),
    orderSn: null,
  };
}
