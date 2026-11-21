import { Platform, WaveItemStatus, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { recheckOrders } from "@/lib/waves/recheck";
import {
  advance,
  dueItems,
  finish,
  hasRunningItems,
  itemInclude,
  later,
  markShipRequested,
  queueLabel,
  retry,
  wait,
  type Item,
} from "./items";
import {
  chooseTikTokHandover,
  LABEL_POLL_MS,
  LABEL_SIZE,
  RETRY_MS,
  SLOT_RETRY_MS,
  tiktokLabel,
  tiktokShipDecision,
  tiktokShipErrors,
  TRACKING_GIVE_UP_MS,
} from "./tiktok-rules";

const due = (shopId: string, status: WaveItemStatus) => dueItems(Platform.TIKTOK, shopId, status);

function call(shop: ShopConnection, token: string, opts: { method: "GET" | "POST"; path: string; query?: Record<string, string>; body?: Record<string, unknown> }) {
  return tiktokRequest({ ...opts, accessToken: token, shopCipher: shop.shopCipher });
}

export async function tiktokShippingDocument(shop: ShopConnection, token: string, packageId: string) {
  return call(shop, token, {
    method: "GET",
    path: `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_documents`,
    query: { document_type: "SHIPPING_LABEL", document_size: LABEL_SIZE },
  });
}

// ---------------------------------------------------------------- 1. arrange shipment

async function shipBatch(shop: ShopConnection, token: string, deadline: number): Promise<number> {
  const items = await due(shop.id, WaveItemStatus.READY);
  if (!items.length) return 0;
  const batch = items.filter((i) => i.groupKey === items[0].groupKey);

  const rechecked = await recheckOrders(
    batch.map((i) => ({ id: i.package.order.id, orderSn: i.package.order.orderSn, platform: Platform.TIKTOK, shopConnectionId: shop.id })),
    deadline
  );
  const fresh = await prisma.waveItem.findMany({ where: { id: { in: batch.map((i) => i.id) } }, include: itemInclude });

  const toShip: Item[] = [];
  for (const item of fresh) {
    if (!rechecked.has(item.package.order.id)) {
      await wait([item], RETRY_MS, "Re-checking the order");
      continue;
    }
    const d = tiktokShipDecision(item.package.order, item.package, Boolean(item.shipRequestedAt), new Date());
    if (d.kind === "ship") toShip.push(item);
    else if (d.kind === "arranged") await advance([item], WaveItemStatus.SHIPPING_ARRANGED, { nextAttemptAt: later(15_000) });
    else if (d.kind === "cancelled") await finish([item], WaveItemStatus.SKIPPED_CANCELLED, "Cancelled before shipping", true);
    else if (d.kind === "wait") await wait([item], SLOT_RETRY_MS, d.reason);
    else await finish([item], WaveItemStatus.FAILED, d.reason, !item.shipRequestedAt);
  }
  if (!toShip.length || Date.now() >= deadline) return fresh.length;

  // Packages on the same courier share pickup slots; ask once per batch.
  let slots: Record<string, unknown>;
  try {
    slots = await call(shop, token, {
      method: "GET",
      path: `/fulfillment/202309/packages/${encodeURIComponent(toShip[0].package.packageNumber)}/handover_time_slots`,
    });
  } catch (err) {
    for (const i of toShip) await retry([i], RETRY_MS, (err as Error).message, { release: !i.shipRequestedAt });
    return fresh.length;
  }
  const pickup = chooseTikTokHandover(slots, new Date());
  if (!pickup.ok) {
    for (const i of toShip) {
      if (pickup.retry) await retry([i], SLOT_RETRY_MS, pickup.reason, { release: !i.shipRequestedAt });
      else await finish([i], WaveItemStatus.FAILED, pickup.reason, !i.shipRequestedAt);
    }
    return fresh.length;
  }

  // Saved BEFORE the call: if anything goes wrong after this, the next re-check decides.
  await markShipRequested(toShip);
  try {
    const resp = await call(shop, token, {
      method: "POST",
      path: "/fulfillment/202309/packages/ship",
      body: {
        packages: toShip.map((i) => ({
          id: i.package.packageNumber,
          handover_method: pickup.handoverMethod,
          ...(pickup.slot ? { pickup_slot: pickup.slot } : {}),
        })),
      },
    });
    // code 0 can still carry per-package failures; anything not listed was shipped.
    const { byPackage, unattributed } = tiktokShipErrors(resp);
    for (const i of toShip) {
      const reason = byPackage.get(i.package.packageNumber);
      if (!reason && unattributed.length) {
        // An error we can't pin to a package: maybe shipped, maybe not. Re-check; never release.
        await retry([i], RETRY_MS, `Checking again: ${unattributed[0]}`, { release: false });
      } else if (!reason) {
        await advance([i], WaveItemStatus.SHIPPING_ARRANGED, { nextAttemptAt: later(15_000) });
      } else if (i.shipRequestedAt) {
        // Asked before (a lost reply): the error may mean "already shipped by you". Re-check.
        await retry([i], RETRY_MS, reason, { release: false });
      } else {
        await finish([i], WaveItemStatus.FAILED, reason, true);
      }
    }
  } catch (err) {
    // Timeout, or a top-level error after we asked: maybe shipped. Never release.
    await retry(toShip, RETRY_MS, `Checking again: ${(err as Error).message}`, { release: false });
  }
  return fresh.length;
}

// ---------------------------------------------------------------- 2. label (TikTok returns the waybill with it)

async function labelBatch(shop: ShopConnection, token: string, waveTotals: Map<string, number>, deadline: number): Promise<number> {
  const items = await due(shop.id, WaveItemStatus.SHIPPING_ARRANGED);
  if (!items.length) return 0;
  const now = new Date();
  const docExpiresAt = new Date(now.getTime() + 20 * 3600_000);
  const CONCURRENCY = 5;
  let done = 0;

  for (let idx = 0; idx < items.length; idx += CONCURRENCY) {
    if (Date.now() >= deadline) break;
    const chunk = items.slice(idx, idx + CONCURRENCY);
    const fetched = await Promise.all(
      chunk.map(async (item) => {
        let label = { url: null as string | null, trackingNumber: null as string | null };
        try {
          label = tiktokLabel(await tiktokShippingDocument(shop, token, item.package.packageNumber));
        } catch (err) {
          console.error("[tiktok] label", item.package.packageNumber, err);
        }
        return { item, label };
      })
    );

    for (const { item: i, label } of fetched) {
      done++;
      if (label.url) {
        await queueLabel(
          i,
          WaveItemStatus.SHIPPING_ARRANGED,
          waveTotals,
          now,
          label.trackingNumber ?? undefined,
          { url: label.url, expiresAt: docExpiresAt }
        );
      } else if (Date.now() - (i.shipRequestedAt ?? i.updatedAt).getTime() > TRACKING_GIVE_UP_MS) {
        // Shipped but no label after 2 hours. Keep the lock: it IS shipped.
        await finish([i], WaveItemStatus.FAILED, "No label from TikTok after 2 hours. Print it from Seller Center.", false);
      } else {
        await wait([i], LABEL_POLL_MS, "Waiting for TikTok to make the label");
      }
    }
  }
  return done;
}

// ---------------------------------------------------------------- driver

/** Same rules as Shopee: labels first, then new shipments only if the write switch is on. */
export async function advanceTikTokWaves(deadline: number, waveTotals = new Map<string, number>()) {
  const shops = await prisma.shopConnection.findMany({
    where: { platform: Platform.TIKTOK, isDemo: false, accessToken: { not: null }, shopCipher: { not: null } },
  });
  let worked = 0;
  for (const shop of shops) {
    if (!(await hasRunningItems(Platform.TIKTOK, shop.id))) continue;
    const token = await ensureFreshToken(shop);
    for (;;) {
      if (Date.now() >= deadline) return worked;
      const n =
        (await labelBatch(shop, token, waveTotals, deadline)) +
        (shop.writesEnabled && Date.now() < deadline ? await shipBatch(shop, token, deadline) : 0);
      worked += n;
      if (n === 0) break;
    }
  }
  return worked;
}
