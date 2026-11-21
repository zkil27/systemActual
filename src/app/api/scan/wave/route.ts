import { NextResponse } from "next/server";
import { WaveItemStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactOutboundPackageForStaff } from "@/lib/auth";
import {
  cancelledToPullWhere,
  enrichPackageLineImages,
  OUTBOUND_PACKAGE_INCLUDE,
  unpickedPrintedWhere,
} from "@/lib/shipping/outbound";
import { groupPickItems, parsePickItemLabel, type WaveSummary } from "@/lib/waves/plan";

export interface StaffPickVariant {
  label: string;
  color: string | null;
  size: string | null;
  qty: number;
  garmentVariantId: string | null;
}

export interface StaffPickGarmentGroup {
  key: string;
  shortName: string;
  fullName: string;
  imageUrl: string | null;
  totalQty: number;
  variants: StaffPickVariant[];
}

export interface StaffPickGroup {
  key: string;
  title: string;
  count: number;
  garments: StaffPickGarmentGroup[];
}

export async function GET() {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unlock the scanner with your 4-digit PIN first." },
      { status: 401 }
    );
  }

  const now = new Date();
  const [latestWave, cancelledItems, unpickedItems] = await Promise.all([
    prisma.wave.findFirst({
      where: { status: { in: [WaveStatus.RUNNING, WaveStatus.DONE, WaveStatus.PREVIEW] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.waveItem.findMany({
      where: cancelledToPullWhere(now),
      include: { package: { include: OUTBOUND_PACKAGE_INCLUDE } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.waveItem.findMany({
      where: unpickedPrintedWhere(now),
      include: { package: { include: OUTBOUND_PACKAGE_INCLUDE } },
      orderBy: [{ wave: { createdAt: "asc" } }, { position: "asc" }],
      take: 150,
    }),
  ]);

  const [enrichedCancelled, enrichedUnpicked] = await Promise.all([
    enrichPackageLineImages(cancelledItems.map((c) => c.package)),
    enrichPackageLineImages(unpickedItems.map((u) => u.package)),
  ]);

  const cancelledToPull = enrichedCancelled.map(redactOutboundPackageForStaff);
  const unpickedParcels = enrichedUnpicked.map(redactOutboundPackageForStaff);

  if (!latestWave) {
    return NextResponse.json({
      wave: null,
      cancelledToPull,
      unpickedParcels,
    });
  }

  const summary = latestWave.summaryJson as unknown as WaveSummary;

  const [waveItems, statusCounts] = await Promise.all([
    prisma.waveItem.findMany({
      where: { waveId: latestWave.id },
      include: { package: { include: OUTBOUND_PACKAGE_INCLUDE } },
      orderBy: { position: "asc" },
    }),
    prisma.waveItem.groupBy({
      by: ["status"],
      where: { waveId: latestWave.id },
      _count: { _all: true },
    }),
  ]);

  const printedCount =
    statusCounts.find((c) => c.status === WaveItemStatus.PRINTED)?._count._all ?? 0;
  const cancelledInWaveCount =
    statusCounts.find((c) => c.status === WaveItemStatus.SKIPPED_CANCELLED)?._count._all ?? 0;
  const notPrintedCount = Math.max(0, latestWave.parcelCount - printedCount - cancelledInWaveCount);

  const shopIds = [...new Set(waveItems.map((w) => w.package.order.shopConnectionId))];
  const listingIds = [
    ...new Set(waveItems.flatMap((w) => w.package.order.lines.map((l) => l.listingId))),
  ];
  const listings =
    shopIds.length > 0 && listingIds.length > 0
      ? await prisma.listingVariant.findMany({
          where: { shopConnectionId: { in: shopIds }, listingId: { in: listingIds } },
          select: {
            shopConnectionId: true,
            listingId: true,
            variationId: true,
            imageUrl: true,
            garmentVariant: {
              select: {
                id: true,
                label: true,
                garment: { select: { name: true, imageUrl: true } },
              },
            },
          },
        })
      : [];

  const listingByKey = new Map(
    listings.map((l) => [`${l.shopConnectionId}:${l.listingId}:${l.variationId}`, l])
  );

  const metaByLabel = new Map<
    string,
    { imageUrl: string | null; garmentVariantId: string | null }
  >();
  const imageByShortName = new Map<string, string>();

  for (const w of waveItems) {
    const shopId = w.package.order.shopConnectionId;
    for (const l of w.package.order.lines) {
      const lv = listingByKey.get(`${shopId}:${l.listingId}:${l.variationId}`);
      const gv = lv?.garmentVariant;
      const label = gv
        ? `${gv.garment.name} - ${gv.label}`
        : `${l.name}${l.variationName ? ` - ${l.variationName}` : ""}`;
      const img = gv?.garment?.imageUrl ?? lv?.imageUrl ?? l.imageUrl ?? null;
      const existing = metaByLabel.get(label);
      if (!existing || (!existing.imageUrl && img) || (!existing.garmentVariantId && gv?.id)) {
        metaByLabel.set(label, {
          imageUrl: existing?.imageUrl ?? img,
          garmentVariantId: existing?.garmentVariantId ?? gv?.id ?? null,
        });
      }
      if (img) {
        const parsed = parsePickItemLabel(label);
        const key = (parsed.shortGarmentName || parsed.garmentName).toLowerCase();
        if (!imageByShortName.has(key)) {
          imageByShortName.set(key, img);
        }
      }
    }
  }

  const groups: StaffPickGroup[] = (summary.groups ?? []).map((g) => {
    const grouped = groupPickItems(g.items);
    const garments: StaffPickGarmentGroup[] = grouped.map((pg) => {
      const variantImages = pg.variants
        .map((v) => metaByLabel.get(v.label)?.imageUrl)
        .find(Boolean);
      const imageUrl = variantImages ?? imageByShortName.get(pg.key) ?? null;

      return {
        key: pg.key,
        shortName: pg.shortName,
        fullName: pg.fullName,
        imageUrl,
        totalQty: pg.totalQty,
        variants: pg.variants.map((v) => ({
          label: v.label,
          color: v.color,
          size: v.size,
          qty: v.qty,
          garmentVariantId: metaByLabel.get(v.label)?.garmentVariantId ?? null,
        })),
      };
    });

    return {
      key: g.key,
      title: g.title,
      count: g.count,
      garments,
    };
  });

  // Optional visual checklist ONLY for 2+ piece orders (where packing errors happen most).
  const multiWavePkgs = waveItems
    .filter((w) => {
      const pieces = w.package.order.lines.reduce((sum, l) => sum + l.quantity, 0);
      return pieces > 1 || w.package.order.lines.length > 1;
    })
    .map((w) => w.package);
  const enrichedMulti = await enrichPackageLineImages(multiWavePkgs);
  const multiParcels = enrichedMulti.map(redactOutboundPackageForStaff);

  return NextResponse.json({
    wave: {
      id: latestWave.id,
      status: latestWave.status,
      createdAt: latestWave.createdAt.toISOString(),
      parcelCount: latestWave.parcelCount,
      printedCount,
      notPrintedCount,
      singles: summary.singles ?? 0,
      multis: summary.multis ?? 0,
      courierTotals: (summary.groups ?? []).map((g) => ({ title: g.title, count: g.count })),
      groups,
      multiParcels,
    },
    cancelledToPull,
    unpickedParcels,
  });
}
