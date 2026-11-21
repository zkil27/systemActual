import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapShopeeOrder, mapTikTokOrder } from "@/lib/ledger/normalize";
import { mapShopeeReturn, mapTikTokReturn } from "@/lib/returns/map";
import { mapShopeeWalletTransaction, mapTikTokStatement } from "@/lib/money/map";

/**
 * Runs the app's mappers over real (redacted) responses saved by
 * scripts/capture-live-fixtures.ts. Skipped until those files exist.
 * Prints every status value seen, to compare with the lists in
 * docs/cutover.md step 3.
 */
const DIR = path.join(process.cwd(), "src", "lib", "__fixtures__", "live");
const load = (name: string): Record<string, unknown> | null => {
  const file = path.join(DIR, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
const seen = (label: string, values: unknown[]) =>
  console.log(`[live] ${label}:`, [...new Set(values.map(String))].sort().join(", ") || "(none)");

const ctx = { shopConnectionId: "live", forwardTrackingNumber: null, orderCarrier: null };

describe.skipIf(!existsSync(DIR))("live captures", () => {
  it("Shopee orders map cleanly", () => {
    const orders = arr(load("shopee-orders")?.order_list);
    const mapped = orders.map(mapShopeeOrder);
    mapped.forEach((o) => expect(o.orderSn).toBeTruthy());
    seen("Shopee order_status", orders.map((o) => o.order_status));
    seen("Shopee package logistics_status", orders.flatMap((o) => arr(o.package_list).map((p) => p.logistics_status)));
    seen("Shopee cancel_by", orders.map((o) => o.cancel_by).filter(Boolean));
  });

  it("Shopee returns map cleanly", () => {
    const list = arr(load("shopee-returns")?.return);
    list.forEach((r) => expect(mapShopeeReturn(r, ctx).returnSn).toBeTruthy());
    seen("Shopee return status", list.map((r) => r.status));
    seen("Shopee return_refund_request_type", list.map((r) => r.return_refund_request_type));
    seen("Shopee reverse_logistics_status", [load("shopee-reverse-tracking")?.reverse_logistics_status].filter(Boolean));
  });

  it("Shopee wallet transactions map cleanly", () => {
    const list = arr(load("shopee-wallet")?.transaction_list);
    list.forEach((t) => mapShopeeWalletTransaction(t));
    seen("Shopee wallet transaction_type", list.map((t) => t.transaction_type));
  });

  it("TikTok orders, returns and statements map cleanly", () => {
    const orders = arr(load("tiktok-orders")?.orders);
    orders.forEach((o) => expect(mapTikTokOrder(o).orderSn).toBeTruthy());
    seen("TikTok order status", orders.map((o) => o.status));
    seen("TikTok package_status", orders.flatMap((o) => arr(o.line_items).map((l) => l.package_status)));
    const returns = arr(load("tiktok-returns")?.return_orders);
    returns.forEach((r) => expect(mapTikTokReturn(r, ctx).returnSn).toBeTruthy());
    seen("TikTok return_status", returns.map((r) => r.return_status));
    seen("TikTok return_type", returns.map((r) => r.return_type));
    arr(load("tiktok-statements")?.statements).forEach((s) => mapTikTokStatement(s));
  });
});
