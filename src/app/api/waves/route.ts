import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { Platform, PrintJobKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { buildWavePreview, getReadyCounts } from "@/lib/waves/build";
import { reprintLabel, retryFailed, retryItem, shipNow, startWave, WaveStartError } from "@/lib/waves/run";
import { isContinuousWave, nextWaveAt, parseWaveTimes } from "@/lib/waves/schedule";
import { runTick } from "@/lib/worker/tick";
import {
  parsePickItemLabel,
  type WaveParcel,
  type WaveParcelLine,
  type WaveSummary,
} from "@/lib/waves/plan";

export const maxDuration = 60;
/** Leave room to save the wave after the live re-check. */
const RECHECK_BUDGET_MS = 40_000;

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  if (req.nextUrl.searchParams.get("mode") === "progress") {
    const waves = await prisma.wave.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true },
    });
    const waveIds = waves.map((w) => w.id);
    const [counts, failed] = await Promise.all([
      prisma.waveItem.groupBy({
        by: ["waveId", "status"],
        where: { waveId: { in: waveIds } },
        _count: { _all: true },
      }),
      prisma.waveItem.findMany({
        where: { waveId: { in: waveIds }, status: "FAILED" },
        select: {
          id: true,
          waveId: true,
          error: true,
          package: { select: { order: { select: { orderSn: true } } } },
        },
        orderBy: { position: "asc" },
        take: 50,
      }),
    ]);
    return NextResponse.json({
      waves: waves.map((w) => ({
        id: w.id,
        status: w.status,
        progress: Object.fromEntries(
          counts.filter((c) => c.waveId === w.id).map((c) => [c.status, c._count._all])
        ),
        failed: failed
          .filter((f) => f.waveId === w.id)
          .map((f) => ({ id: f.id, orderSn: f.package.order.orderSn, error: f.error })),
      })),
    });
  }

  const [waves, writable, settings, readyBreakdown] = await Promise.all([
    prisma.wave.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.shopConnection.count({ where: { isDemo: false, writesEnabled: true, accessToken: { not: null } } }),
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { waveTimes: true, wavesAutoEnabled: true } }),
    getReadyCounts(),
  ]);
  const times = parseWaveTimes(settings?.waveTimes ?? "");
  const continuous = isContinuousWave(settings?.waveTimes ?? "");
  const waveIds = waves.map((w) => w.id);
  const latestWave = waves[0];
  const [counts, failed, rawLatestItems] = await Promise.all([
    prisma.waveItem.groupBy({
      by: ["waveId", "status"],
      where: { waveId: { in: waveIds } },
      _count: { _all: true },
    }),
    prisma.waveItem.findMany({
      where: { waveId: { in: waveIds }, status: "FAILED" },
      select: { id: true, waveId: true, error: true, package: { select: { order: { select: { orderSn: true } } } } },
      orderBy: { position: "asc" },
      take: 50,
    }),
    latestWave
      ? prisma.waveItem.findMany({
          where: { waveId: latestWave.id },
          orderBy: { position: "asc" },
          include: {
            package: {
              include: {
                order: {
                  include: {
                    lines: true,
                    shopConnection: { select: { shopName: true } },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const shopIds = [...new Set(rawLatestItems.map((wi) => wi.package.order.shopConnectionId))];
  const listingIds = [
    ...new Set(rawLatestItems.flatMap((wi) => wi.package.order.lines.map((l) => l.listingId))),
  ];
  const listings =
    shopIds.length && listingIds.length
      ? await prisma.listingVariant.findMany({
          where: {
            shopConnectionId: { in: shopIds },
            listingId: { in: listingIds },
          },
          include: {
            garmentVariant: {
              include: { garment: { select: { name: true, imageUrl: true } } },
            },
          },
        })
      : [];
  const listingByKey = new Map(
    listings.map((l) => [`${l.shopConnectionId}:${l.listingId}:${l.variationId}`, l])
  );

  const totalInWave = latestWave ? latestWave.parcelCount || rawLatestItems.length : 0;
  const latestParcels: WaveParcel[] = rawLatestItems.map((wi) => {
    const pkg = wi.package;
    const o = pkg.order;
    const lines: WaveParcelLine[] = o.lines
      .map((l) => {
        const lv = listingByKey.get(`${o.shopConnectionId}:${l.listingId}:${l.variationId}`);
        const gv = lv?.garmentVariant;
        const label = gv
          ? `${gv.garment.name} - ${gv.label}`
          : `${l.name}${l.variationName ? ` - ${l.variationName}` : ""}`;
        const parsed = parsePickItemLabel(label);
        return {
          id: l.id,
          key: gv?.id ?? `${o.shopConnectionId}:${l.listingId}:${l.variationId}`,
          label,
          name: parsed.garmentName,
          shortName: parsed.shortGarmentName || parsed.garmentName,
          variationName: parsed.variation ?? l.variationName ?? null,
          color: parsed.color,
          size: parsed.size,
          imageUrl: l.imageUrl ?? lv?.imageUrl ?? gv?.garment.imageUrl ?? null,
          quantity: l.quantity,
          unitPricePhp: Number(l.unitPricePhp),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      id: wi.id,
      packageId: wi.packageId,
      orderId: wi.orderId,
      orderSn: o.orderSn,
      platform: o.platform,
      shopName: o.shopConnection.shopName,
      groupKey: wi.groupKey,
      position: wi.position + 1,
      totalInWave,
      status: wi.status,
      orderStatus: o.status,
      error: wi.error,
      courier: normalizeCourierName(pkg.carrier),
      trackingNumber: wi.trackingNumber ?? pkg.trackingNumber ?? null,
      packageNumber: pkg.packageNumber,
      isCod: o.isCod,
      totalPhp: Number(o.totalPhp),
      createdAt: o.platformCreatedAt.toISOString(),
      shippedAt: o.shippedAt?.toISOString() ?? null,
      totalPieces: lines.reduce((sum, l) => sum + l.quantity, 0),
      lines,
    };
  });

  return NextResponse.json({
    canShip: writable > 0,
    readyBreakdown,
    schedule: {
      auto: Boolean(settings?.wavesAutoEnabled),
      continuous,
      times,
      nextAt: settings?.wavesAutoEnabled ? nextWaveAt(new Date(), times, continuous)?.toISOString() ?? null : null,
    },
    waves: waves.map((w, idx) => ({
      id: w.id,
      status: w.status,
      trigger: w.trigger,
      parcelCount: w.parcelCount,
      createdAt: w.createdAt.toISOString(),
      summary: w.summaryJson as unknown as WaveSummary,
      progress: Object.fromEntries(counts.filter((c) => c.waveId === w.id).map((c) => [c.status, c._count._all])),
      failed: failed
        .filter((f) => f.waveId === w.id)
        .map((f) => ({ id: f.id, orderSn: f.package.order.orderSn, error: f.error })),
      parcels: idx === 0 ? latestParcels : [],
    })),
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preview"),
    limit: z.number().int().min(1).max(2500).optional(),
    platform: z.enum([Platform.SHOPEE, Platform.TIKTOK]).optional(),
    courier: z.string().min(1).max(64).optional(),
  }),
  z.object({ action: z.literal("print_pick_list"), waveId: z.string().min(1) }),
  z.object({ action: z.literal("start"), waveId: z.string().min(1) }),
  z.object({
    action: z.literal("ship_now"),
    platform: z.enum([Platform.SHOPEE, Platform.TIKTOK]).optional(),
    courier: z.string().min(1).max(64).optional(),
  }),
  z.object({ action: z.literal("retry_item"), itemId: z.string().min(1) }),
  z.object({ action: z.literal("retry_failed"), waveId: z.string().min(1) }),
  z.object({ action: z.literal("reprint"), orderSn: z.string().min(3).max(64) }),
]);

export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    if (parsed.data.action === "preview") {
      // Read-only: nothing is shipped or changed on the shops.
      const result = await buildWavePreview({
        deadline: Date.now() + RECHECK_BUDGET_MS,
        limit: parsed.data.limit,
        platform: parsed.data.platform,
        courier: parsed.data.courier,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const kick = () => after(() => runTick("manual").catch((err) => console.error("[wave tick]", err)));
    try {
      switch (parsed.data.action) {
        case "start": {
          // Arranges shipment on the shops (can't be undone). Each order is
          // re-checked again just before it's shipped.
          const result = await startWave(parsed.data.waveId);
          kick();
          return NextResponse.json({ ok: true, ...result });
        }
        case "ship_now": {
          const result = await shipNow("MANUAL", new Date(), {
            platform: parsed.data.platform,
            courier: parsed.data.courier,
          });
          if (result.shipping) kick();
          return NextResponse.json({ ok: true, ...result });
        }
        case "retry_item":
          await retryItem(parsed.data.itemId);
          kick();
          return NextResponse.json({ ok: true });
        case "retry_failed": {
          const retried = await retryFailed(parsed.data.waveId);
          if (retried) kick();
          return NextResponse.json({ ok: true, retried });
        }
        case "reprint":
          return NextResponse.json({ ok: true, ...(await reprintLabel(parsed.data.orderSn)) });
      }
    } catch (err) {
      if (err instanceof WaveStartError) return NextResponse.json({ error: err.message }, { status: 409 });
      throw err;
    }

    const wave = await prisma.wave.findUnique({ where: { id: parsed.data.waveId } });
    if (!wave) return NextResponse.json({ error: "Wave not found." }, { status: 404 });
    if (!(await prisma.printDevice.count())) {
      return NextResponse.json({ error: "Set up the printer PC first (Settings → Printer)." }, { status: 400 });
    }
    await prisma.printJob.create({
      data: { kind: PrintJobKind.PICK_LIST, title: `Pick list (${wave.parcelCount} parcels)`, waveId: wave.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[waves]", err);
    return NextResponse.json({ error: "Couldn't plan the wave. Try again." }, { status: 500 });
  }
}
