import { NextResponse } from "next/server";
import { WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactOutboundPackageForStaff } from "@/lib/auth";
import {
  enrichPackageLineImages,
  OUTBOUND_PACKAGE_INCLUDE,
  unpackedWaveItemWhere,
} from "@/lib/shipping/outbound";
import { getManilaDayBounds, getManilaTodayStr } from "@/lib/time";
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

  const { start, end } = getManilaDayBounds(getManilaTodayStr());

  const [latestWave, unpackedItems] = await Promise.all([
    prisma.wave.findFirst({
      where: { status: { in: [WaveStatus.RUNNING, WaveStatus.DONE, WaveStatus.PREVIEW] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.waveItem.findMany({
      where: unpackedWaveItemWhere(start, end),
      include: {
        package: { include: OUTBOUND_PACKAGE_INCLUDE },
      },
      orderBy: [{ wave: { createdAt: "asc" } }, { position: "asc" }],
      take: 250,
    }),
  ]);

  const enrichedUnpackedPkgs = await enrichPackageLineImages(
    unpackedItems.map((u) => u.package)
  );
  const unpackedParcels = enrichedUnpackedPkgs.map(redactOutboundPackageForStaff);

  if (!latestWave) {
    return NextResponse.json({
      wave: null,
      unpackedParcels,
    });
  }

  const summary = latestWave.summaryJson as unknown as WaveSummary;

  // Build photo + GarmentVariant lookup from the wave's order lines so pick cards
  // show garment photos and can deep-link to "Shelf empty?" for that exact item.
  const waveLines = await prisma.waveItem.findMany({
    where: { waveId: latestWave.id },
    select: {
      package: {
        select: {
          order: {
            select: {
              shopConnectionId: true,
              lines: {
                select: {
                  listingId: true,
                  variationId: true,
                  name: true,
                  variationName: true,
                  imageUrl: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const shopIds = [...new Set(waveLines.map((w) => w.package.order.shopConnectionId))];
  const listingIds = [
    ...new Set(waveLines.flatMap((w) => w.package.order.lines.map((l) => l.listingId))),
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

  for (const w of waveLines) {
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

  return NextResponse.json({
    wave: {
      id: latestWave.id,
      status: latestWave.status,
      createdAt: latestWave.createdAt.toISOString(),
      parcelCount: latestWave.parcelCount,
      singles: summary.singles ?? 0,
      multis: summary.multis ?? 0,
      groups,
    },
    unpackedParcels,
  });
}
