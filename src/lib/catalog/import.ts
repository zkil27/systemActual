import { Platform, Prisma, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { autoLinkAndInitCatalog, ensureGarmentFor } from "./garments";
import {
  mapShopeeChannelProduct,
  mapShopeeItem,
  mapTikTokChannelProduct,
  mapTikTokProduct,
  type ImportedChannelProduct,
  type ImportedListing,
} from "./import-map";

/**
 * Read-only starting-stock import. Lists every active listing on the shop and
 * records its variations' "available" stock. Writes nothing to the shop.
 * Runs in ticks one page at a time, so a large catalog finishes over a few
 * minutes even with the phone closed.
 */
export const IMPORT_RUNNING = "RUNNING";
export const IMPORT_DONE = "DONE";
export const CATALOG_REFRESH_MS = 6 * 3600_000;

async function saveImported(
  conn: ShopConnection,
  rows: ImportedListing[],
  productMeta?: ImportedChannelProduct
) {
  const now = new Date();
  let channelProductId: string | null = null;
  if (productMeta) {
    const prices = Object.values(productMeta.priceByVariation).filter((n) => n > 0);
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;
    const cp = await prisma.channelProduct.upsert({
      where: {
        shopConnectionId_listingId: {
          shopConnectionId: conn.id,
          listingId: productMeta.listingId,
        },
      },
      create: {
        shopConnectionId: conn.id,
        platform: conn.platform,
        listingId: productMeta.listingId,
        title: productMeta.title,
        description: productMeta.description,
        categoryId: productMeta.categoryId,
        categoryName: productMeta.categoryName,
        status: productMeta.status,
        imageUrls: productMeta.imageUrls as Prisma.InputJsonValue,
        currency: productMeta.currency,
        minPricePhp: minPrice !== null ? new Prisma.Decimal(minPrice.toFixed(2)) : null,
        maxPricePhp: maxPrice !== null ? new Prisma.Decimal(maxPrice.toFixed(2)) : null,
        syncedAt: now,
      },
      update: {
        title: productMeta.title,
        description: productMeta.description,
        categoryId: productMeta.categoryId,
        categoryName: productMeta.categoryName,
        status: productMeta.status,
        imageUrls: productMeta.imageUrls as Prisma.InputJsonValue,
        currency: productMeta.currency,
        minPricePhp: minPrice !== null ? new Prisma.Decimal(minPrice.toFixed(2)) : null,
        maxPricePhp: maxPrice !== null ? new Prisma.Decimal(maxPrice.toFixed(2)) : null,
        syncedAt: now,
      },
      select: { id: true },
    });
    channelProductId = cp.id;
  }

  for (const r of rows) {
    const unitPrice = productMeta?.priceByVariation[r.variationId];
    const data = {
      name: r.name,
      variationName: r.variationName,
      imageUrl: r.imageUrl,
      availableStock: r.availableStock,
      stockCheckedAt: now,
      lastSeenAt: now,
      ...(r.warehouseId ? { warehouseId: r.warehouseId } : {}),
      ...(channelProductId ? { channelProductId } : {}),
      ...(unitPrice !== undefined ? { pricePhp: new Prisma.Decimal(unitPrice.toFixed(2)) } : {}),
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
      await saveImported(conn, mapShopeeItem(item, models), mapShopeeChannelProduct(item, models));
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
    const known = await prisma.listingVariant.findMany({
      where: { shopConnectionId: conn.id, listingId: { in: chunk.map((p) => String(p.id)) }, warehouseId: { not: null } },
      select: { variationId: true, warehouseId: true },
    });
    const warehouses = new Map(known.map((k) => [k.variationId, k.warehouseId!]));
    for (const product of details) {
      await saveImported(conn, mapTikTokProduct(product, warehouses), mapTikTokChannelProduct(product));
    }
  }
  const next = data?.next_page_token ? String(data.next_page_token) : null;
  return { next, done: !next };
}

/**
 * Schedules a read-only catalog/stock discovery import when a shop has never
 * been imported, and again every CATALOG_REFRESH_MS. It runs even when every
 * known listing has stock data, so a brand-new listing is found before its
 * first order. Listings seen on orders but missing stock or a TikTok
 * warehouse are picked up by the same pass.
 */
export async function maybeQueueCatalogDiscovery(conn: ShopConnection, now: Date = new Date()): Promise<boolean> {
  if (conn.isDemo || !conn.accessToken || conn.stockImportStatus === IMPORT_RUNNING) return false;
  if (conn.platform === Platform.TIKTOK && !conn.shopCipher) return false;

  const stale = !conn.stockImportedAt || now.getTime() - conn.stockImportedAt.getTime() >= CATALOG_REFRESH_MS;
  if (!stale) return false;

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
