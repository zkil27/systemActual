import { Platform, Prisma, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { syncReadyOrders } from "@/lib/ledger/sync";
import { recheckOrders } from "./recheck";
import {
  MAX_WAVE_SIZE,
  MIN_ORDER_AGE_MS,
  planWave,
  READY_ORDER_STATUSES,
  shipBlocker,
  summarizeWave,
  type WaveCandidate,
  type WaveSummary,
} from "./plan";

const PREVIEW_KEEP_MS = 24 * 3600_000;

const readyWhere = (platform?: Platform): Prisma.OrderWhereInput => ({
  cancelRequested: false,
  shopConnection: { isDemo: false, accessToken: { not: null } },
  OR: (platform ? [platform] : (Object.keys(READY_ORDER_STATUSES) as Platform[])).map((p) => ({
    platform: p,
    status: { in: READY_ORDER_STATUSES[p] },
  })),
});

export interface ReadyBreakdown {
  totalReady: number;
  coolingOff: number;
  byPlatform: { SHOPEE: number; TIKTOK: number };
  byCourier: Array<{ courier: string; count: number }>;
}

/** Fast ledger count of ready parcels by shop and courier (no external API calls). */
export async function getReadyCounts(now: Date = new Date()): Promise<ReadyBreakdown> {
  const orders = await prisma.order.findMany({
    where: readyWhere(),
    select: {
      platform: true,
      status: true,
      cancelRequested: true,
      platformCreatedAt: true,
      packages: {
        select: {
          carrier: true,
          status: true,
          trackingNumber: true,
          waveItems: { where: { activePackageId: { not: null } }, select: { id: true } },
        },
      },
    },
    take: MAX_WAVE_SIZE,
  });

  let totalReady = 0;
  let coolingOff = 0;
  const byPlatform = { SHOPEE: 0, TIKTOK: 0 };
  const courierMap = new Map<string, number>();

  for (const o of orders) {
    for (const pkg of o.packages) {
      const blocker = shipBlocker(
        {
          platform: o.platform,
          status: o.status,
          cancelRequested: o.cancelRequested,
          platformCreatedAt: o.platformCreatedAt,
          packageCount: o.packages.length,
        },
        { status: pkg.status, trackingNumber: pkg.trackingNumber, inActiveWave: pkg.waveItems.length > 0 },
        now
      );
      if (blocker === "tooNew") {
        coolingOff++;
        continue;
      }
      if (blocker) {
        if (blocker === "split") break;
        continue;
      }
      totalReady++;
      byPlatform[o.platform]++;
      const courier = normalizeCourierName(pkg.carrier);
      courierMap.set(courier, (courierMap.get(courier) ?? 0) + 1);
    }
  }

  return {
    totalReady,
    coolingOff,
    byPlatform,
    byCourier: [...courierMap.entries()]
      .map(([courier, count]) => ({ courier, count }))
      .sort((a, b) => b.count - a.count || a.courier.localeCompare(b.courier)),
  };
}

/**
 * Plans a wave without touching the shops: picks every package ready to ship,
 * re-checks each order live, and saves the order and pick list as a PREVIEW.
 */
export async function buildWavePreview(opts: {
  deadline: number;
  trigger?: string;
  now?: Date;
  /**
   * Re-fetch every order now (for an accurate preview). Waves that start
   * straight away skip this: the shipping engine re-checks every batch
   * seconds before shipping it, which is the check that matters.
   */
  recheck?: boolean;
  /** Test waves: keep only the first N packages in label order (e.g. 5 for the first live wave). */
  limit?: number;
  /** Optional filter to ship a single shop (Shopee or TikTok). */
  platform?: Platform;
  /** Optional filter to ship a single courier (e.g. "J&T Express"). */
  courier?: string;
}) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - MIN_ORDER_AGE_MS);
  const targetCourier = opts.courier ? normalizeCourierName(opts.courier) : null;

  // Pull live ready-to-ship orders from the shops first so the wave stays
  // accurate even if the incremental ledger sync is still catching up.
  const liveSyncDeadline = Date.now() + Math.max(0, opts.deadline - Date.now()) * 0.5;
  const freshLiveKeys = await syncReadyOrders(liveSyncDeadline, opts.platform);

  const [tooNew, rawCandidates] = await Promise.all([
    prisma.order.count({ where: { ...readyWhere(opts.platform), platformCreatedAt: { gt: cutoff } } }),
    prisma.order.findMany({
      where: { ...readyWhere(opts.platform), platformCreatedAt: { lte: cutoff } },
      select: {
        id: true,
        orderSn: true,
        platform: true,
        shopConnectionId: true,
        packages: { select: { carrier: true } },
      },
      orderBy: { platformCreatedAt: "asc" },
      take: MAX_WAVE_SIZE,
    }),
  ]);

  const candidates = targetCourier
    ? rawCandidates.filter((c) => c.packages.some((p) => normalizeCourierName(p.carrier) === targetCourier))
    : rawCandidates;

  let rechecked: Set<string>;
  if (opts.recheck === false) {
    rechecked = new Set(candidates.map((c) => c.id));
  } else {
    rechecked = new Set<string>();
    const needRecheck: typeof candidates = [];
    for (const c of candidates) {
      if (freshLiveKeys.has(`${c.shopConnectionId}:${c.orderSn}`)) rechecked.add(c.id);
      else needRecheck.push(c);
    }
    if (needRecheck.length) {
      for (const id of await recheckOrders(needRecheck, opts.deadline)) rechecked.add(id);
    }
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: [...rechecked] } },
    include: {
      lines: true,
      packages: { include: { waveItems: { where: { activePackageId: { not: null } }, select: { id: true } } } },
    },
  });

  // Garment names/labels for the pick list, falling back to the listing's own name.
  const listings = await prisma.listingVariant.findMany({
    where: {
      shopConnectionId: { in: [...new Set(orders.map((o) => o.shopConnectionId))] },
      listingId: { in: [...new Set(orders.flatMap((o) => o.lines.map((l) => l.listingId)))] },
    },
    include: { garmentVariant: { include: { garment: { select: { name: true } } } } },
  });
  const listingByKey = new Map(listings.map((l) => [`${l.shopConnectionId}:${l.listingId}:${l.variationId}`, l]));

  const skipped: WaveSummary["skipped"] = {
    tooNew,
    cancelled: 0,
    notReady: 0,
    split: 0,
    alreadyInWave: 0,
    notRechecked: candidates.length - rechecked.size,
  };
  const ready: WaveCandidate[] = [];

  for (const o of orders) {
    for (const pkg of o.packages) {
      if (targetCourier && normalizeCourierName(pkg.carrier) !== targetCourier) continue;
      const blocker = shipBlocker(
        { platform: o.platform, status: o.status, cancelRequested: o.cancelRequested, platformCreatedAt: o.platformCreatedAt, packageCount: o.packages.length },
        { status: pkg.status, trackingNumber: pkg.trackingNumber, inActiveWave: pkg.waveItems.length > 0 },
        now
      );
      if (blocker) {
        skipped[blocker]++;
        if (blocker === "split") break; // count the order once
        continue;
      }
      ready.push({
        packageId: pkg.id,
        orderId: o.id,
        orderSn: o.orderSn,
        platform: o.platform,
        carrier: pkg.carrier,
        channelId: pkg.channelId,
        createdAt: o.platformCreatedAt,
        lines: o.lines.map((l) => {
          const lv = listingByKey.get(`${o.shopConnectionId}:${l.listingId}:${l.variationId}`);
          const gv = lv?.garmentVariant;
          return {
            key: gv?.id ?? `${o.shopConnectionId}:${l.listingId}:${l.variationId}`,
            label: gv ? `${gv.garment.name} - ${gv.label}` : `${l.name}${l.variationName ? ` - ${l.variationName}` : ""}`,
            quantity: l.quantity,
          };
        }),
      });
    }
  }

  const planned = planWave(ready).slice(0, opts.limit && opts.limit > 0 ? opts.limit : undefined);
  const summary = summarizeWave(planned, skipped);

  await prisma.wave.deleteMany({
    where: { status: WaveStatus.PREVIEW, createdAt: { lt: new Date(now.getTime() - PREVIEW_KEEP_MS) } },
  });
  const wave = await prisma.wave.create({
    data: {
      trigger: opts.trigger ?? "MANUAL",
      parcelCount: planned.length,
      summaryJson: summary as unknown as Prisma.InputJsonValue,
    },
  });
  if (planned.length) {
    await prisma.waveItem.createMany({
      data: planned.map((p) => ({
        waveId: wave.id,
        packageId: p.packageId,
        orderId: p.orderId,
        platform: p.platform,
        groupKey: p.groupKey,
        position: p.position,
      })),
    });
  }
  return { waveId: wave.id, summary };
}
