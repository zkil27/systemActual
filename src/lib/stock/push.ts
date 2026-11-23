import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeePost } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { effectiveBuffer } from "@/lib/catalog/garments";
import { committedByVariant, onShelfByVariant } from "./ledger";
import { availableToSell, planPushes, PUSH_ALERT_AFTER, type PushCandidate } from "./rules";

/** Shopee update_stock takes up to 50 models of one item per call. */
const SHOPEE_MAX_MODELS = 50;

interface PushResult {
  ok: string[];
  failed: Array<{ id: string; error: string }>;
}

async function pushShopeeItem(shopId: string, token: string, rows: PushCandidate[]): Promise<PushResult> {
  const result: PushResult = { ok: [], failed: [] };
  for (let i = 0; i < rows.length; i += SHOPEE_MAX_MODELS) {
    const chunk = rows.slice(i, i + SHOPEE_MAX_MODELS);
    try {
      const resp = await shopeePost("/api/v2/product/update_stock", shopId, token, {
        item_id: Number(chunk[0].listingId),
        stock_list: chunk.map((r) => ({ model_id: Number(r.variationId), seller_stock: [{ stock: r.target }] })),
      });
      const failures = new Map<string, string>(
        ((resp?.failure_list ?? []) as Array<{ model_id?: number; failed_reason?: string }>).map((f) => [
          String(f.model_id ?? 0),
          String(f.failed_reason ?? "Rejected by Shopee"),
        ])
      );
      for (const r of chunk) {
        const reason = failures.get(r.variationId);
        if (reason) result.failed.push({ id: r.listingVariantId, error: reason });
        else result.ok.push(r.listingVariantId);
      }
    } catch (err) {
      for (const r of chunk) result.failed.push({ id: r.listingVariantId, error: (err as Error).message });
    }
  }
  return result;
}

async function pushTikTokProduct(shopCipher: string, token: string, rows: PushCandidate[]): Promise<PushResult> {
  const result: PushResult = { ok: [], failed: [] };
  const ready = rows.filter((r) => r.warehouseId);
  for (const r of rows) {
    if (!r.warehouseId) result.failed.push({ id: r.listingVariantId, error: "Read stock from TikTok first (warehouse unknown)." });
  }
  if (!ready.length) return result;
  try {
    await tiktokRequest({
      method: "POST",
      path: `/product/202309/products/${encodeURIComponent(ready[0].listingId)}/inventory/update`,
      accessToken: token,
      shopCipher,
      body: {
        skus: ready.map((r) => ({ id: r.variationId, inventory: [{ warehouse_id: r.warehouseId, quantity: r.target }] })),
      },
    });
    result.ok.push(...ready.map((r) => r.listingVariantId));
  } catch (err) {
    for (const r of ready) result.failed.push({ id: r.listingVariantId, error: (err as Error).message });
  }
  return result;
}

/** Stock target per listing variation of one shop (only variants with a starting count). */
async function candidatesFor(
  shopConnectionId: string,
  shared: { onShelf: Map<string, number>; committed: Map<string, number>; buffer: number }
): Promise<PushCandidate[]> {
  const listings = await prisma.listingVariant.findMany({
    where: { shopConnectionId, garmentVariant: { startingStockSetAt: { not: null } } },
    include: { garmentVariant: { select: { garment: { select: { safetyBuffer: true } } } } },
  });
  return listings.map((l) => ({
    listingVariantId: l.id,
    platform: l.platform,
    shopConnectionId: l.shopConnectionId,
    listingId: l.listingId,
    variationId: l.variationId,
    warehouseId: l.warehouseId,
    target: availableToSell(
      shared.onShelf.get(l.garmentVariantId!) ?? 0,
      shared.committed.get(l.garmentVariantId!) ?? 0,
      effectiveBuffer(l.garmentVariant?.garment.safetyBuffer, shared.buffer)
    ),
    pushedStock: l.pushedStock,
  }));
}

/**
 * Sends each listing its "available" number when it changed. Only for shops
 * whose write switch is on. Each tick pushes what fits in the time budget,
 * lowest stock first, so bursts of orders are batched naturally.
 */
export async function pushStock(deadline: number) {
  const shops = await prisma.shopConnection.findMany({
    where: { isDemo: false, writesEnabled: true, accessToken: { not: null } },
  });
  if (!shops.length) return { pushed: 0, failed: 0 };

  const [onShelf, committed, settings] = await Promise.all([
    onShelfByVariant(),
    committedByVariant(),
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { stockSafetyBuffer: true } }),
  ]);
  const shared = { onShelf, committed, buffer: settings?.stockSafetyBuffer ?? 0 };

  let pushed = 0;
  let failed = 0;
  for (const shop of shops) {
    if (Date.now() >= deadline) break;
    if (shop.platform === Platform.TIKTOK && !shop.shopCipher) continue;
    const token = await ensureFreshToken(shop);
    const plan = planPushes(await candidatesFor(shop.id, shared));

    const byListing = new Map<string, PushCandidate[]>();
    for (const c of plan) byListing.set(c.listingId, [...(byListing.get(c.listingId) ?? []), c]);

    for (const rows of byListing.values()) {
      if (Date.now() >= deadline) break;
      const res =
        shop.platform === Platform.SHOPEE
          ? await pushShopeeItem(shop.shopId, token, rows)
          : await pushTikTokProduct(shop.shopCipher!, token, rows);
      const targets = new Map(rows.map((r) => [r.listingVariantId, r.target]));
      const now = new Date();
      for (const id of res.ok) {
        await prisma.listingVariant.update({
          where: { id },
          data: { pushedStock: targets.get(id), pushedAt: now, pushError: null, pushFailures: 0 },
        });
      }
      for (const f of res.failed) {
        const updated = await prisma.listingVariant.update({
          where: { id: f.id },
          data: { pushError: f.error.slice(0, 300), pushFailures: { increment: 1 } },
          select: { pushFailures: true, name: true, variationName: true },
        });
        if (updated.pushFailures === PUSH_ALERT_AFTER) {
          await notifyOwnerTelegram(
            `STOCK NOT UPDATED on ${shop.shopName}: ${updated.name}${updated.variationName ? ` (${updated.variationName})` : ""}. ${f.error}. It will keep retrying; check Items & stock.`
          );
        }
      }
      pushed += res.ok.length;
      failed += res.failed.length;
    }
  }
  return { pushed, failed };
}
