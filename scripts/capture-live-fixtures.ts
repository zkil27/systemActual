/**
 * READ-ONLY. Saves a few real API responses from the connected shops, with
 * buyer details removed, so the status values and field names the app relies
 * on can be checked against live data (docs/cutover.md, step 3).
 *
 * Usage (with .env pointing at the real database):
 *   npx tsx --env-file=.env scripts/capture-live-fixtures.ts
 * Writes to src/lib/__fixtures__/live/*.json, then run:  npm test
 * Nothing is changed on the shops. Don't commit files that still contain
 * anything personal; review them first.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Platform, PrismaClient } from "@prisma/client";
import { shopeeGet } from "../src/lib/connectors/shopee";
import { tiktokRequest } from "../src/lib/connectors/tiktok";
import { ensureFreshToken } from "../src/lib/connectors/tokens";
import { SHOPEE_DETAIL_FIELDS } from "../src/lib/ledger/sync";

const OUT = path.join(process.cwd(), "src", "lib", "__fixtures__", "live");
const PERSONAL = /name|phone|address|email|buyer_user|recipient|username|user_id|cpf|note|message|image|url/i;
const KEEP = /^(item_name|product_name|sku_name|model_name|shop_name|seller_name|title|logistics_channel_name|shipping_provider_name|return_provider_name|reverse_logistics_channel_name|carrier_name)$/i;

/** Blank anything that could identify a buyer. Status fields, ids and amounts are kept. */
export function redact(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value === "string" && PERSONAL.test(key) && !KEEP.test(key)) return "[redacted]";
  return value;
}

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

async function save(name: string, data: unknown) {
  const file = path.join(OUT, `${name}.json`);
  await writeFile(file, JSON.stringify(redact(data), null, 2));
  console.log("saved", path.relative(process.cwd(), file));
}

async function main() {
  const prisma = new PrismaClient();
  await mkdir(OUT, { recursive: true });
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 24 * 3600_000);
  const shops = await prisma.shopConnection.findMany({ where: { isDemo: false, accessToken: { not: null } } });

  for (const shop of shops) {
    const token = await ensureFreshToken(shop);
    if (shop.platform === Platform.SHOPEE) {
      const list = await shopeeGet("/api/v2/order/get_order_list", shop.shopId, token, {
        time_range_field: "update_time",
        time_from: sec(from),
        time_to: sec(now),
        page_size: 50,
      });
      const sns: string[] = (list?.order_list ?? []).map((o: { order_sn: string }) => o.order_sn).slice(0, 50);
      if (sns.length) {
        await save(
          "shopee-orders",
          await shopeeGet("/api/v2/order/get_order_detail", shop.shopId, token, {
            order_sn_list: sns.join(","),
            response_optional_fields: SHOPEE_DETAIL_FIELDS,
          })
        );
        await save("shopee-tracking", await shopeeGet("/api/v2/logistics/get_tracking_info", shop.shopId, token, { order_sn: sns[0] }));
      }
      const returns = await shopeeGet("/api/v2/returns/get_return_list", shop.shopId, token, {
        page_no: 0,
        page_size: 50,
        update_time_from: sec(new Date(now.getTime() - 14 * 24 * 3600_000)),
        update_time_to: sec(now),
      });
      await save("shopee-returns", returns);
      const firstReturn = returns?.return?.[0]?.return_sn;
      if (firstReturn) {
        await save(
          "shopee-reverse-tracking",
          await shopeeGet("/api/v2/returns/get_reverse_tracking_info", shop.shopId, token, { return_sn: firstReturn })
        );
      }
      await save(
        "shopee-wallet",
        await shopeeGet("/api/v2/payment/get_wallet_transaction_list", shop.shopId, token, {
          page_no: 0,
          page_size: 100,
          create_time_from: sec(from),
          create_time_to: sec(now),
        })
      );
    } else if (shop.shopCipher) {
      const call = (method: "GET" | "POST", p: string, query?: Record<string, string>, body?: Record<string, unknown>) =>
        tiktokRequest({ method, path: p, accessToken: token, shopCipher: shop.shopCipher, query, body });
      await save("tiktok-orders", await call("POST", "/order/202309/orders/search", { page_size: "50" }, { update_time_ge: sec(from), update_time_lt: sec(now) }));
      await save(
        "tiktok-returns",
        await call("POST", "/return_refund/202309/returns/search", { page_size: "50" }, { update_time_ge: sec(new Date(now.getTime() - 14 * 24 * 3600_000)), update_time_lt: sec(now) })
      );
      await save(
        "tiktok-statements",
        await call("GET", "/finance/202309/statements", {
          statement_time_ge: String(sec(new Date(now.getTime() - 14 * 24 * 3600_000))),
          statement_time_lt: String(sec(now)),
          sort_field: "statement_time",
          page_size: "20",
        })
      );
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
