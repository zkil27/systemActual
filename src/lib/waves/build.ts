import { Platform, Prisma, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

const readyWhere = (): Prisma.OrderWhereInput => ({
  cancelRequested: false,
  shopConnection: { isDemo: false, accessToken: { not: null } },
  OR: (Object.keys(READY_ORDER_STATUSES) as Platform[]).map((p) => ({ platform: p, status: { in: READY_ORDER_STATUSES[p] } })),
});

/**
 * Plans a wave without touching the shops: picks every package ready to ship,
 * re-checks each order live, and saves the order and pick list as a PREVIEW.
 */
export async function buildWavePreview(opts: { deadline: number; trigger?: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - MIN_ORDER_AGE_MS);

  const [tooNew, candidates] = await Promise.all([
    prisma.order.count({ where: { ...readyWhere(), platformCreatedAt: { gt: cutoff } } }),
    prisma.order.findMany({
      where: { ...readyWhere(), platformCreatedAt: { lte: cutoff } },
      select: { id: true, orderSn: true, platform: true, shopConnectionId: true },
      orderBy: { platformCreatedAt: "asc" },
      take: MAX_WAVE_SIZE,
    }),
  ]);

  const rechecked = await recheckOrders(candidates, opts.deadline);

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

  const planned = planWave(ready);
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
