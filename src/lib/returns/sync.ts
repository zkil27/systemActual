import { DigitalStatus, Platform, type Prisma, type ReturnParcel, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { upsertNormalizedReturn } from "@/lib/connectors/normalizer";
import { nextSyncWindow } from "@/lib/ledger/window";
import { findReturnedToSeller, isFailedDeliveryCandidate, type TrackingEvent } from "./classify";
import {
  mapFailedDelivery,
  mapShopeeReturn,
  mapTikTokReturn,
  shopeeReverseDeliveredAt,
  shopeeTrackingEvents,
  tiktokTrackingEvents,
  type ShopeeReverseInfo,
} from "./map";

/** Returns can be raised up to ~2 weeks after delivery; look further back on first connect. */
const RETURNS_INITIAL_LOOKBACK_MS = 21 * 24 * 3600_000;
/** Returns are much sparser than orders; 1-day windows finish a 21-day backfill in 21 calls instead of 252 while staying well inside a tick budget. */
const RETURNS_WINDOW_MS = 24 * 3600_000;
/** Open parcels are rechecked this often until they arrive or the courier says they did. */
const RECHECK_EVERY_MS = 30 * 60_000;
/** Stop asking couriers after this long; the parcel still shows as overdue. */
const RECHECK_MAX_AGE_MS = 60 * 24 * 3600_000;
const RECHECK_BATCH = 40;
const FAILED_DELIVERY_BATCH = 50;

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

class OutOfTime extends Error {}
const check = (deadline: number) => {
  if (Date.now() >= deadline) throw new OutOfTime();
};

async function ledgerOrder(platform: Platform, orderSn: string) {
  return prisma.order.findUnique({
    where: { platform_orderSn: { platform, orderSn } },
    include: { lines: true, packages: true },
  });
}

// ---------------------------------------------------------------- shared courier lookups

async function shopeeReverse(conn: ShopConnection, token: string, returnSn: string): Promise<ShopeeReverseInfo | null> {
  try {
    return await shopeeGet("/api/v2/returns/get_reverse_tracking_info", conn.shopId, token, { return_sn: returnSn });
  } catch (err) {
    console.error("[returns] get_reverse_tracking_info", returnSn, err);
    return null;
  }
}

async function shopeeForwardEvents(conn: ShopConnection, token: string, orderSn: string, packageNumber?: string | null) {
  const resp = await shopeeGet("/api/v2/logistics/get_tracking_info", conn.shopId, token, {
    order_sn: orderSn,
    ...(packageNumber ? { package_number: packageNumber } : {}),
  });
  return shopeeTrackingEvents(resp);
}

async function shopeeTrackingNumber(conn: ShopConnection, token: string, orderSn: string, packageNumber?: string | null) {
  try {
    const resp = await shopeeGet("/api/v2/logistics/get_tracking_number", conn.shopId, token, {
      order_sn: orderSn,
      ...(packageNumber ? { package_number: packageNumber } : {}),
    });
    return resp?.tracking_number ? String(resp.tracking_number) : null;
  } catch {
    return null;
  }
}

async function tiktokForwardEvents(conn: ShopConnection, token: string, orderSn: string): Promise<TrackingEvent[]> {
  const data = await tiktokRequest({
    method: "GET",
    path: `/fulfillment/202309/orders/${encodeURIComponent(orderSn)}/tracking`,
    accessToken: token,
    shopCipher: conn.shopCipher,
  });
  return tiktokTrackingEvents(data);
}

// ---------------------------------------------------------------- 1. buyer return requests (incremental)

export async function syncReturnRequests(conn: ShopConnection, token: string, deadline: number) {
  const settings = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { defaultUnitCostPhp: true },
  });
  const defaultUnitCostPhp = Number(settings?.defaultUnitCostPhp ?? 82);
  let cursor = conn.returnsSyncedTo;
  let saved = 0;
  try {
    for (;;) {
      const w = nextSyncWindow(cursor, new Date(), RETURNS_INITIAL_LOOKBACK_MS, RETURNS_WINDOW_MS);
      saved += conn.platform === Platform.SHOPEE
        ? await shopeeReturnsWindow(conn, token, w.from, w.to, deadline, defaultUnitCostPhp)
        : await tiktokReturnsWindow(conn, token, w.from, w.to, deadline, defaultUnitCostPhp);
      cursor = w.to;
      await prisma.shopConnection.update({ where: { id: conn.id }, data: { returnsSyncedTo: cursor } });
      if (w.last) return { saved, caughtUp: true };
      check(deadline);
    }
  } catch (err) {
    if (err instanceof OutOfTime) return { saved, caughtUp: false };
    throw err;
  }
}

async function shopeeReturnsWindow(
  conn: ShopConnection,
  token: string,
  from: Date,
  to: Date,
  deadline: number,
  defaultUnitCostPhp: number
) {
  let saved = 0;
  for (let pageNo = 0; ; pageNo++) {
    check(deadline);
    const resp = await shopeeGet("/api/v2/returns/get_return_list", conn.shopId, token, {
      page_no: pageNo,
      page_size: 100,
      update_time_from: sec(from),
      update_time_to: sec(to),
    });
    const list: Record<string, unknown>[] = Array.isArray(resp?.return) ? resp.return : [];
    for (const r of list) {
      check(deadline);
      const order = await ledgerOrder(Platform.SHOPEE, String(r.order_sn));
      const pkg = order?.packages.find((p) => p.trackingNumber) ?? order?.packages[0];
      const solution = Number(r.return_solution);
      const status = String(r.status ?? "").toUpperCase();
      const wantsReverse = solution !== 1 && status !== "CANCELLED" && status !== "CLOSED";
      const reverse = wantsReverse ? await shopeeReverse(conn, token, String(r.return_sn)) : null;
      await upsertNormalizedReturn(
        mapShopeeReturn(r, {
          shopConnectionId: conn.id,
          forwardTrackingNumber: pkg?.trackingNumber ?? null,
          orderCarrier: pkg?.carrier ?? null,
          variationNames: new Map(
            (order?.lines ?? []).filter((l) => l.variationName).map((l) => [l.variationId, l.variationName!])
          ),
          reverse,
        }),
        { defaultUnitCostPhp }
      );
      saved++;
    }
    if (!resp?.more || list.length === 0) return saved;
  }
}

async function tiktokReturnsWindow(
  conn: ShopConnection,
  token: string,
  from: Date,
  to: Date,
  deadline: number,
  defaultUnitCostPhp: number
) {
  let saved = 0;
  let pageToken = "";
  for (;;) {
    check(deadline);
    const data = await tiktokRequest({
      method: "POST",
      path: "/return_refund/202309/returns/search",
      accessToken: token,
      shopCipher: conn.shopCipher,
      query: { page_size: "50", sort_field: "update_time", sort_order: "ASC", ...(pageToken ? { page_token: pageToken } : {}) },
      body: { update_time_ge: sec(from), update_time_lt: sec(to) },
    });
    const list: Record<string, unknown>[] = Array.isArray(data?.return_orders) ? data.return_orders : [];
    for (const r of list) {
      const order = await ledgerOrder(Platform.TIKTOK, String(r.order_id));
      const pkg = order?.packages.find((p) => p.trackingNumber) ?? order?.packages[0];
      await upsertNormalizedReturn(
        mapTikTokReturn(r, {
          shopConnectionId: conn.id,
          forwardTrackingNumber: pkg?.trackingNumber ?? null,
          orderCarrier: pkg?.carrier ?? null,
        }),
        { defaultUnitCostPhp }
      );
      saved++;
    }
    if (!data?.next_page_token || list.length === 0) return saved;
    pageToken = String(data.next_page_token);
  }
}

// ---------------------------------------------------------------- 2. failed deliveries from the ledger

/**
 * Orders cancelled after the courier had them are on their way back. Checked
 * once per order; an API error leaves it unchecked so the next tick retries.
 */
export async function detectFailedDeliveries(conn: ShopConnection, token: string, deadline: number) {
  const [orders, settings] = await Promise.all([
    prisma.order.findMany({
      where: { shopConnectionId: conn.id, status: "CANCELLED", shippedAt: { not: null }, failedDeliveryCheckedAt: null },
      include: { lines: true, packages: true },
      orderBy: { platformUpdatedAt: "asc" },
      take: FAILED_DELIVERY_BATCH,
    }),
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { defaultUnitCostPhp: true } }),
  ]);
  const defaultUnitCostPhp = Number(settings?.defaultUnitCostPhp ?? 82);

  let created = 0;
  for (const order of orders) {
    if (Date.now() >= deadline) break;
    const isCandidate = isFailedDeliveryCandidate({
      status: order.status,
      shippedAt: order.shippedAt,
      packageStatuses: order.packages.map((p) => p.status),
    });

    if (isCandidate) {
      const pkg = order.packages[0];
      let events: TrackingEvent[];
      if (conn.platform === Platform.SHOPEE) {
        if (pkg && !pkg.trackingNumber) {
          const tn = await shopeeTrackingNumber(conn, token, order.orderSn, pkg.packageNumber);
          if (tn) {
            await prisma.package.update({ where: { id: pkg.id }, data: { trackingNumber: tn } });
            pkg.trackingNumber = tn;
          }
        }
        events = await shopeeForwardEvents(conn, token, order.orderSn, pkg?.packageNumber);
      } else {
        events = await tiktokForwardEvents(conn, token, order.orderSn);
      }

      // TikTok's rts_time is when shipment was arranged. No tracking events
      // means the courier never took it: it's still on the shelf, not coming back.
      const pickedUp = conn.platform === Platform.SHOPEE || events.length > 0;
      if (pickedUp) {
        await upsertNormalizedReturn(
          mapFailedDelivery(
            conn.platform,
            conn.id,
            {
              ...order,
              totalPhp: Number(order.totalPhp),
            },
            events
          ),
          { defaultUnitCostPhp }
        );
        created++;
      }
    }
    await prisma.order.update({ where: { id: order.id }, data: { failedDeliveryCheckedAt: new Date() } });
  }
  return { created };
}

// ---------------------------------------------------------------- 3. refresh open parcels, however old

async function markCourierReturned(parcel: ReturnParcel, at: Date, source: string, description: string) {
  await prisma.$transaction([
    prisma.returnParcel.update({
      where: { id: parcel.id },
      data: {
        courierReturnedToSellerAt: at,
        digitalStatus:
          parcel.digitalStatus === DigitalStatus.RESOLVED_REFUNDED || parcel.digitalStatus === DigitalStatus.DISPUTED
            ? parcel.digitalStatus
            : DigitalStatus.COURIER_RETURNED,
        lastCheckedAt: new Date(),
      },
    }),
    prisma.returnEvent.upsert({
      where: {
        parcelId_source_rawStatus_eventTimestamp: {
          parcelId: parcel.id,
          source,
          rawStatus: "COURIER_RETURNED",
          eventTimestamp: at,
        },
      },
      create: { parcelId: parcel.id, source, rawStatus: "COURIER_RETURNED", description, eventTimestamp: at },
      update: {},
    }),
  ]);
}

/**
 * Asks the courier about every parcel that's expected back but not yet
 * delivered, oldest-checked first, regardless of age (up to 60 days), so the
 * overdue and missing lists keep working past the old 7-day window.
 */
export function openParcelsWhere(shopConnectionId: string, now: number): Prisma.ReturnParcelWhereInput {
  return {
    shopConnectionId,
    expectsPhysicalReturn: true,
    physicallyReceivedAt: null,
    courierReturnedToSellerAt: null,
    digitalStatus: { not: DigitalStatus.CANCELLED_RETURN },
    digitalReturnTaggedAt: { gte: new Date(now - RECHECK_MAX_AGE_MS) },
    OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - RECHECK_EVERY_MS) } }],
  };
}

export async function refreshOpenParcels(conn: ShopConnection, token: string, deadline: number) {
  const parcels = await prisma.returnParcel.findMany({
    where: openParcelsWhere(conn.id, Date.now()),
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }],
    take: RECHECK_BATCH,
  });

  const CONCURRENCY = 5;
  let returned = 0;
  let checked = 0;
  for (let i = 0; i < parcels.length; i += CONCURRENCY) {
    if (Date.now() >= deadline) break;
    const chunk = parcels.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (p) => {
        try {
          const at = await courierReturnedAt(conn, token, p);
          if (at) {
            await markCourierReturned(
              p,
              at,
              conn.platform === Platform.SHOPEE ? "SHOPEE_TRACKING" : "TIKTOK_TRACKING",
              "Courier: delivered back to seller"
            );
            return true;
          }
        } catch (err) {
          console.error("[returns] refresh", p.orderSn, err);
        }
        await prisma.returnParcel.update({ where: { id: p.id }, data: { lastCheckedAt: new Date() } });
        return false;
      })
    );
    checked += chunk.length;
    returned += results.filter(Boolean).length;
  }
  return { checked, returned };
}

async function courierReturnedAt(conn: ShopConnection, token: string, p: ReturnParcel): Promise<Date | null> {
  if (conn.platform === Platform.SHOPEE) {
    if (p.returnSn) {
      const reverse = await shopeeReverse(conn, token, p.returnSn);
      const at = shopeeReverseDeliveredAt(reverse);
      if (at) return at;
      if (reverse && !p.rtsTrackingNumber && (p.returnRequestType ?? 0) === 0) {
        const tn = (reverse.rts_tracking_number ?? reverse.tracking_number) as string | undefined;
        if (tn) await prisma.returnParcel.update({ where: { id: p.id }, data: { rtsTrackingNumber: String(tn) } });
      }
      // Return on the Spot / in-transit returns also travel on the original waybill.
      if (p.category !== "FAILED_DELIVERY") return null;
    }
    const order = await ledgerOrder(Platform.SHOPEE, p.orderSn);
    return findReturnedToSeller(await shopeeForwardEvents(conn, token, p.orderSn, order?.packages[0]?.packageNumber));
  }

  // TikTok buyer returns: status comes from the returns sync; no seller-side reverse tracking call.
  if (p.category !== "FAILED_DELIVERY") return null;
  return findReturnedToSeller(await tiktokForwardEvents(conn, token, p.orderSn));
}
