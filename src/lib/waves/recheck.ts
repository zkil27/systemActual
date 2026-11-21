import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { mapShopeeOrder, mapTikTokOrder } from "@/lib/ledger/normalize";
import { saveOrder } from "@/lib/ledger/store";
import { SHOPEE_DETAIL_FIELDS } from "@/lib/ledger/sync";

const BATCH = 50;

/**
 * Fetches each order fresh from the shop and saves it, so a cancellation made
 * minutes ago is seen before anything is planned or shipped. Returns the ids
 * of orders that were rechecked; anything not rechecked (error, out of time)
 * must be left out of the wave.
 */
export async function recheckOrders(
  orders: Array<{ id: string; orderSn: string; platform: Platform; shopConnectionId: string }>,
  deadline: number
): Promise<Set<string>> {
  const done = new Set<string>();
  const byShop = new Map<string, typeof orders>();
  for (const o of orders) byShop.set(o.shopConnectionId, [...(byShop.get(o.shopConnectionId) ?? []), o]);

  for (const [shopConnectionId, list] of byShop) {
    const shop = await prisma.shopConnection.findUnique({ where: { id: shopConnectionId } });
    if (!shop?.accessToken || (shop.platform === Platform.TIKTOK && !shop.shopCipher)) continue;
    let token: string;
    try {
      token = await ensureFreshToken(shop);
    } catch {
      continue;
    }
    const idBySn = new Map(list.map((o) => [o.orderSn, o.id]));

    for (let i = 0; i < list.length; i += BATCH) {
      if (Date.now() >= deadline) return done;
      const sns = list.slice(i, i + BATCH).map((o) => o.orderSn);
      try {
        const raw: Record<string, unknown>[] =
          shop.platform === Platform.SHOPEE
            ? (
                await shopeeGet("/api/v2/order/get_order_detail", shop.shopId, token, {
                  order_sn_list: sns.join(","),
                  response_optional_fields: SHOPEE_DETAIL_FIELDS,
                })
              )?.order_list ?? []
            : (
                await tiktokRequest({
                  method: "GET",
                  path: "/order/202309/orders",
                  accessToken: token,
                  shopCipher: shop.shopCipher,
                  query: { ids: sns.join(",") },
                })
              )?.orders ?? [];
        for (const r of raw) {
          const n = shop.platform === Platform.SHOPEE ? mapShopeeOrder(r) : mapTikTokOrder(r);
          await saveOrder(shop.id, shop.platform, n);
          const id = idBySn.get(n.orderSn);
          if (id) done.add(id);
        }
      } catch (err) {
        console.error("[wave recheck]", shop.shopName, err);
      }
    }
  }
  return done;
}
