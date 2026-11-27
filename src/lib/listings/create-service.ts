import {
  ItemPublishMode,
  ItemPublishStatus,
  Platform,
  Prisma,
  StockReason,
} from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { getChannelConnector } from "@/lib/channels/registry";
import type {
  ChannelCategoryOption,
  CreateListingInput,
  ListingVariantInput,
} from "@/lib/channels/types";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { prisma } from "@/lib/prisma";
import {
  computeShopPublishStock,
  DEFAULT_WEIGHT_KG,
  deriveCategoryPresets,
  validateCreateItemInput,
  type CategoryChip,
  type CategoryPreset,
  type PublishMode,
  type ShopPlatform,
  type TierSpec,
  type VariantMatrixRow,
} from "./create-rules";

const CATEGORY_CACHE_TTL_MS = 30 * 60_000;
const categoryCache = new Map<
  string,
  { fetchedAt: number; categories: ChannelCategoryOption[] }
>();

export interface PublishSnapshotPayload {
  title: string;
  description: string;
  imageUrls: string[];
  weightKg: number;
  dimensionsCm: { length: number; width: number; height: number } | null;
  tiers: TierSpec[];
  variants: Array<{
    garmentVariantId: string;
    label: string;
    tierValues: string[];
    skuCode: string | null;
    pricePhp: number;
  }>;
}

export interface ItemPublishResultDto {
  itemPublishId: string;
  shopConnectionId: string;
  shopName: string;
  platform: ShopPlatform;
  publishMode: PublishMode;
  status: "PENDING" | "PUSHED" | "FAILED" | "SKIPPED";
  categoryId: string | null;
  categoryName: string | null;
  externalListingId: string | null;
  error: string | null;
  pushedAt: string | null;
}

export interface CreateItemBootstrapDto {
  shops: Array<{
    id: string;
    platform: ShopPlatform;
    shopName: string;
    writesEnabled: boolean;
    connected: boolean;
  }>;
  presets: CategoryPreset[];
  recentByPlatform: {
    SHOPEE: CategoryChip[];
    TIKTOK: CategoryChip[];
  };
  defaults: {
    sellingPricePhp: number;
    unitCostPhp: number;
    safetyBuffer: number;
  };
}

export async function getCreateItemBootstrap(): Promise<CreateItemBootstrapDto> {
  const [shops, settings, garments] = await Promise.all([
    prisma.shopConnection.findMany({
      where: { isDemo: false },
      orderBy: [{ platform: "asc" }, { shopName: "asc" }],
      select: {
        id: true,
        platform: true,
        shopName: true,
        writesEnabled: true,
        accessToken: true,
      },
    }),
    prisma.appSettings.findUnique({
      where: { id: "default" },
      select: {
        defaultSellingPrice: true,
        defaultUnitCostPhp: true,
        stockSafetyBuffer: true,
      },
    }),
    prisma.garment.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        variants: {
          select: {
            listings: {
              where: { shopConnection: { isDemo: false } },
              select: {
                platform: true,
                channelProduct: {
                  select: { categoryId: true, categoryName: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const { presets, recentByPlatform } = deriveCategoryPresets(
    garments.map((g) => ({
      products: g.variants.flatMap((v) =>
        v.listings
          .filter((l) => l.channelProduct)
          .map((l) => ({
            platform: l.platform,
            categoryId: l.channelProduct!.categoryId,
            categoryName: l.channelProduct!.categoryName,
          }))
      ),
    }))
  );

  return {
    shops: shops.map((s) => ({
      id: s.id,
      platform: s.platform,
      shopName: s.shopName,
      writesEnabled: s.writesEnabled,
      connected: Boolean(s.accessToken),
    })),
    presets,
    recentByPlatform,
    defaults: {
      sellingPricePhp: settings ? Number(settings.defaultSellingPrice) : 199,
      unitCostPhp: settings ? Number(settings.defaultUnitCostPhp) : 82,
      safetyBuffer: settings?.stockSafetyBuffer ?? 0,
    },
  };
}

export async function searchShopCategories(
  shopConnectionId: string,
  query: string
): Promise<ChannelCategoryOption[]> {
  const shop = await prisma.shopConnection.findUniqueOrThrow({
    where: { id: shopConnectionId },
  });
  if (shop.isDemo || !shop.accessToken) {
    throw new Error(`Connect ${shop.shopName} in Settings first.`);
  }

  const now = Date.now();
  let cached = categoryCache.get(shop.id);
  if (!cached || now - cached.fetchedAt > CATEGORY_CACHE_TTL_MS) {
    const token = await ensureFreshToken(shop);
    const connector = getChannelConnector(shop.platform);
    const categories = await connector.fetchCategories(shop, token);
    cached = { fetchedAt: now, categories };
    categoryCache.set(shop.id, cached);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? cached.categories.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.path.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
      )
    : cached.categories;

  return filtered.slice(0, 30);
}

function parseSnapshot(
  raw: Prisma.JsonValue | null,
  garment: {
    name: string;
    imageUrl: string | null;
    sellingPricePhp: Prisma.Decimal | null;
    variants: Array<{ id: string; label: string }>;
  }
): PublishSnapshotPayload {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.variants)) {
      return {
        title: typeof obj.title === "string" ? obj.title : garment.name,
        description: typeof obj.description === "string" ? obj.description : garment.name,
        imageUrls: Array.isArray(obj.imageUrls)
          ? obj.imageUrls.filter((x): x is string => typeof x === "string")
          : garment.imageUrl
            ? [garment.imageUrl]
            : [],
        weightKg:
          typeof obj.weightKg === "number" && Number.isFinite(obj.weightKg)
            ? obj.weightKg
            : DEFAULT_WEIGHT_KG,
        dimensionsCm:
          obj.dimensionsCm && typeof obj.dimensionsCm === "object"
            ? (obj.dimensionsCm as { length: number; width: number; height: number })
            : null,
        tiers: Array.isArray(obj.tiers) ? (obj.tiers as TierSpec[]) : [],
        variants: obj.variants as PublishSnapshotPayload["variants"],
      };
    }
  }
  const fallbackPrice = garment.sellingPricePhp ? Number(garment.sellingPricePhp) : 199;
  return {
    title: garment.name,
    description: garment.name,
    imageUrls: garment.imageUrl ? [garment.imageUrl] : [],
    weightKg: DEFAULT_WEIGHT_KG,
    dimensionsCm: null,
    tiers: [],
    variants: garment.variants.map((v) => ({
      garmentVariantId: v.id,
      label: v.label,
      tierValues: [],
      skuCode: null,
      pricePhp: fallbackPrice,
    })),
  };
}

export async function pushItemPublishForShop(
  itemPublishId: string,
  actor: AuditActor
): Promise<ItemPublishResultDto> {
  const [pub, settings] = await Promise.all([
    prisma.itemPublish.findUniqueOrThrow({
      where: { id: itemPublishId },
      include: {
        shopConnection: true,
        garment: {
          include: {
            variants: {
              orderBy: { createdAt: "asc" },
              select: { id: true, label: true, onShelfCount: true },
            },
          },
        },
      },
    }),
    prisma.appSettings.findUnique({
      where: { id: "default" },
      select: { stockSafetyBuffer: true },
    }),
  ]);

  const shop = pub.shopConnection;
  const globalBuffer = settings?.stockSafetyBuffer ?? 0;

  if (shop.isDemo || !shop.writesEnabled || !shop.accessToken) {
    const reason = !shop.accessToken
      ? `Reconnect ${shop.shopName} in Settings.`
      : `Turn on shop writes for ${shop.shopName} in Settings to push.`;
    const updated = await prisma.itemPublish.update({
      where: { id: pub.id },
      data: { status: ItemPublishStatus.SKIPPED, error: reason },
    });
    await recordAudit({
      actor,
      action: "item.publish_skipped",
      entity: "ItemPublish",
      entityId: pub.id,
      after: { shopName: shop.shopName, reason },
    });
    return {
      itemPublishId: updated.id,
      shopConnectionId: shop.id,
      shopName: shop.shopName,
      platform: shop.platform,
      publishMode: updated.publishMode,
      status: updated.status,
      categoryId: updated.categoryId,
      categoryName: updated.categoryName,
      externalListingId: updated.externalListingId,
      error: updated.error,
      pushedAt: updated.pushedAt?.toISOString() ?? null,
    };
  }

  if (!pub.categoryId?.trim()) {
    const reason = `Pick a ${shop.platform === Platform.SHOPEE ? "Shopee" : "TikTok"} category first.`;
    const updated = await prisma.itemPublish.update({
      where: { id: pub.id },
      data: { status: ItemPublishStatus.FAILED, error: reason },
    });
    return {
      itemPublishId: updated.id,
      shopConnectionId: shop.id,
      shopName: shop.shopName,
      platform: shop.platform,
      publishMode: updated.publishMode,
      status: updated.status,
      categoryId: updated.categoryId,
      categoryName: updated.categoryName,
      externalListingId: updated.externalListingId,
      error: updated.error,
      pushedAt: updated.pushedAt?.toISOString() ?? null,
    };
  }

  try {
    const snapshot = parseSnapshot(pub.payloadJson, pub.garment);
    const onShelfById = new Map(pub.garment.variants.map((v) => [v.id, v.onShelfCount]));
    const variants: ListingVariantInput[] = snapshot.variants.map((v) => ({
      garmentVariantId: v.garmentVariantId,
      label: v.label,
      tierValues: v.tierValues,
      skuCode: v.skuCode,
      pricePhp: v.pricePhp,
      stock: computeShopPublishStock(
        onShelfById.get(v.garmentVariantId) ?? 0,
        pub.garment.safetyBuffer,
        globalBuffer
      ),
    }));

    const basePrice = variants[0]?.pricePhp ?? 199;
    const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
    const createInput: CreateListingInput = {
      title: snapshot.title,
      description: snapshot.description,
      categoryId: pub.categoryId.trim(),
      publishMode: pub.publishMode,
      weightKg: snapshot.weightKg,
      dimensionsCm: snapshot.dimensionsCm,
      pricePhp: basePrice,
      stock: totalStock,
      imageUrls: snapshot.imageUrls,
      tiers: snapshot.tiers,
      variants,
      existingExternalListingId: pub.externalListingId,
    };

    const token = await ensureFreshToken(shop);
    const connector = getChannelConnector(shop.platform);
    const res = await connector.createListing(shop, token, createInput);

    if (res.partialError) {
      const failed = await prisma.itemPublish.update({
        where: { id: pub.id },
        data: {
          externalListingId: res.externalListingId || pub.externalListingId,
          status: ItemPublishStatus.FAILED,
          error: res.partialError.slice(0, 300),
        },
      });
      await recordAudit({
        actor,
        action: "item.publish_failed",
        entity: "ItemPublish",
        entityId: pub.id,
        after: {
          shopName: shop.shopName,
          externalListingId: failed.externalListingId,
          error: failed.error,
        },
      });
      return {
        itemPublishId: failed.id,
        shopConnectionId: shop.id,
        shopName: shop.shopName,
        platform: shop.platform,
        publishMode: failed.publishMode,
        status: failed.status,
        categoryId: failed.categoryId,
        categoryName: failed.categoryName,
        externalListingId: failed.externalListingId,
        error: failed.error,
        pushedAt: null,
      };
    }

    const now = new Date();
    const prices = res.skus.map((s) => s.pricePhp).filter((n) => Number.isFinite(n) && n > 0);
    const minPrice = prices.length ? Math.min(...prices) : basePrice;
    const maxPrice = prices.length ? Math.max(...prices) : basePrice;
    const cpImages = res.remoteImageUrls.length ? res.remoteImageUrls : snapshot.imageUrls;

    await prisma.$transaction(async (tx) => {
      const cp = await tx.channelProduct.upsert({
        where: {
          shopConnectionId_listingId: {
            shopConnectionId: shop.id,
            listingId: res.externalListingId,
          },
        },
        create: {
          shopConnectionId: shop.id,
          platform: shop.platform,
          listingId: res.externalListingId,
          title: snapshot.title,
          description: snapshot.description || null,
          categoryId: pub.categoryId,
          categoryName: pub.categoryName,
          status: res.status,
          imageUrls: cpImages as Prisma.InputJsonValue,
          minPricePhp: new Prisma.Decimal(minPrice.toFixed(2)),
          maxPricePhp: new Prisma.Decimal(maxPrice.toFixed(2)),
          syncedAt: now,
        },
        update: {
          title: snapshot.title,
          description: snapshot.description || null,
          categoryId: pub.categoryId,
          categoryName: pub.categoryName,
          status: res.status,
          imageUrls: cpImages as Prisma.InputJsonValue,
          minPricePhp: new Prisma.Decimal(minPrice.toFixed(2)),
          maxPricePhp: new Prisma.Decimal(maxPrice.toFixed(2)),
          syncedAt: now,
        },
        select: { id: true },
      });

      for (const sku of res.skus) {
        if (!sku.variationId) continue;
        const priceDec = new Prisma.Decimal(sku.pricePhp.toFixed(2));
        await tx.listingVariant.upsert({
          where: {
            shopConnectionId_listingId_variationId: {
              shopConnectionId: shop.id,
              listingId: res.externalListingId,
              variationId: sku.variationId,
            },
          },
          create: {
            shopConnectionId: shop.id,
            platform: shop.platform,
            listingId: res.externalListingId,
            variationId: sku.variationId,
            name: pub.garment.name,
            variationName: sku.variationName,
            imageUrl: cpImages[0] ?? pub.garment.imageUrl,
            lastSeenAt: now,
            garmentVariantId: sku.garmentVariantId,
            availableStock: sku.stock,
            stockCheckedAt: now,
            warehouseId: sku.warehouseId ?? null,
            pushedStock: sku.stock,
            pushedAt: now,
            channelProductId: cp.id,
            pricePhp: priceDec,
            pricePushedPhp: priceDec,
            pricePushedAt: now,
          },
          update: {
            name: pub.garment.name,
            variationName: sku.variationName,
            imageUrl: cpImages[0] ?? pub.garment.imageUrl,
            lastSeenAt: now,
            garmentVariantId: sku.garmentVariantId,
            availableStock: sku.stock,
            stockCheckedAt: now,
            warehouseId: sku.warehouseId ?? undefined,
            pushedStock: sku.stock,
            pushedAt: now,
            pushError: null,
            pushFailures: 0,
            channelProductId: cp.id,
            pricePhp: priceDec,
            pricePushedPhp: priceDec,
            pricePushedAt: now,
            pricePushError: null,
          },
        });
      }

      await tx.itemPublish.update({
        where: { id: pub.id },
        data: {
          status: ItemPublishStatus.PUSHED,
          externalListingId: res.externalListingId,
          pushedAt: now,
          error: null,
          payloadJson: Prisma.JsonNull,
        },
      });

      await recordAudit(
        {
          actor,
          action: "item.published",
          entity: "ItemPublish",
          entityId: pub.id,
          after: {
            garmentId: pub.garmentId,
            shopName: shop.shopName,
            platform: shop.platform,
            publishMode: pub.publishMode,
            externalListingId: res.externalListingId,
            skuCount: res.skus.length,
          },
        },
        tx
      );
    });

    return {
      itemPublishId: pub.id,
      shopConnectionId: shop.id,
      shopName: shop.shopName,
      platform: shop.platform,
      publishMode: pub.publishMode,
      status: ItemPublishStatus.PUSHED,
      categoryId: pub.categoryId,
      categoryName: pub.categoryName,
      externalListingId: res.externalListingId,
      error: null,
      pushedAt: now.toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't push item to shop.";
    const failed = await prisma.itemPublish.update({
      where: { id: pub.id },
      data: {
        status: ItemPublishStatus.FAILED,
        error: msg.slice(0, 300),
      },
    });
    await recordAudit({
      actor,
      action: "item.publish_failed",
      entity: "ItemPublish",
      entityId: pub.id,
      after: { shopName: shop.shopName, error: failed.error },
    });
    return {
      itemPublishId: failed.id,
      shopConnectionId: shop.id,
      shopName: shop.shopName,
      platform: shop.platform,
      publishMode: failed.publishMode,
      status: failed.status,
      categoryId: failed.categoryId,
      categoryName: failed.categoryName,
      externalListingId: failed.externalListingId,
      error: failed.error,
      pushedAt: null,
    };
  }
}

export async function createAndPublishItem(
  rawInput: {
    title: string;
    description?: string | null;
    publishMode?: PublishMode;
    imageUrls?: string[];
    weightKg?: number | null;
    dimensionsCm?: { length: number; width: number; height: number } | null;
    unitCostPhp?: number | null;
    safetyBuffer?: number | null;
    binLocation?: string | null;
    tiers?: TierSpec[];
    variants: VariantMatrixRow[];
    targets: Array<{
      shopConnectionId: string;
      platform: ShopPlatform;
      categoryId: string;
      categoryName?: string | null;
    }>;
  },
  actor: AuditActor
): Promise<{ garmentId: string; results: ItemPublishResultDto[] }> {
  const checked = validateCreateItemInput(rawInput);
  if (!checked.ok) throw new Error(checked.error);
  const v = checked.value;

  const targetShopIds = v.targets.map((t) => t.shopConnectionId);
  const shops = targetShopIds.length
    ? await prisma.shopConnection.findMany({
        where: { id: { in: targetShopIds }, isDemo: false },
        select: { id: true, platform: true },
      })
    : [];
  const shopById = new Map(shops.map((s) => [s.id, s]));
  for (const t of v.targets) {
    const s = shopById.get(t.shopConnectionId);
    if (!s) throw new Error("Selected shop was not found.");
    if (s.platform !== t.platform) throw new Error("Shop platform mismatch.");
  }

  const now = new Date();
  const basePrice = v.variants[0]?.pricePhp ?? 199;

  const { garmentId, publishIds } = await prisma.$transaction(async (tx) => {
    const garment = await tx.garment.create({
      data: {
        name: v.title,
        imageUrl: v.imageUrls[0] ?? null,
        sellingPricePhp: new Prisma.Decimal(basePrice.toFixed(2)),
        unitCostPhp:
          v.unitCostPhp !== null ? new Prisma.Decimal(v.unitCostPhp.toFixed(2)) : null,
        safetyBuffer: v.safetyBuffer,
        binLocation: v.binLocation,
      },
      select: { id: true },
    });

    const createdVariants: Array<{
      garmentVariantId: string;
      label: string;
      tierValues: string[];
      skuCode: string | null;
      pricePhp: number;
    }> = [];

    for (const row of v.variants) {
      const gv = await tx.garmentVariant.create({
        data: {
          garmentId: garment.id,
          label: row.label,
          startingStock: row.stock,
          startingStockSetAt: now,
        },
        select: { id: true },
      });
      await tx.stockMovement.create({
        data: {
          garmentVariantId: gv.id,
          delta: row.stock,
          reason: StockReason.INITIAL,
          sourceKey: `initial:${gv.id}:${now.getTime()}`,
          note: "Added in Kyna Ops",
        },
      });
      createdVariants.push({
        garmentVariantId: gv.id,
        label: row.label,
        tierValues: row.tierValues,
        skuCode: row.skuCode ?? null,
        pricePhp: row.pricePhp,
      });
    }

    const snapshot: PublishSnapshotPayload = {
      title: v.title,
      description: v.description || v.title,
      imageUrls: v.imageUrls,
      weightKg: v.weightKg,
      dimensionsCm: v.dimensionsCm,
      tiers: v.tiers,
      variants: createdVariants,
    };

    const publishIds: string[] = [];
    for (const t of v.targets) {
      const pub = await tx.itemPublish.create({
        data: {
          garmentId: garment.id,
          shopConnectionId: t.shopConnectionId,
          platform: t.platform,
          publishMode:
            v.publishMode === "LIVE" ? ItemPublishMode.LIVE : ItemPublishMode.DRAFT,
          status: ItemPublishStatus.PENDING,
          categoryId: t.categoryId,
          categoryName: t.categoryName ?? null,
          payloadJson: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      publishIds.push(pub.id);
    }

    await recordAudit(
      {
        actor,
        action: "item.created",
        entity: "Garment",
        entityId: garment.id,
        after: {
          name: v.title,
          variantCount: createdVariants.length,
          publishMode: v.publishMode,
          targetPlatforms: v.targets.map((t) => t.platform),
        },
      },
      tx
    );

    return { garmentId: garment.id, publishIds };
  });

  const results = await Promise.all(
    publishIds.map((id) => pushItemPublishForShop(id, actor))
  );

  return { garmentId, results };
}

export async function retryItemPublish(
  itemPublishId: string,
  overrides: {
    categoryId?: string;
    categoryName?: string | null;
    publishMode?: PublishMode;
  },
  actor: AuditActor
): Promise<ItemPublishResultDto> {
  const existing = await prisma.itemPublish.findUniqueOrThrow({
    where: { id: itemPublishId },
    select: { id: true, status: true, platform: true },
  });
  if (existing.status === ItemPublishStatus.PUSHED) {
    throw new Error("This item is already on that shop.");
  }

  const updateData: Prisma.ItemPublishUpdateInput = {};
  if (overrides.categoryId !== undefined) {
    const cleanCat = overrides.categoryId.trim();
    if (!cleanCat) throw new Error("Enter a category ID.");
    if (existing.platform === Platform.SHOPEE) {
      const n = Number(cleanCat);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("Shopee category ID must be a positive number.");
      }
    }
    updateData.categoryId = cleanCat;
  }
  if (overrides.categoryName !== undefined) {
    updateData.categoryName = overrides.categoryName?.trim() || null;
  }
  if (overrides.publishMode !== undefined) {
    updateData.publishMode =
      overrides.publishMode === "LIVE" ? ItemPublishMode.LIVE : ItemPublishMode.DRAFT;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.itemPublish.update({
      where: { id: itemPublishId },
      data: updateData,
    });
  }

  return pushItemPublishForShop(itemPublishId, actor);
}
