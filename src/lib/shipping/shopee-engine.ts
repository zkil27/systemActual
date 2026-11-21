import { Platform, PrintJobKind, WaveItemStatus, WaveStatus, type Prisma, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeePost } from "@/lib/connectors/shopee";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { recheckOrders } from "@/lib/waves/recheck";
import {
  choosePickup,
  docCreateFailures,
  docStatuses,
  DOC_POLL_MS,
  DOC_TYPE,
  MAX_ATTEMPTS,
  RETRY_MS,
  SHIP_BATCH,
  shopeeShipDecision,
  SLOT_RETRY_MS,
  splitPackageResults,
  trackingNumbers,
  TRACKING_GIVE_UP_MS,
} from "./shopee-rules";

const itemInclude = { package: { include: { order: true } } } satisfies Prisma.WaveItemInclude;
type Item = Prisma.WaveItemGetPayload<{ include: typeof itemInclude }>;

const later = (ms: number) => new Date(Date.now() + ms);

/** Items of this shop in running waves at `status`, due now, in wave/label order. */
async function dueItems(shopId: string, status: WaveItemStatus, extra: Prisma.WaveItemWhereInput = {}) {
  return prisma.waveItem.findMany({
    where: {
      status,
      platform: Platform.SHOPEE,
      activePackageId: { not: null },
      wave: { status: WaveStatus.RUNNING },
      package: { order: { shopConnectionId: shopId } },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      ...extra,
    },
    include: itemInclude,
    orderBy: [{ wave: { createdAt: "asc" } }, { position: "asc" }],
    take: SHIP_BATCH,
  });
}

/** Ends an item. Released items can go into a later wave; arranged ones never can. */
async function finish(items: Item[], status: WaveItemStatus, error: string | null, release: boolean) {
  if (!items.length) return;
  await prisma.waveItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { status, error, nextAttemptAt: null, ...(release ? { activePackageId: null } : {}) },
  });
}

/** Not done yet: try again later, or give up after too many tries. */
async function retry(items: Item[], ms: number, reason: string, giveUp: { release: boolean }) {
  for (const i of items) {
    const attempts = i.attempts + 1;
    await prisma.waveItem.update({
      where: { id: i.id },
      data:
        attempts >= MAX_ATTEMPTS
          ? { status: WaveItemStatus.FAILED, error: reason, attempts, nextAttemptAt: null, ...(giveUp.release ? { activePackageId: null } : {}) }
          : { attempts, error: reason, nextAttemptAt: later(ms) },
    });
  }
}

async function advance(items: Item[], status: WaveItemStatus, data: Prisma.WaveItemUpdateManyMutationInput = {}) {
  if (!items.length) return;
  await prisma.waveItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { status, attempts: 0, error: null, nextAttemptAt: null, ...data },
  });
}

// ---------------------------------------------------------------- 1. arrange shipment

async function shipBatch(shop: ShopConnection, token: string, deadline: number): Promise<number> {
  const due = await dueItems(shop.id, WaveItemStatus.READY);
  if (!due.length) return 0;
  // One logistics channel per mass_ship_order call.
  const batch = due.filter((i) => i.groupKey === due[0].groupKey);

  // Fresh status for every order, right now.
  const rechecked = await recheckOrders(
    batch.map((i) => ({ id: i.package.order.id, orderSn: i.package.order.orderSn, platform: Platform.SHOPEE, shopConnectionId: shop.id })),
    deadline
  );
  const fresh = await prisma.waveItem.findMany({ where: { id: { in: batch.map((i) => i.id) } }, include: itemInclude });

  const toShip: Item[] = [];
  for (const item of fresh) {
    if (!rechecked.has(item.package.order.id)) {
      // Out of time or the shop didn't answer: try later. Not counted as a failed
      // try, so a slow day can't fail good orders. Never ship without a re-check.
      await prisma.waveItem.update({
        where: { id: item.id },
        data: { error: "Re-checking the order", nextAttemptAt: later(RETRY_MS) },
      });
      continue;
    }
    const d = shopeeShipDecision(item.package.order, item.package, Boolean(item.shipRequestedAt), new Date());
    if (d.kind === "ship") toShip.push(item);
    else if (d.kind === "arranged") await advance([item], WaveItemStatus.SHIPPING_ARRANGED, { nextAttemptAt: later(15_000) });
    else if (d.kind === "cancelled") await finish([item], WaveItemStatus.SKIPPED_CANCELLED, "Cancelled before shipping", true);
    else if (d.kind === "wait") await prisma.waveItem.update({ where: { id: item.id }, data: { error: d.reason, nextAttemptAt: later(SLOT_RETRY_MS) } });
    else await finish([item], WaveItemStatus.FAILED, d.reason, !item.shipRequestedAt);
  }
  if (!toShip.length || Date.now() >= deadline) return fresh.length;

  const numbers = toShip.map((i) => i.package.packageNumber);
  const channel = toShip[0].package.channelId ? { logistics_channel_id: Number(toShip[0].package.channelId) } : {};
  const packageList = numbers.map((n) => ({ package_number: n }));

  let params: Record<string, unknown>;
  try {
    params = await shopeePost("/api/v2/logistics/get_mass_shipping_parameter", shop.shopId, token, { ...channel, package_list: packageList });
  } catch (err) {
    // Nothing was shipped yet, so no "maybe shipped" risk here.
    await retry(toShip, RETRY_MS, (err as Error).message, { release: true });
    return fresh.length;
  }

  const paramFails = splitPackageResults(numbers, params).failed;
  const shippable = toShip.filter((i) => !paramFails.has(i.package.packageNumber));
  for (const i of toShip.filter((x) => paramFails.has(x.package.packageNumber))) {
    const reason = paramFails.get(i.package.packageNumber)!;
    // Asked before: the refusal may mean "already arranged" (by us). Re-check, never release.
    if (i.shipRequestedAt) await retry([i], RETRY_MS, reason, { release: false });
    else await finish([i], WaveItemStatus.FAILED, reason, true);
  }
  if (!shippable.length) return fresh.length;

  const pickup = choosePickup(params);
  if (!pickup.ok) {
    if (pickup.retry) await retry(shippable, SLOT_RETRY_MS, pickup.reason, { release: true });
    else await finish(shippable, WaveItemStatus.FAILED, pickup.reason, true);
    return fresh.length;
  }

  // Mark "we're asking Shopee" BEFORE the call. If anything goes wrong after
  // this, the next re-check decides whether it was shipped.
  await prisma.waveItem.updateMany({
    where: { id: { in: shippable.map((i) => i.id) } },
    data: { shipRequestedAt: new Date() },
  });
  const shipNumbers = shippable.map((i) => i.package.packageNumber);
  try {
    const resp = await shopeePost("/api/v2/logistics/mass_ship_order", shop.shopId, token, {
      ...channel,
      package_list: shipNumbers.map((n) => ({ package_number: n })),
      pickup: pickup.pickup,
    });
    const res = splitPackageResults(shipNumbers, resp);
    const byNumber = (set: (n: string) => boolean) => shippable.filter((i) => set(i.package.packageNumber));
    await advance(byNumber((n) => res.ok.has(n)), WaveItemStatus.SHIPPING_ARRANGED, { nextAttemptAt: later(15_000) });
    for (const i of byNumber((n) => res.failed.has(n))) {
      const reason = res.failed.get(i.package.packageNumber)!;
      // First try and Shopee said no: it wasn't arranged, release it.
      // Asked before (a lost reply): "no" may mean "already arranged by you". Re-check.
      if (i.shipRequestedAt) await retry([i], RETRY_MS, reason, { release: false });
      else await finish([i], WaveItemStatus.FAILED, reason, true);
    }
    // Not mentioned at all: maybe shipped. Re-check next time; never release.
    await retry(byNumber((n) => res.unknown.includes(n)), RETRY_MS, "Shopee didn't confirm. Checking again.", { release: false });
  } catch (err) {
    // Timeout or error after we asked: maybe shipped. Re-check next time; never release.
    await retry(shippable, RETRY_MS, `Checking again: ${(err as Error).message}`, { release: false });
  }
  return fresh.length;
}

// ---------------------------------------------------------------- 2. tracking numbers

async function trackingBatch(shop: ShopConnection, token: string): Promise<number> {
  const items = await dueItems(shop.id, WaveItemStatus.SHIPPING_ARRANGED);
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
      // Shipped but no waybill after 2 hours. Keep it locked (it IS arranged).
      await finish([i], WaveItemStatus.FAILED, "No tracking number from Shopee after 2 hours. Print this label from Seller Center.", false);
    } else {
      await prisma.waveItem.update({ where: { id: i.id }, data: { error: "Waiting for tracking number", nextAttemptAt: later(RETRY_MS) } });
    }
  }
  return items.length;
}

// ---------------------------------------------------------------- 3. label documents

async function docCreateBatch(shop: ShopConnection, token: string): Promise<number> {
  const items = await dueItems(shop.id, WaveItemStatus.TRACKING_ASSIGNED, { docRequestedAt: null });
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
  const items = await dueItems(shop.id, WaveItemStatus.TRACKING_ASSIGNED, { docRequestedAt: { not: null } });
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
  for (const i of items) {
    const st = statuses.get(i.package.packageNumber);
    if (st?.status === "READY") {
      if (!waveTotals.has(i.waveId)) waveTotals.set(i.waveId, await prisma.waveItem.count({ where: { waveId: i.waveId } }));
      // Ready → queue the label exactly once (the status check makes it a no-op on repeat).
      await prisma.$transaction(async (tx) => {
        const moved = await tx.waveItem.updateMany({
          where: { id: i.id, status: WaveItemStatus.TRACKING_ASSIGNED },
          data: { status: WaveItemStatus.LABEL_READY, attempts: 0, error: null, nextAttemptAt: null },
        });
        if (moved.count === 1) {
          await tx.printJob.create({
            data: {
              kind: PrintJobKind.LABEL,
              title: `Label ${i.position + 1}/${waveTotals.get(i.waveId)} · ${i.package.order.orderSn}`,
              packageId: i.packageId,
              waveId: i.waveId,
              position: i.position,
              createdAt: now,
            },
          });
        }
      });
    } else if (st?.status === "FAILED") {
      // Ask Shopee to make it again; give up after a few tries.
      const attempts = i.attempts + 1;
      await prisma.waveItem.update({
        where: { id: i.id },
        data:
          attempts >= MAX_ATTEMPTS
            ? { status: WaveItemStatus.FAILED, error: `Label not made: ${st.error ?? "unknown"}`, attempts, nextAttemptAt: null }
            : { docRequestedAt: null, attempts, error: st.error ?? null, nextAttemptAt: later(RETRY_MS) },
      });
    } else {
      await prisma.waveItem.update({ where: { id: i.id }, data: { nextAttemptAt: later(DOC_POLL_MS) } });
    }
  }
  return items.length;
}

// ---------------------------------------------------------------- driver

/**
 * Moves Shopee wave items forward as far as the time allows. Downstream steps
 * first, so labels keep flowing while new batches are shipped.
 * The shop's write switch is the kill switch for NEW shipments; packages
 * already arranged still get their tracking number and label.
 */
export async function advanceShopeeWaves(deadline: number) {
  const shops = await prisma.shopConnection.findMany({
    where: { platform: Platform.SHOPEE, isDemo: false, accessToken: { not: null } },
  });
  const waveTotals = new Map<string, number>();
  let worked = 0;
  for (const shop of shops) {
    const hasWork = await prisma.waveItem.count({
      where: { platform: Platform.SHOPEE, wave: { status: WaveStatus.RUNNING }, package: { order: { shopConnectionId: shop.id } } },
    });
    if (!hasWork) continue;
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
