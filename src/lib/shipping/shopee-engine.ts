import { Platform, WaveItemStatus, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeePost } from "@/lib/connectors/shopee";
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
  queueLabelBatch,
  retry,
  wait,
  type Item,
} from "./items";
import {
  choosePickup,
  docCreateFailures,
  docStatuses,
  DOC_POLL_MS,
  DOC_TYPE,
  MAX_ATTEMPTS,
  RETRY_MS,
  shopeeShipDecision,
  SLOT_RETRY_MS,
  splitPackageResults,
  trackingNumbers,
  TRACKING_GIVE_UP_MS,
} from "./shopee-rules";

const due = (shopId: string, status: WaveItemStatus, extra = {}) => dueItems(Platform.SHOPEE, shopId, status, extra);

// ---------------------------------------------------------------- 1. arrange shipment

async function shipBatch(shop: ShopConnection, token: string, deadline: number): Promise<number> {
  const items = await due(shop.id, WaveItemStatus.READY);
  if (!items.length) return 0;
  // One logistics channel per mass_ship_order call.
  const batch = items.filter((i) => i.groupKey === items[0].groupKey);

  // Fresh status for every order, right now.
  const rechecked = await recheckOrders(
    batch.map((i) => ({ id: i.package.order.id, orderSn: i.package.order.orderSn, platform: Platform.SHOPEE, shopConnectionId: shop.id })),
    deadline
  );
  const fresh = await prisma.waveItem.findMany({ where: { id: { in: batch.map((i) => i.id) } }, include: itemInclude });

  const toShip: Item[] = [];
  for (const item of fresh) {
    if (!rechecked.has(item.package.order.id)) {
      // Never ship without a re-check. Not counted as a failed try.
      await wait([item], RETRY_MS, "Re-checking the order");
      continue;
    }
    const d = shopeeShipDecision(item.package.order, item.package, Boolean(item.shipRequestedAt), new Date());
    if (d.kind === "ship") toShip.push(item);
    else if (d.kind === "arranged") await advance([item], WaveItemStatus.SHIPPING_ARRANGED, { nextAttemptAt: later(15_000) });
    else if (d.kind === "cancelled") await finish([item], WaveItemStatus.SKIPPED_CANCELLED, "Cancelled before shipping", true);
    else if (d.kind === "wait") await wait([item], SLOT_RETRY_MS, d.reason);
    else await finish([item], WaveItemStatus.FAILED, d.reason, !item.shipRequestedAt);
  }
  if (!toShip.length || Date.now() >= deadline) return fresh.length;

  const numbers = toShip.map((i) => i.package.packageNumber);
  const channel = toShip[0].package.channelId ? { logistics_channel_id: Number(toShip[0].package.channelId) } : {};

  let params: Record<string, unknown>;
  try {
    params = await shopeePost("/api/v2/logistics/get_mass_shipping_parameter", shop.shopId, token, {
      ...channel,
      package_list: numbers.map((n) => ({ package_number: n })),
    });
  } catch (err) {
    // No ship call made in this attempt; earlier "maybe shipped" items stay locked.
    for (const i of toShip) await retry([i], RETRY_MS, (err as Error).message, { release: !i.shipRequestedAt });
    return fresh.length;
  }

  const paramFails = splitPackageResults(numbers, params).failed;
  const shippable: Item[] = [];
  for (const i of toShip) {
    const reason = paramFails.get(i.package.packageNumber);
    if (!reason) shippable.push(i);
    // Asked before: a refusal may mean "already arranged" (by us). Re-check, never release.
    else if (i.shipRequestedAt) await retry([i], RETRY_MS, reason, { release: false });
    else await finish([i], WaveItemStatus.FAILED, reason, true);
  }
  if (!shippable.length) return fresh.length;

  const pickup = choosePickup(params);
  if (!pickup.ok) {
    for (const i of shippable) {
      if (pickup.retry) await retry([i], SLOT_RETRY_MS, pickup.reason, { release: !i.shipRequestedAt });
      else await finish([i], WaveItemStatus.FAILED, pickup.reason, !i.shipRequestedAt);
    }
    return fresh.length;
  }

  // Saved BEFORE the call: if anything goes wrong after this, the next re-check decides.
  await markShipRequested(shippable);
  const shipNumbers = shippable.map((i) => i.package.packageNumber);
  try {
    const resp = await shopeePost("/api/v2/logistics/mass_ship_order", shop.shopId, token, {
      ...channel,
      package_list: shipNumbers.map((n) => ({ package_number: n })),
      ...(pickup.pickup ? { pickup: pickup.pickup } : { dropoff: pickup.dropoff }),
    });
    const res = splitPackageResults(shipNumbers, resp);
    for (const i of shippable) {
      const n = i.package.packageNumber;
      if (res.ok.has(n)) {
        await advance([i], WaveItemStatus.SHIPPING_ARRANGED, { nextAttemptAt: later(15_000) });
      } else if (res.failed.has(n)) {
        // First try and Shopee said no: not arranged, release. Asked before: re-check.
        if (i.shipRequestedAt) await retry([i], RETRY_MS, res.failed.get(n)!, { release: false });
        else await finish([i], WaveItemStatus.FAILED, res.failed.get(n)!, true);
      } else {
        // Not mentioned: maybe shipped. Re-check next time; never release.
        await retry([i], RETRY_MS, "Shopee didn't confirm. Checking again.", { release: false });
      }
    }
  } catch (err) {
    // Timeout or error after we asked: maybe shipped. Never release.
    await retry(shippable, RETRY_MS, `Checking again: ${(err as Error).message}`, { release: false });
  }
  return fresh.length;
}

// ---------------------------------------------------------------- 2. tracking numbers

async function trackingBatch(shop: ShopConnection, token: string): Promise<number> {
  const items = await due(shop.id, WaveItemStatus.SHIPPING_ARRANGED);
  if (!items.length) return 0;
  let numbers = new Map<string, string>();
  try {
    numbers = trackingNumbers(
      await shopeePost("/api/v2/logistics/get_mass_tracking_number", shop.shopId, token, {
        package_list: items.map((i) => ({ package_number: i.package.packageNumber })),
      })
    );
  } catch (err) {
    console.error("[shopee] tracking", err);
  }
  for (const i of items) {
    const tn = numbers.get(i.package.packageNumber);
    if (tn) {
      await prisma.$transaction([
        prisma.waveItem.update({
          where: { id: i.id },
          data: { status: WaveItemStatus.TRACKING_ASSIGNED, trackingNumber: tn, attempts: 0, error: null, nextAttemptAt: null },
        }),
        prisma.package.update({ where: { id: i.packageId }, data: { trackingNumber: tn } }),
      ]);
    } else if (Date.now() - (i.shipRequestedAt ?? i.updatedAt).getTime() > TRACKING_GIVE_UP_MS) {
      // Arranged but no waybill after 2 hours. Keep the lock: it IS shipped.
      await finish([i], WaveItemStatus.FAILED, "No tracking number from Shopee after 2 hours. Print this label from Seller Center.", false);
    } else {
      await wait([i], RETRY_MS, "Waiting for tracking number");
    }
  }
  return items.length;
}

// ---------------------------------------------------------------- 3. label documents

async function docCreateBatch(shop: ShopConnection, token: string): Promise<number> {
  const items = await due(shop.id, WaveItemStatus.TRACKING_ASSIGNED, { docRequestedAt: null });
  if (!items.length) return 0;
  let fails = new Map<string, string>();
  try {
    fails = docCreateFailures(
      await shopeePost("/api/v2/logistics/create_shipping_document", shop.shopId, token, {
        order_list: items.map((i) => ({
          order_sn: i.package.order.orderSn,
          package_number: i.package.packageNumber,
          tracking_number: i.trackingNumber,
          shipping_document_type: DOC_TYPE,
        })),
      })
    );
  } catch (err) {
    await retry(items, RETRY_MS, (err as Error).message, { release: false });
    return items.length;
  }
  for (const i of items) {
    const fail = fails.get(i.package.packageNumber);
    if (fail) await retry([i], RETRY_MS, fail, { release: false });
    else await prisma.waveItem.update({ where: { id: i.id }, data: { docRequestedAt: new Date(), nextAttemptAt: later(DOC_POLL_MS) } });
  }
  return items.length;
}

async function docResultBatch(shop: ShopConnection, token: string, waveTotals: Map<string, number>): Promise<number> {
  const items = await due(shop.id, WaveItemStatus.TRACKING_ASSIGNED, { docRequestedAt: { not: null } });
  if (!items.length) return 0;
  let statuses = new Map<string, { status: string; error?: string }>();
  try {
    statuses = docStatuses(
      await shopeePost("/api/v2/logistics/get_shipping_document_result", shop.shopId, token, {
        order_list: items.map((i) => ({
          order_sn: i.package.order.orderSn,
          package_number: i.package.packageNumber,
          shipping_document_type: DOC_TYPE,
        })),
      })
    );
  } catch (err) {
    console.error("[shopee] doc result", err);
  }
  const now = new Date();
  const readyByGroup = new Map<string, Item[]>();
  for (const i of items) {
    const st = statuses.get(i.package.packageNumber);
    if (st?.status === "READY") {
      const key = `${i.waveId}:${i.groupKey}`;
      const list = readyByGroup.get(key) ?? [];
      list.push(i);
      readyByGroup.set(key, list);
    } else if (st?.status === "FAILED") {
      // Ask Shopee to make it again; give up after a few tries (still locked: it's shipped).
      const attempts = i.attempts + 1;
      await prisma.waveItem.update({
        where: { id: i.id },
        data:
          attempts >= MAX_ATTEMPTS
            ? { status: WaveItemStatus.FAILED, error: `Label not made: ${st.error ?? "unknown"}`, attempts, nextAttemptAt: null }
            : { docRequestedAt: null, attempts, error: st.error ?? null, nextAttemptAt: later(RETRY_MS) },
      });
    } else {
      await wait([i], DOC_POLL_MS, "Shopee is making the label");
    }
  }
  for (const group of readyByGroup.values()) {
    for (let idx = 0; idx < group.length; idx += 50) {
      await queueLabelBatch(group.slice(idx, idx + 50), WaveItemStatus.TRACKING_ASSIGNED, waveTotals, now);
    }
  }
  return items.length;
}

// ---------------------------------------------------------------- driver

/**
 * Moves Shopee wave items forward as far as time allows. Downstream steps
 * first, so labels keep flowing while new batches ship. The shop's write
 * switch stops NEW shipments; packages already arranged still get labels.
 */
export async function advanceShopeeWaves(deadline: number, waveTotals = new Map<string, number>()) {
  const shops = await prisma.shopConnection.findMany({
    where: { platform: Platform.SHOPEE, isDemo: false, accessToken: { not: null } },
  });
  let worked = 0;
  for (const shop of shops) {
    if (!(await hasRunningItems(Platform.SHOPEE, shop.id))) continue;
    const token = await ensureFreshToken(shop);
    for (;;) {
      if (Date.now() >= deadline) return worked;
      const n =
        (await docResultBatch(shop, token, waveTotals)) +
        (await docCreateBatch(shop, token)) +
        (await trackingBatch(shop, token)) +
        (shop.writesEnabled && Date.now() < deadline ? await shipBatch(shop, token, deadline) : 0);
      worked += n;
      if (n === 0) break;
    }
  }
  return worked;
}
