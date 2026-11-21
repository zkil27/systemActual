import { Platform, type ListingVariant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { COMMITTED_ORDER_STATUSES, computeStartingStock, pairVariations, type StartingStockView } from "./variants";
import { onShelfByVariant, resetStock, setShelfCount } from "@/lib/stock/ledger";
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

/**
 * "This Shopee listing is that TikTok listing." Variations with the same
 * colour/size are merged into one garment variant; the rest are moved under
 * the same garment for the owner to pair by hand. Merged variants need their
 * starting stock confirmed again.
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

  // Two shops' counts of the same pieces must not be added together: start over.
  await resetStock(pairs.filter(([into, from]) => into !== from).map(([into]) => into));
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

  await deleteEmptyGarments(sourceGarments.map((g) => g.garmentId).filter((id) => id !== target.garmentId));
  return { paired: pairs.length, unpaired: leftoverB.length };
}

/** Owner pairs two variations by hand ("Black, M" on TikTok = "Black,Medium" on Shopee). */
export async function mergeVariants(intoId: string, fromId: string) {
  if (intoId === fromId) return;
  const from = await prisma.garmentVariant.findUniqueOrThrow({ where: { id: fromId }, select: { garmentId: true } });
  await resetStock([intoId]);
  await prisma.$transaction([
    prisma.listingVariant.updateMany({ where: { garmentVariantId: fromId }, data: { garmentVariantId: intoId } }),
    prisma.garmentVariant.delete({ where: { id: fromId } }),
  ]);
  await deleteEmptyGarments([from.garmentId]);
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
  const map = new Map<string, number>();
  for (const platform of [Platform.SHOPEE, Platform.TIKTOK]) {
    const rows = await prisma.orderLine.groupBy({
      by: ["listingId", "variationId"],
      where: { order: { platform, status: { in: COMMITTED_ORDER_STATUSES[platform] } } },
      _sum: { quantity: true },
    });
    for (const r of rows) map.set(`${platform}:${r.listingId}:${r.variationId}`, r._sum.quantity ?? 0);
  }
  return map;
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
