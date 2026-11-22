/**
 * READ-ONLY. Compares TikTok's own "to ship" numbers with the ledger, to check
 * that the Waves header matches Seller Center "Orders to ship".
 *
 * Usage (with .env pointing at the real database):
 *   npx tsx --env-file=.env scripts/tiktok-ready-audit.ts
 *
 * Prints, per TikTok shop:
 *   - live total_count per order status (does Seller Center's number = AWAITING_SHIPMENT,
 *     or also ON_HOLD / PARTIALLY_SHIPPING?  If so, add them to TIKTOK_TO_SHIP_STATUSES
 *     in src/lib/waves/live-count.ts)
 *   - live AWAITING_SHIPMENT orders split by package status / cancel request / split
 *   - order ids live-but-not-in-ledger and in-ledger-but-not-live
 * Nothing is changed on the shop or in the database.
 */
import { Platform } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { tiktokRequest } from "../src/lib/connectors/tiktok";
import { ensureFreshToken } from "../src/lib/connectors/tokens";
import { mapTikTokOrder } from "../src/lib/ledger/normalize";
import { getReadyCounts, readyWhere } from "../src/lib/waves/build";

const STATUSES = ["UNPAID", "ON_HOLD", "AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION"];

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

async function main() {
  const shops = await prisma.shopConnection.findMany({
    where: { isDemo: false, accessToken: { not: null }, platform: Platform.TIKTOK, shopCipher: { not: null } },
  });
  if (!shops.length) {
    console.log("No connected TikTok shops.");
    return;
  }

  for (const shop of shops) {
    const token = await ensureFreshToken(shop);
    const search = (body: Record<string, unknown>, query: Record<string, string>) =>
      tiktokRequest({ method: "POST", path: "/order/202309/orders/search", accessToken: token, shopCipher: shop.shopCipher, query, body });

    console.log(`\n=== ${shop.shopName} ===`);
    console.log("Live total_count by order status:");
    for (const status of STATUSES) {
      const data = await search({ order_status: status }, { page_size: "1" });
      console.log(`  ${status.padEnd(20)} ${data?.total_count ?? "?"}`);
    }

    const liveSns = new Set<string>();
    const pkgStatus = new Map<string, number>();
    let cancelReq = 0;
    let split = 0;
    let pageToken = "";
    for (;;) {
      const data = await search({ order_status: "AWAITING_SHIPMENT" }, { page_size: "50", ...(pageToken ? { page_token: pageToken } : {}) });
      for (const raw of Array.isArray(data?.orders) ? data.orders : []) {
        const o = mapTikTokOrder(raw);
        liveSns.add(o.orderSn);
        if (o.cancelRequested) cancelReq++;
        if (o.packages.length > 1) split++;
        if (!o.packages.length) bump(pkgStatus, "(no package)");
        for (const p of o.packages) bump(pkgStatus, p.status ?? "(none)");
      }
      if (!data?.next_page_token) break;
      pageToken = String(data.next_page_token);
    }
    console.log(`\nLive AWAITING_SHIPMENT orders: ${liveSns.size}  (cancel requested ${cancelReq}, split ${split})`);
    console.log("  by package status:", Object.fromEntries(pkgStatus));

    const local = await prisma.order.findMany({
      where: { ...readyWhere(Platform.TIKTOK, { includeCancelRequested: true }), shopConnectionId: shop.id },
      select: { orderSn: true, status: true },
    });
    const localSns = new Set(local.map((o) => o.orderSn));
    const missing = [...liveSns].filter((sn) => !localSns.has(sn));
    const extra = [...localSns].filter((sn) => !liveSns.has(sn));
    console.log(`\nLedger AWAITING_SHIPMENT orders: ${localSns.size}`);
    console.log(`  live but not in ledger (${missing.length}):`, missing.slice(0, 15));
    console.log(`  in ledger but not live (${extra.length}):`, extra.slice(0, 15));
  }

  const ready = await getReadyCounts(new Date(), { live: true });
  console.log("\nWaves header data (TikTok):", {
    live: ready.live.TIKTOK,
    ready: ready.byPlatform.TIKTOK,
    waiting1h: ready.coolingOffByPlatform.TIKTOK,
    held: ready.held.TIKTOK,
    unexplained: ready.unexplained.TIKTOK,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
