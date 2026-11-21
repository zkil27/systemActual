import { Platform, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { autoLinkAndInitCatalog, ensureGarmentFor } from "./garments";
import { mapShopeeItem, mapTikTokProduct, type ImportedListing } from "./import-map";

/**
 * Read-only starting-stock import. Lists every active listing on the shop and
 * records its variations' "available" stock. Writes nothing to the shop.
 * Runs in ticks one page at a time, so a large catalog finishes over a few
 * minutes even with the phone closed.
 */
export const IMPORT_RUNNING = "RUNNING";
export const IMPORT_DONE = "DONE";
export const CATALOG_REFRESH_MS = 6 * 3600_000;

async function saveImported(conn: ShopConnection, rows: ImportedListing[]) {
  const now = new Date();
  for (const r of rows) {
    const data = {
      name: r.name,
      variationName: r.variationName,
      imageUrl: r.imageUrl,
      availableStock: r.availableStock,
      stockCheckedAt: now,
      lastSeenAt: now,
      ...(r.warehouseId ? { warehouseId: r.warehouseId } : {}),
    };
    const lv = await prisma.listingVariant.upsert({
      where: {
        shopConnectionId_listingId_variationId: {
          shopConnectionId: conn.id,
          listingId: r.listingId,
          variationId: r.variationId,
        },
      },
      create: { shopConnectionId: conn.id, platform: conn.platform, listingId: r.listingId, variationId: r.variationId, ...data },
      update: data,
    });
    await ensureGarmentFor(lv);
  }
}

async function shopeePage(conn: ShopConnection, token: string, offset: number, deadline: number) {
  const list = await shopeeGet("/api/v2/product/get_item_list", conn.shopId, token, {
    offset,
    page_size: 50,
    item_status: "NORMAL",
  });
  const ids: string[] = (list?.item ?? []).map((i: { item_id: number }) => String(i.item_id));
  if (ids.length) {
    const base = await shopeeGet("/api/v2/product/get_item_base_info", conn.shopId, token, {
      item_id_list: ids.join(","),
    });
    for (const item of (base?.item_list ?? []) as Record<string, unknown>[]) {
      if (Date.now() >= deadline) return { next: String(offset), done: false };
      const models = item.has_model
        ? await shopeeGet("/api/v2/product/get_model_list", conn.shopId, token, { item_id: String(item.item_id) })
        : null;
      await saveImported(conn, mapShopeeItem(item, models));
    }
  }
  const done = !list?.has_next_page;
  return { next: done ? null : String(list?.next_offset ?? offset + ids.length), done };
}

async function tiktokPage(conn: ShopConnection, token: string, pageToken: string, deadline: number) {
  const data = await tiktokRequest({
    method: "POST",
    path: "/product/202502/products/search",
    accessToken: token,
    shopCipher: conn.shopCipher,
    query: { page_size: "10", ...(pageToken ? { page_token: pageToken } : {}) },
    body: { status: "ACTIVATE" },
  });
  const products = (data?.products ?? []) as Array<{ id: string }>;
  const CHUNK = 5;
  for (let i = 0; i < products.length; i += CHUNK) {
    if (Date.now() >= deadline) return { next: pageToken, done: false };
    const chunk = products.slice(i, i + CHUNK);
    const details = await Promise.all(
      chunk.map((p) =>
        tiktokRequest({
          method: "GET",
          path: `/product/202309/products/${encodeURIComponent(p.id)}`,
          accessToken: token,
          shopCipher: conn.shopCipher,
        })
      )
    );
    for (const product of details) {
      await saveImported(conn, mapTikTokProduct(product));
    }
  }
  const next = data?.next_page_token ? String(data.next_page_token) : null;
  return { next, done: !next };
}

/**
 * Automatically schedules a catalog/stock discovery import when a shop has
 * never been imported or has new listings discovered from orders without shop
 * stock or TikTok warehouse IDs.
 */
export async function maybeQueueCatalogDiscovery(conn: ShopConnection, now: Date = new Date()): Promise<boolean> {
  if (conn.isDemo || !conn.accessToken || conn.stockImportStatus === IMPORT_RUNNING) return false;
  if (conn.platform === Platform.TIKTOK && !conn.shopCipher) return false;

  const stale = !conn.stockImportedAt || now.getTime() - conn.stockImportedAt.getTime() >= CATALOG_REFRESH_MS;
  if (!stale) return false;

  const needsDiscovery =
    !conn.stockImportedAt ||
    (await prisma.listingVariant.count({
      where: {
        shopConnectionId: conn.id,
        OR: [
          { availableStock: null },
          ...(conn.platform === Platform.TIKTOK ? [{ warehouseId: null }] : []),
        ],
      },
    })) > 0;

  if (!needsDiscovery) return false;
  await prisma.shopConnection.update({
    where: { id: conn.id },
    data: { stockImportStatus: IMPORT_RUNNING, stockImportCursor: null },
  });
  return true;
}

/**
 * Advances a running import by as many pages as fit before the deadline. A page
 * interrupted partway is redone next tick (saving is idempotent).
 */
export async function runStockImport(conn: ShopConnection, token: string, deadline: number) {
  if (conn.stockImportStatus !== IMPORT_RUNNING) return { pages: 0, done: false };
  let cursor = conn.stockImportCursor ?? "";
  let pages = 0;
  while (Date.now() < deadline) {
    const page =
      conn.platform === Platform.SHOPEE
        ? await shopeePage(conn, token, Number(cursor || 0), deadline)
        : await tiktokPage(conn, token, cursor, deadline);
    if (page.done) {
      await prisma.shopConnection.update({
        where: { id: conn.id },
        data: { stockImportStatus: IMPORT_DONE, stockImportCursor: null, stockImportedAt: new Date() },
      });
      try {
        await autoLinkAndInitCatalog();
      } catch (err) {
        console.error("[stock import auto-link]", err);
      }
      return { pages: pages + 1, done: true };
    }
    if (page.next === cursor && Date.now() >= deadline) break; // interrupted mid-page
    cursor = page.next ?? "";
    pages++;
    await prisma.shopConnection.update({ where: { id: conn.id }, data: { stockImportCursor: cursor } });
  }
  return { pages, done: false };
}
