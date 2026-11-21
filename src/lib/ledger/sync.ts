import { Platform, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { mapShopeeOrder, mapTikTokOrder, type NormalizedOrder } from "./normalize";
import { saveOrder, saveOrderBatch } from "./store";
import { nextSyncWindow, type SyncWindow } from "./window";

export interface OrderSyncResult {
  saved: number;
  windows: number;
  caughtUp: boolean;
}

export const SHOPEE_DETAIL_FIELDS = [
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
        // A 100-order page can take ~17s to come back; smaller pages leave
        // time in the tick to save what was fetched.
        page_size: "50",
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
  // TikTok pages come sorted by update_time ascending, so everything up to the
  // last processed order is done. Keeping that point lets a window too busy for
  // one tick finish over several ticks instead of restarting from its start.
  const canResumeMidWindow = conn.platform === Platform.TIKTOK;
  const seenListings = new Set<string>();
  const progress: { lastProcessedAt: Date | null } = { lastProcessedAt: null };

  try {
    for (;;) {
      const w = nextSyncWindow(cursor, new Date());
      for await (const batch of pages(conn, accessToken, w, deadline)) {
        if (!batch.length) continue;
        const res = await saveOrderBatch(conn.id, conn.platform, batch, {
          seenListings,
          beforeChunk: () => {
            if (canResumeMidWindow) checkDeadline(deadline);
          },
          onChunkDone: (chunk) => {
            progress.lastProcessedAt = chunk[chunk.length - 1].updatedAt;
          },
        });
        saved += res.saved;
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
    if (err instanceof OutOfTime) {
      const { lastProcessedAt } = progress;
      if (canResumeMidWindow && lastProcessedAt && (!cursor || lastProcessedAt > cursor)) {
        await prisma.shopConnection.update({
          where: { id: conn.id },
          data: { ordersSyncedTo: lastProcessedAt },
        });
      }
      return { saved, windows, caughtUp: false };
    }
    throw err;
  }
}

/**
 * Fetches and saves one specific order immediately (used by webhooks so new
 * orders and status changes show up in <1s without waiting for cursor backfill).
 */
export async function syncSingleOrder(
  platform: Platform,
  orderSn: string,
  shopExternalId?: string
): Promise<boolean> {
  if (!orderSn) return false;
  const shop = await prisma.shopConnection.findFirst({
    where: {
      platform,
      isDemo: false,
      accessToken: { not: null },
      ...(shopExternalId ? { shopId: shopExternalId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!shop || (platform === Platform.TIKTOK && !shop.shopCipher)) return false;

  const token = await ensureFreshToken(shop);
  const raw: Record<string, unknown> | undefined =
    platform === Platform.SHOPEE
      ? (
          await shopeeGet("/api/v2/order/get_order_detail", shop.shopId, token, {
            order_sn_list: orderSn,
            response_optional_fields: SHOPEE_DETAIL_FIELDS,
          })
        )?.order_list?.[0]
      : (
          await tiktokRequest({
            method: "GET",
            path: "/order/202309/orders",
            accessToken: token,
            shopCipher: shop.shopCipher,
            query: { ids: orderSn },
          })
        )?.orders?.[0];
  if (!raw) return false;

  const normalized = platform === Platform.SHOPEE ? mapShopeeOrder(raw) : mapTikTokOrder(raw);
  await saveOrder(shop.id, platform, normalized, new Date());
  await prisma.shopConnection.update({
    where: { id: shop.id },
    data: { lastSyncedAt: new Date() },
  });
  return true;
}

const SHOPEE_READY_LOOKBACK_MS = 14 * 24 * 3600_000;

/**
 * Pulls live ready-to-ship orders directly from every connected shop into the
 * ledger (by status, independent of `ordersSyncedTo`). Used by wave planning
 * so previews and waves stay accurate even if incremental sync is behind.
 * Returns `${shopConnectionId}:${orderSn}` keys for orders verified live now.
 */
export async function syncReadyOrders(deadline: number, platform?: Platform): Promise<Set<string>> {
  const fresh = new Set<string>();
  const shops = await prisma.shopConnection.findMany({
    where: {
      isDemo: false,
      accessToken: { not: null },
      ...(platform ? { platform } : {}),
    },
    orderBy: { platform: "asc" },
  });

  await Promise.allSettled(
    shops.map(async (shop) => {
      if (Date.now() >= deadline) return;
      if (shop.platform === Platform.TIKTOK && !shop.shopCipher) return;
      let token: string;
      try {
        token = await ensureFreshToken(shop);
      } catch (err) {
        console.error("[syncReadyOrders] token", shop.shopName, err);
        return;
      }

      const seenListings = new Set<string>();
      try {
        if (shop.platform === Platform.TIKTOK) {
          let pageToken = "";
          for (;;) {
            checkDeadline(deadline);
            const data = await tiktokRequest({
              method: "POST",
              path: "/order/202309/orders/search",
              accessToken: token,
              shopCipher: shop.shopCipher,
              query: { page_size: "50", ...(pageToken ? { page_token: pageToken } : {}) },
              body: { order_status: "AWAITING_SHIPMENT" },
            });
            const batch: NormalizedOrder[] = (Array.isArray(data?.orders) ? data.orders : []).map(mapTikTokOrder);
            if (batch.length) {
              await saveOrderBatch(shop.id, Platform.TIKTOK, batch, {
                seenListings,
                beforeChunk: () => checkDeadline(deadline),
                onChunkDone: (chunk) => {
                  for (const o of chunk) fresh.add(`${shop.id}:${o.orderSn}`);
                },
              });
            }
            if (!data?.next_page_token) break;
            pageToken = String(data.next_page_token);
          }
        } else if (shop.platform === Platform.SHOPEE) {
          const now = new Date();
          const from = new Date(now.getTime() - SHOPEE_READY_LOOKBACK_MS);
          for (const orderStatus of ["READY_TO_SHIP", "RETRY_SHIP"]) {
            let cursor = "";
            for (;;) {
              checkDeadline(deadline);
              const list = await shopeeGet("/api/v2/order/get_order_list", shop.shopId, token, {
                time_range_field: "create_time",
                time_from: sec(from),
                time_to: sec(now),
                order_status: orderStatus,
                page_size: 100,
                ...(cursor ? { cursor } : {}),
              });
              const sns: string[] = (list?.order_list ?? []).map((o: { order_sn: string }) => String(o.order_sn));
              for (let i = 0; i < sns.length; i += 50) {
                checkDeadline(deadline);
                const detail = await shopeeGet("/api/v2/order/get_order_detail", shop.shopId, token, {
                  order_sn_list: sns.slice(i, i + 50).join(","),
                  response_optional_fields: SHOPEE_DETAIL_FIELDS,
                });
                const batch: NormalizedOrder[] = (detail?.order_list ?? []).map(mapShopeeOrder);
                if (batch.length) {
                  await saveOrderBatch(shop.id, Platform.SHOPEE, batch, {
                    seenListings,
                    beforeChunk: () => checkDeadline(deadline),
                    onChunkDone: (chunk) => {
                      for (const o of chunk) fresh.add(`${shop.id}:${o.orderSn}`);
                    },
                  });
                }
              }
              if (!list?.more || !list?.next_cursor) break;
              cursor = String(list.next_cursor);
            }
          }
        }
      } catch (err) {
        if (err instanceof OutOfTime) return;
        console.error("[syncReadyOrders]", shop.shopName, err);
      }
    })
  );

  return fresh;
}
