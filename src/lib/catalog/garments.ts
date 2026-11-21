import { Platform, type ListingVariant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  COMMITTED_ORDER_STATUSES,
  computeStartingStock,
  findCrossShopTitleMatches,
  pairVariations,
  type StartingStockView,
} from "./variants";
import { onShelfByVariant, setShelfCount } from "@/lib/stock/ledger";
import { availableToSell } from "@/lib/stock/rules";

type ListingRef = Pick<ListingVariant, "id" | "shopConnectionId" | "listingId" | "name" | "variationName" | "imageUrl" | "garmentVariantId">;

/**
 * Every listing variation belongs to exactly one garment variant. New ones get
 * their own, under the same garment as other variations of the same listing.
 */
export async function ensureGarmentFor(lv: ListingRef): Promise<string> {
  if (lv.garmentVariantId) return lv.garmentVariantId;
  const sibling = await prisma.listingVariant.findFirst({
    where: { shopConnectionId: lv.shopConnectionId, listingId: lv.listingId, garmentVariantId: { not: null } },
    select: { garmentVariant: { select: { garmentId: true } } },
  });
  const garmentId =
    sibling?.garmentVariant?.garmentId ??
    (await prisma.garment.create({ data: { name: lv.name, imageUrl: lv.imageUrl }, select: { id: true } })).id;
  const variant = await prisma.garmentVariant.create({
    data: { garmentId, label: lv.variationName ?? "One size" },
    select: { id: true },
  });
  await prisma.listingVariant.update({ where: { id: lv.id }, data: { garmentVariantId: variant.id } });
  return variant.id;
}

async function deleteEmptyGarments(ids: string[]) {
  if (!ids.length) return;
  await prisma.garmentVariant.deleteMany({ where: { garmentId: { in: ids }, listings: { none: {} } } });
  await prisma.garment.deleteMany({ where: { id: { in: ids }, variants: { none: {} } } });
}

export interface ListingKey {
  shopConnectionId: string;
  listingId: string;
}

async function listingVariants(key: ListingKey) {
  const rows = await prisma.listingVariant.findMany({ where: key });
  for (const r of rows) r.garmentVariantId = await ensureGarmentFor(r);
  return rows;
}

async function computeMergedShelfCount(intoId: string, fromId: string): Promise<number | null> {
  const [variants, onShelf] = await Promise.all([
    prisma.garmentVariant.findMany({
      where: { id: { in: [intoId, fromId] } },
      select: { id: true, startingStockSetAt: true },
    }),
    onShelfByVariant([intoId, fromId]),
  ]);
  const started = variants.filter((v) => v.startingStockSetAt !== null).map((v) => onShelf.get(v.id) ?? 0);
  if (!started.length) return null;
  // Take the safer (lower) shelf count if both shops were already tracking stock.
  return Math.min(...started);
}

/**
 * "This Shopee listing is that TikTok listing." Variations with the same
 * colour/size are merged into one garment variant; the rest are moved under
 * the same garment for the owner to pair by hand. Existing shelf counts are
 * preserved using the safer (lower) count.
 */
export async function linkListings(a: ListingKey, b: ListingKey) {
  if (a.shopConnectionId === b.shopConnectionId && a.listingId === b.listingId) {
    throw new Error("Pick two different listings.");
  }
  const la = await listingVariants(a);
  const lb = await listingVariants(b);
  if (!la.length || !lb.length) throw new Error("Listing not found.");

  const target = await prisma.garmentVariant.findUniqueOrThrow({
    where: { id: la[0].garmentVariantId! },
    select: { garmentId: true },
  });
  const sourceGarments = await prisma.garmentVariant.findMany({
    where: { id: { in: lb.map((l) => l.garmentVariantId!) } },
    select: { garmentId: true },
  });

  const { pairs, leftoverB } = pairVariations(
    la.map((l) => ({ id: l.garmentVariantId!, label: l.variationName })),
    lb.map((l) => ({ id: l.garmentVariantId!, label: l.variationName }))
  );

  const mergedCounts = new Map<string, number>();
  for (const [into, from] of pairs) {
    if (into === from) continue;
    const count = await computeMergedShelfCount(into, from);
    if (count !== null) mergedCounts.set(into, count);
  }

  await prisma.$transaction(async (tx) => {
    for (const [into, from] of pairs) {
      if (into === from) continue;
      await tx.listingVariant.updateMany({ where: { garmentVariantId: from }, data: { garmentVariantId: into } });
      await tx.garmentVariant.delete({ where: { id: from } }); // its movements cascade
    }
    await tx.garmentVariant.updateMany({
      where: { id: { in: leftoverB.map((v) => v.id) } },
      data: { garmentId: target.garmentId },
    });
  });

  for (const [into, count] of mergedCounts) {
    await setShelfCount(into, count);
  }

  await deleteEmptyGarments(sourceGarments.map((g) => g.garmentId).filter((id) => id !== target.garmentId));
  return { paired: pairs.length, unpaired: leftoverB.length };
}

/** Owner pairs two variations by hand ("Black, M" on TikTok = "Black,Medium" on Shopee). */
export async function mergeVariants(intoId: string, fromId: string) {
  if (intoId === fromId) return;
  const from = await prisma.garmentVariant.findUniqueOrThrow({ where: { id: fromId }, select: { garmentId: true } });
  const count = await computeMergedShelfCount(intoId, fromId);
  await prisma.$transaction([
    prisma.listingVariant.updateMany({ where: { garmentVariantId: fromId }, data: { garmentVariantId: intoId } }),
    prisma.garmentVariant.delete({ where: { id: fromId } }),
  ]);
  if (count !== null) {
    await setShelfCount(intoId, count);
  }
  await deleteEmptyGarments([from.garmentId]);
}

/** Auto-initializes starting stock using the safer (lower) shop count for every uncounted variant. */
export async function autoConfirmStartingStock(): Promise<number> {
  const garments = await getCatalog();
  let confirmed = 0;
  for (const g of garments) {
    for (const v of g.variants) {
      if (v.startingStock === null && v.stock.suggested !== null) {
        await setStartingStock(v.id, v.stock.suggested);
        confirmed++;
      }
    }
  }
  return confirmed;
}

/**
 * Automatically links 1-to-1 Shopee ↔ TikTok twin listings by normalized title
 * and initializes starting stock for all variants with shop stock data.
 */
export async function autoLinkAndInitCatalog(): Promise<{
  linkedGarments: number;
  pairedVariants: number;
  confirmedStock: number;
}> {
  const garments = await getCatalog();
  const matches = findCrossShopTitleMatches(
    garments.map((g) => ({
      id: g.id,
      name: g.name,
      platforms: g.platforms,
      listingKey:
        g.listings.length === 1
          ? { shopConnectionId: g.listings[0].shopConnectionId, listingId: g.listings[0].listingId }
          : null,
    }))
  );

  let linkedGarments = 0;
  let pairedVariants = 0;
  for (const m of matches) {
    try {
      const res = await linkListings(m.shopee, m.tiktok);
      linkedGarments++;
      pairedVariants += res.paired;
    } catch (err) {
      console.error("[autoLink]", m.normalizedTitle, err);
    }
  }

  const confirmedStock = await autoConfirmStartingStock();
  return { linkedGarments, pairedVariants, confirmedStock };
}

/** Undo links: every listing goes back to its own garment. */
export async function unlinkGarment(garmentId: string) {
  const listings = await prisma.listingVariant.findMany({
    where: { garmentVariant: { garmentId } },
    orderBy: [{ shopConnectionId: "asc" }, { listingId: "asc" }],
  });
  await prisma.garment.delete({ where: { id: garmentId } }); // variants cascade; listings set to null
  for (const l of listings) await ensureGarmentFor({ ...l, garmentVariantId: null });
}

/** First count starts the stock ledger; later counts are recounts. */
export async function setStartingStock(variantId: string, count: number) {
  await setShelfCount(variantId, count);
}

// ---------------------------------------------------------------- the owner's catalog view

/** Units on unshipped orders per listing variation, keyed "platform:listingId:variationId". */
export async function committedUnitsByListing(): Promise<Map<string, number>> {
  const platforms = [Platform.SHOPEE, Platform.TIKTOK] as const;
  const results = await Promise.all(
    platforms.map((platform) =>
      prisma.orderLine.groupBy({
        by: ["listingId", "variationId"],
        where: { order: { platform, status: { in: COMMITTED_ORDER_STATUSES[platform] } } },
        _sum: { quantity: true },
      })
    )
  );
  const map = new Map<string, number>();
  platforms.forEach((platform, idx) => {
    for (const r of results[idx]) {
      map.set(`${platform}:${r.listingId}:${r.variationId}`, r._sum.quantity ?? 0);
    }
  });
  return map;
}

/** Lightweight stock health counts for the dashboard, without hydrating full CatalogGarment trees. */
export async function getStockOperationsSummary(
  buffer: number,
  connectedPlatforms: number
): Promise<{
  lowStockCount: number;
  outOfStockCount: number;
  unlinkedCount: number;
  stockPushFailedCount: number;
}> {
  const [variants, committed, onShelf] = await Promise.all([
    prisma.garmentVariant.findMany({
      select: {
        id: true,
        garmentId: true,
        startingStockSetAt: true,
        listings: {
          select: {
            platform: true,
            listingId: true,
            variationId: true,
            pushError: true,
          },
        },
      },
    }),
    committedUnitsByListing(),
    onShelfByVariant(),
  ]);

  let lowStockCount = 0;
  let outOfStockCount = 0;
  let stockPushFailedCount = 0;
  const platformsByGarment = new Map<string, Set<Platform>>();

  for (const v of variants) {
    let garmentPlatforms = platformsByGarment.get(v.garmentId);
    if (!garmentPlatforms) {
      garmentPlatforms = new Set<Platform>();
      platformsByGarment.set(v.garmentId, garmentPlatforms);
    }

    let units = 0;
    let hasPushError = false;
    for (const l of v.listings) {
      garmentPlatforms.add(l.platform);
      units += committed.get(`${l.platform}:${l.listingId}:${l.variationId}`) ?? 0;
      if (l.pushError) hasPushError = true;
    }

    if (hasPushError) stockPushFailedCount++;

    if (v.startingStockSetAt) {
      const avail = availableToSell(onShelf.get(v.id) ?? 0, units, buffer);
      if (avail === 0) outOfStockCount++;
      else if (avail > 0 && avail <= 5) lowStockCount++;
    }
  }

  let unlinkedCount = 0;
  if (connectedPlatforms >= 2) {
    for (const platforms of platformsByGarment.values()) {
      if (platforms.size === 1) unlinkedCount++;
    }
  }

  return { lowStockCount, outOfStockCount, unlinkedCount, stockPushFailedCount };
}

export interface CatalogVariant {
  id: string;
  label: string;
  startingStock: number | null;
  committed: number;
  stock: StartingStockView;
  /** Live, once a starting count exists: pieces on the shelf and what the shops are told. */
  onShelf: number | null;
  available: number | null;
  listings: Array<{
    id: string;
    platform: Platform;
    listingId: string;
    variationId: string;
    variationName: string | null;
    availableStock: number | null;
    pushedStock: number | null;
    pushError: string | null;
  }>;
}

export interface CatalogGarment {
  id: string;
  name: string;
  imageUrl: string | null;
  platforms: Platform[];
  listings: Array<{ shopConnectionId: string; listingId: string; platform: Platform; name: string; variations: number }>;
  variants: CatalogVariant[];
}

export async function getCatalog(): Promise<CatalogGarment[]> {
  const [garments, committed, onShelf, settings] = await Promise.all([
    prisma.garment.findMany({
      orderBy: { name: "asc" },
      include: {
        variants: {
          orderBy: { label: "asc" },
          include: { listings: { include: { shopConnection: { select: { platform: true } } } } },
        },
      },
    }),
    committedUnitsByListing(),
    onShelfByVariant(),
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { stockSafetyBuffer: true } }),
  ]);
  const buffer = settings?.stockSafetyBuffer ?? 0;

  return garments.map((g) => {
    const listingMap = new Map<string, CatalogGarment["listings"][number]>();
    const variants: CatalogVariant[] = g.variants.map((v) => {
      const ls = v.listings.map((l) => ({
        id: l.id,
        platform: l.shopConnection.platform,
        listingId: l.listingId,
        variationId: l.variationId,
        variationName: l.variationName,
        availableStock: l.availableStock,
        pushedStock: l.pushedStock,
        pushError: l.pushError,
      }));
      for (const l of v.listings) {
        const key = `${l.shopConnectionId}:${l.listingId}`;
        const entry = listingMap.get(key) ?? {
          shopConnectionId: l.shopConnectionId,
          listingId: l.listingId,
          platform: l.shopConnection.platform,
          name: l.name,
          variations: 0,
        };
        entry.variations++;
        listingMap.set(key, entry);
      }
      const units = ls.reduce((n, l) => n + (committed.get(`${l.platform}:${l.listingId}:${l.variationId}`) ?? 0), 0);
      return {
        id: v.id,
        label: v.label,
        startingStock: v.startingStock,
        committed: units,
        stock: computeStartingStock(ls, units),
        onShelf: v.startingStockSetAt ? onShelf.get(v.id) ?? 0 : null,
        available: v.startingStockSetAt ? availableToSell(onShelf.get(v.id) ?? 0, units, buffer) : null,
        listings: ls,
      };
    });
    const listings = [...listingMap.values()];
    return {
      id: g.id,
      name: g.name,
      imageUrl: g.imageUrl,
      platforms: [...new Set(listings.map((l) => l.platform))],
      listings,
      variants,
    };
  });
}
