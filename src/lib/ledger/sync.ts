import { Platform, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { mapShopeeOrder, mapTikTokOrder, type NormalizedOrder } from "./normalize";
import { saveOrder } from "./store";
import { nextSyncWindow, type SyncWindow } from "./window";

export interface OrderSyncResult {
  saved: number;
  windows: number;
  caughtUp: boolean;
}

const SHOPEE_DETAIL_FIELDS = [
  "item_list",
  "package_list",
  "total_amount",
  "payment_method",
  "shipping_carrier",
  "cancel_by",
  "cancel_reason",
  "buyer_cancel_reason",
  "pickup_done_time",
].join(",");

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

class OutOfTime extends Error {}

function checkDeadline(deadline: number) {
  if (Date.now() >= deadline) throw new OutOfTime();
}

async function* shopeeWindowOrders(
  conn: ShopConnection,
  accessToken: string,
  w: SyncWindow,
  deadline: number
): AsyncGenerator<NormalizedOrder[]> {
  let cursor = "";
  for (;;) {
    checkDeadline(deadline);
    const list = await shopeeGet("/api/v2/order/get_order_list", conn.shopId, accessToken, {
      time_range_field: "update_time",
      time_from: sec(w.from),
      time_to: sec(w.to),
      page_size: 100,
      ...(cursor ? { cursor } : {}),
    });
    const sns: string[] = (list?.order_list ?? []).map((o: { order_sn: string }) => String(o.order_sn));
    for (let i = 0; i < sns.length; i += 50) {
      checkDeadline(deadline);
      const detail = await shopeeGet("/api/v2/order/get_order_detail", conn.shopId, accessToken, {
        order_sn_list: sns.slice(i, i + 50).join(","),
        response_optional_fields: SHOPEE_DETAIL_FIELDS,
      });
      yield (detail?.order_list ?? []).map(mapShopeeOrder);
    }
    if (!list?.more || !list?.next_cursor) return;
    cursor = String(list.next_cursor);
  }
}

async function* tiktokWindowOrders(
  conn: ShopConnection,
  accessToken: string,
  w: SyncWindow,
  deadline: number
): AsyncGenerator<NormalizedOrder[]> {
  let pageToken = "";
  for (;;) {
    checkDeadline(deadline);
    const data = await tiktokRequest({
      method: "POST",
      path: "/order/202309/orders/search",
      accessToken,
      shopCipher: conn.shopCipher,
      query: {
        page_size: "100",
        sort_field: "update_time",
        sort_order: "ASC",
        ...(pageToken ? { page_token: pageToken } : {}),
      },
      body: { update_time_ge: sec(w.from), update_time_lt: sec(w.to) },
    });
    yield (Array.isArray(data?.orders) ? data.orders : []).map(mapTikTokOrder);
    if (!data?.next_page_token) return;
    pageToken = String(data.next_page_token);
  }
}

/**
 * Pulls every order updated since the shop's cursor into the ledger, one
 * window at a time, until caught up or out of time.
 */
export async function syncOrders(conn: ShopConnection, deadline: number): Promise<OrderSyncResult> {
  if (conn.isDemo || !conn.accessToken) return { saved: 0, windows: 0, caughtUp: true };
  if (conn.platform === Platform.TIKTOK && !conn.shopCipher) return { saved: 0, windows: 0, caughtUp: true };

  const accessToken = await ensureFreshToken(conn);
  const pages = conn.platform === Platform.SHOPEE ? shopeeWindowOrders : tiktokWindowOrders;
  let cursor = conn.ordersSyncedTo;
  let saved = 0;
  let windows = 0;

  try {
    for (;;) {
      const w = nextSyncWindow(cursor, new Date());
      for await (const batch of pages(conn, accessToken, w, deadline)) {
        for (const order of batch) {
          if ((await saveOrder(conn.id, conn.platform, order)) === "saved") saved++;
        }
      }
      cursor = w.to;
      windows++;
      await prisma.shopConnection.update({
        where: { id: conn.id },
        data: { ordersSyncedTo: cursor },
      });
      if (w.last) return { saved, windows, caughtUp: true };
      checkDeadline(deadline);
    }
  } catch (err) {
    if (err instanceof OutOfTime) return { saved, windows, caughtUp: false };
    throw err;
  }
}
