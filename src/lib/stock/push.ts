import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getChannelConnector } from "@/lib/channels/registry";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { effectiveBuffer } from "@/lib/catalog/garments";
import { committedByVariant, onShelfByVariant } from "./ledger";
import { availableToSell, planPushes, PUSH_ALERT_AFTER, type PushCandidate } from "./rules";

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
  for (let shopIdx = 0; shopIdx < shops.length; shopIdx++) {
    const shop = shops[shopIdx];
    if (Date.now() >= deadline) break;
    if (shop.platform === Platform.TIKTOK && !shop.shopCipher) continue;
    const shopsLeft = shops.length - shopIdx;
    const shopDeadline = Date.now() + Math.max(0, deadline - Date.now()) / shopsLeft;
    const token = await ensureFreshToken(shop);
    const plan = planPushes(await candidatesFor(shop.id, shared));

    const byListing = new Map<string, PushCandidate[]>();
    for (const c of plan) {
      const list = byListing.get(c.listingId);
      if (list) list.push(c);
      else byListing.set(c.listingId, [c]);
    }

    const connector = getChannelConnector(shop.platform);
    for (const rows of byListing.values()) {
      if (Date.now() >= shopDeadline || Date.now() >= deadline) break;
      const res = await connector.pushListingStock(shop, token, rows);
      const targets = new Map(rows.map((r) => [r.listingVariantId, r.target]));
      const now = new Date();

      const okByTarget = new Map<number, string[]>();
      for (const id of res.ok) {
        const target = targets.get(id);
        if (target === undefined) continue;
        const ids = okByTarget.get(target);
        if (ids) ids.push(id);
        else okByTarget.set(target, [id]);
      }
      if (okByTarget.size > 0) {
        await Promise.all(
          [...okByTarget.entries()].map(([target, ids]) =>
            prisma.listingVariant.updateMany({
              where: { id: { in: ids } },
              data: { pushedStock: target, pushedAt: now, pushError: null, pushFailures: 0 },
            })
          )
        );
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
