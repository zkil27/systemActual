import { ActionRequestStatus, Platform, PriceChangeStatus, Prisma, type ShopConnection } from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { ACTION_REQUEST_TTL_MS, buildApprovalInlineKeyboard } from "@/lib/approvals/rules";
import { getChannelConnector } from "@/lib/channels/registry";
import type { PricePushCandidate } from "@/lib/channels/types";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { prisma } from "@/lib/prisma";
import { notifyOwnerTelegram } from "@/lib/telegram";
import {
  buildListingCopyPreview,
  derivePriceChangeStatus,
  formatCopyListingApprovalCard,
  formatPriceChangeApprovalCard,
  validateProposedPrice,
  type PriceChangeStatusValue,
  type PricePushShopResult,
} from "./rules";

export interface ShopListingPriceView {
  listingVariantId: string;
  shopConnectionId: string;
  shopName: string;
  platform: "SHOPEE" | "TIKTOK";
  listingId: string;
  variationId: string;
  variationName: string | null;
  pricePhp: number | null;
  pricePushedPhp: number | null;
  pricePushedAt: string | null;
  pricePushError: string | null;
  channelProduct: {
    id: string;
    title: string;
    description: string | null;
    categoryId: string | null;
    categoryName: string | null;
    status: string | null;
    imageUrls: string[];
    minPricePhp: number | null;
    maxPricePhp: number | null;
  } | null;
}

export interface UnifiedListingItemDto {
  garmentId: string;
  garmentName: string;
  imageUrl: string | null;
  sellingPricePhp: number | null;
  hasPriceMismatch: boolean;
  totalOnShelf: number;
  variants: Array<{
    id: string;
    label: string;
    onShelfCount: number;
    listings: ShopListingPriceView[];
  }>;
  sourceProducts: Array<{
    id: string;
    shopConnectionId: string;
    shopName: string;
    platform: "SHOPEE" | "TIKTOK";
    listingId: string;
    title: string;
    description: string | null;
    categoryId: string | null;
    categoryName: string | null;
    status: string | null;
    imageUrls: string[];
    variants: Array<{ label: string; pricePhp: number | null; stock: number }>;
  }>;
  publishes: Array<{
    id: string;
    shopConnectionId: string;
    shopName: string;
    platform: "SHOPEE" | "TIKTOK";
    publishMode: "DRAFT" | "LIVE";
    status: "PENDING" | "PUSHED" | "FAILED" | "SKIPPED";
    categoryId: string | null;
    categoryName: string | null;
    externalListingId: string | null;
    error: string | null;
    pushedAt: string | null;
    updatedAt: string;
  }>;
}

export interface PriceChangeHistoryDto {
  id: string;
  garmentId: string;
  garmentName: string;
  variantLabel: string | null;
  actionRequestId: string | null;
  oldPricePhp: number | null;
  newPricePhp: number;
  status: PriceChangeStatusValue;
  results: PricePushShopResult[];
  createdBy: string;
  decidedBy: string | null;
  pushedAt: string | null;
  createdAt: string;
}

export interface ShopSummaryDto {
  id: string;
  platform: "SHOPEE" | "TIKTOK";
  shopName: string;
  writesEnabled: boolean;
  connected: boolean;
}

function toNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(v: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : "")).filter(Boolean);
}

function asResultsArray(v: Prisma.JsonValue | null | undefined): PricePushShopResult[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter(
    (x): x is PricePushShopResult => Boolean(x && typeof x === "object")
  );
}

export async function listUnifiedListings(): Promise<{
  items: UnifiedListingItemDto[];
  shops: ShopSummaryDto[];
  history: PriceChangeHistoryDto[];
}> {
  const [shops, garments, changes] = await Promise.all([
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
    prisma.garment.findMany({
      where: { archivedAt: null },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        imageUrl: true,
        sellingPricePhp: true,
        publishes: {
          where: { shopConnection: { isDemo: false } },
          orderBy: { platform: "asc" },
          select: {
            id: true,
            shopConnectionId: true,
            platform: true,
            publishMode: true,
            status: true,
            categoryId: true,
            categoryName: true,
            externalListingId: true,
            error: true,
            pushedAt: true,
            updatedAt: true,
            shopConnection: { select: { shopName: true } },
          },
        },
        variants: {
          orderBy: { label: "asc" },
          select: {
            id: true,
            label: true,
            onShelfCount: true,
            listings: {
              where: { shopConnection: { isDemo: false } },
              select: {
                id: true,
                shopConnectionId: true,
                platform: true,
                listingId: true,
                variationId: true,
                variationName: true,
                availableStock: true,
                pricePhp: true,
                pricePushedPhp: true,
                pricePushedAt: true,
                pricePushError: true,
                shopConnection: { select: { shopName: true } },
                channelProduct: {
                  select: {
                    id: true,
                    title: true,
                    description: true,
                    categoryId: true,
                    categoryName: true,
                    status: true,
                    imageUrls: true,
                    minPricePhp: true,
                    maxPricePhp: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.priceChange.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        garment: { select: { name: true } },
        garmentVariant: { select: { label: true } },
      },
    }),
  ]);

  const items: UnifiedListingItemDto[] = garments.map((g) => {
    const shopPrices = new Set<number>();
    const sourceMap = new Map<string, UnifiedListingItemDto["sourceProducts"][number]>();
    let totalOnShelf = 0;

    const variants = g.variants.map((v) => {
      totalOnShelf += Math.max(0, v.onShelfCount);
      const listings: ShopListingPriceView[] = v.listings.map((l) => {
        const price = toNum(l.pricePhp);
        if (price !== null) shopPrices.add(price);

        const cp = l.channelProduct;
        if (cp) {
          let src = sourceMap.get(cp.id);
          if (!src) {
            src = {
              id: cp.id,
              shopConnectionId: l.shopConnectionId,
              shopName: l.shopConnection.shopName,
              platform: l.platform,
              listingId: l.listingId,
              title: cp.title,
              description: cp.description,
              categoryId: cp.categoryId,
              categoryName: cp.categoryName,
              status: cp.status,
              imageUrls: asStringArray(cp.imageUrls),
              variants: [],
            };
            sourceMap.set(cp.id, src);
          }
          src.variants.push({
            label: v.label,
            pricePhp: price ?? toNum(g.sellingPricePhp),
            stock: Math.max(0, v.onShelfCount || l.availableStock || 0),
          });
        }

        return {
          listingVariantId: l.id,
          shopConnectionId: l.shopConnectionId,
          shopName: l.shopConnection.shopName,
          platform: l.platform,
          listingId: l.listingId,
          variationId: l.variationId,
          variationName: l.variationName,
          pricePhp: price,
          pricePushedPhp: toNum(l.pricePushedPhp),
          pricePushedAt: l.pricePushedAt ? l.pricePushedAt.toISOString() : null,
          pricePushError: l.pricePushError,
          channelProduct: cp
            ? {
                id: cp.id,
                title: cp.title,
                description: cp.description,
                categoryId: cp.categoryId,
                categoryName: cp.categoryName,
                status: cp.status,
                imageUrls: asStringArray(cp.imageUrls),
                minPricePhp: toNum(cp.minPricePhp),
                maxPricePhp: toNum(cp.maxPricePhp),
              }
            : null,
        };
      });

      return {
        id: v.id,
        label: v.label,
        onShelfCount: v.onShelfCount,
        listings,
      };
    });

    return {
      garmentId: g.id,
      garmentName: g.name,
      imageUrl: g.imageUrl,
      sellingPricePhp: toNum(g.sellingPricePhp),
      hasPriceMismatch: shopPrices.size > 1,
      totalOnShelf,
      variants,
      sourceProducts: [...sourceMap.values()],
      publishes: g.publishes.map((p) => ({
        id: p.id,
        shopConnectionId: p.shopConnectionId,
        shopName: p.shopConnection.shopName,
        platform: p.platform,
        publishMode: p.publishMode,
        status: p.status,
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        externalListingId: p.externalListingId,
        error: p.error,
        pushedAt: p.pushedAt ? p.pushedAt.toISOString() : null,
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  });

  return {
    items,
    shops: shops.map((s) => ({
      id: s.id,
      platform: s.platform,
      shopName: s.shopName,
      writesEnabled: s.writesEnabled,
      connected: Boolean(s.accessToken),
    })),
    history: changes.map((c) => ({
      id: c.id,
      garmentId: c.garmentId,
      garmentName: c.garment.name,
      variantLabel: c.garmentVariant?.label ?? null,
      actionRequestId: c.actionRequestId,
      oldPricePhp: toNum(c.oldPricePhp),
      newPricePhp: toNum(c.newPricePhp) ?? 0,
      status: c.status,
      results: asResultsArray(c.resultsJson),
      createdBy: c.createdBy,
      decidedBy: c.decidedBy,
      pushedAt: c.pushedAt ? c.pushedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export interface PriceUpdateApprovalPayload {
  priceChangeId: string;
  garmentId: string;
  garmentVariantId: string | null;
  garmentName: string;
  variantLabel: string | null;
  oldPricePhp: number | null;
  newPricePhp: number;
  targetShops: Array<{ shopName: string; platform: "SHOPEE" | "TIKTOK"; writesEnabled: boolean }>;
}

export async function proposePriceChange(
  input: { garmentId: string; garmentVariantId?: string | null; newPricePhp: number },
  actor: AuditActor
): Promise<{ priceChangeId: string; actionRequestId: string }> {
  const checked = validateProposedPrice(input.newPricePhp);
  if (!checked.ok) throw new Error(checked.error);

  const garment = await prisma.garment.findUniqueOrThrow({
    where: { id: input.garmentId },
    select: {
      id: true,
      name: true,
      sellingPricePhp: true,
      variants: {
        where: input.garmentVariantId ? { id: input.garmentVariantId } : undefined,
        select: {
          id: true,
          label: true,
          listings: {
            where: { shopConnection: { isDemo: false } },
            select: {
              id: true,
              pricePhp: true,
              shopConnection: {
                select: { id: true, shopName: true, platform: true, writesEnabled: true },
              },
            },
          },
        },
      },
    },
  });

  if (input.garmentVariantId && garment.variants.length === 0) {
    throw new Error("Selected variant was not found.");
  }

  const allListings = garment.variants.flatMap((v) => v.listings);
  if (allListings.length === 0) {
    throw new Error("This item has no linked Shopee or TikTok listings yet.");
  }

  const shopMap = new Map<string, { shopName: string; platform: "SHOPEE" | "TIKTOK"; writesEnabled: boolean }>();
  for (const l of allListings) {
    if (!shopMap.has(l.shopConnection.id)) {
      shopMap.set(l.shopConnection.id, {
        shopName: l.shopConnection.shopName,
        platform: l.shopConnection.platform,
        writesEnabled: l.shopConnection.writesEnabled,
      });
    }
  }
  const targetShops = [...shopMap.values()];
  const variantLabel = input.garmentVariantId ? garment.variants[0]?.label ?? null : null;
  const oldPricePhp =
    toNum(garment.sellingPricePhp) ??
    toNum(allListings.find((l) => l.pricePhp !== null)?.pricePhp);

  const title = variantLabel
    ? `Update price: ${garment.name} (${variantLabel})`
    : `Update price: ${garment.name}`;
  const summary = `${oldPricePhp !== null ? `₱${oldPricePhp.toFixed(2)}` : "Unset"} -> ₱${checked.value.toFixed(2)} across ${targetShops.map((s) => s.shopName).join(", ")}`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTION_REQUEST_TTL_MS);

  const created = await prisma.$transaction(async (tx) => {
    const req = await tx.actionRequest.create({
      data: {
        kind: "listing.price_update",
        status: ActionRequestStatus.PENDING,
        title,
        summary,
        payloadJson: {},
        proposedBy: actor.name,
        expiresAt,
      },
    });

    const pc = await tx.priceChange.create({
      data: {
        garmentId: garment.id,
        garmentVariantId: input.garmentVariantId ?? null,
        actionRequestId: req.id,
        oldPricePhp: oldPricePhp !== null ? new Prisma.Decimal(oldPricePhp.toFixed(2)) : null,
        newPricePhp: new Prisma.Decimal(checked.value.toFixed(2)),
        status: PriceChangeStatus.PENDING,
        createdBy: actor.name,
      },
    });

    const payload: PriceUpdateApprovalPayload = {
      priceChangeId: pc.id,
      garmentId: garment.id,
      garmentVariantId: input.garmentVariantId ?? null,
      garmentName: garment.name,
      variantLabel,
      oldPricePhp,
      newPricePhp: checked.value,
      targetShops,
    };

    await tx.actionRequest.update({
      where: { id: req.id },
      data: { payloadJson: payload as unknown as Prisma.InputJsonValue },
    });

    await recordAudit(
      {
        actor,
        action: "price_change.proposed",
        entity: "PriceChange",
        entityId: pc.id,
        after: {
          actionRequestId: req.id,
          garmentName: garment.name,
          oldPricePhp,
          newPricePhp: checked.value,
        },
      },
      tx
    );

    return { priceChangeId: pc.id, actionRequestId: req.id };
  });

  const card = formatPriceChangeApprovalCard({
    garmentName: garment.name,
    variantLabel,
    oldPricePhp,
    newPricePhp: checked.value,
    targetShops,
    baseUrl: process.env.APP_BASE_URL,
  });
  await notifyOwnerTelegram(card, buildApprovalInlineKeyboard(created.actionRequestId)).catch((err) =>
    console.error("[listings] price approval notify", err)
  );

  return created;
}

async function pushListingGroups(
  listings: Array<{
    id: string;
    listingId: string;
    variationId: string;
    shopConnectionId: string;
    platform: Platform;
    shopConnection: ShopConnection;
  }>,
  newPricePhp: number,
  now: Date
): Promise<PricePushShopResult[]> {
  const byGroup = new Map<string, typeof listings>();
  for (const lv of listings) {
    const key = `${lv.shopConnectionId}:${lv.listingId}`;
    const arr = byGroup.get(key);
    if (arr) arr.push(lv);
    else byGroup.set(key, [lv]);
  }

  const results: PricePushShopResult[] = [];
  const priceDec = new Prisma.Decimal(newPricePhp.toFixed(2));

  for (const group of byGroup.values()) {
    const shop = group[0].shopConnection;
    if (shop.isDemo || !shop.writesEnabled || !shop.accessToken) {
      const reason = !shop.writesEnabled
        ? "Shop writes are off in Settings."
        : "Reconnect shop first.";
      await prisma.listingVariant.updateMany({
        where: { id: { in: group.map((g) => g.id) } },
        data: { pricePushError: reason },
      });
      for (const lv of group) {
        results.push({
          listingVariantId: lv.id,
          shopConnectionId: shop.id,
          shopName: shop.shopName,
          platform: shop.platform,
          listingId: lv.listingId,
          variationId: lv.variationId,
          status: "SKIPPED",
          error: reason,
        });
      }
      continue;
    }

    try {
      const token = await ensureFreshToken(shop);
      const connector = getChannelConnector(shop.platform);
      const candidates: PricePushCandidate[] = group.map((lv) => ({
        listingVariantId: lv.id,
        platform: lv.platform,
        shopConnectionId: lv.shopConnectionId,
        listingId: lv.listingId,
        variationId: lv.variationId,
        pricePhp: newPricePhp,
      }));
      const pushed = await connector.pushListingPrices(shop, token, candidates);
      const okSet = new Set(pushed.ok);
      const failMap = new Map(pushed.failed.map((f) => [f.id, f.error]));

      if (pushed.ok.length) {
        await prisma.listingVariant.updateMany({
          where: { id: { in: pushed.ok } },
          data: {
            pricePhp: priceDec,
            pricePushedPhp: priceDec,
            pricePushedAt: now,
            pricePushError: null,
          },
        });
      }
      for (const f of pushed.failed) {
        await prisma.listingVariant.update({
          where: { id: f.id },
          data: { pricePushError: f.error.slice(0, 300) },
        });
      }

      for (const lv of group) {
        if (okSet.has(lv.id)) {
          results.push({
            listingVariantId: lv.id,
            shopConnectionId: shop.id,
            shopName: shop.shopName,
            platform: shop.platform,
            listingId: lv.listingId,
            variationId: lv.variationId,
            status: "OK",
            pushedAt: now.toISOString(),
          });
        } else {
          results.push({
            listingVariantId: lv.id,
            shopConnectionId: shop.id,
            shopName: shop.shopName,
            platform: shop.platform,
            listingId: lv.listingId,
            variationId: lv.variationId,
            status: "FAILED",
            error: failMap.get(lv.id) ?? "Push failed",
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Push failed";
      await prisma.listingVariant.updateMany({
        where: { id: { in: group.map((g) => g.id) } },
        data: { pricePushError: msg.slice(0, 300) },
      });
      for (const lv of group) {
        results.push({
          listingVariantId: lv.id,
          shopConnectionId: shop.id,
          shopName: shop.shopName,
          platform: shop.platform,
          listingId: lv.listingId,
          variationId: lv.variationId,
          status: "FAILED",
          error: msg,
        });
      }
    }
  }

  return results;
}

export async function executeApprovedPriceChange(
  actionRequestId: string,
  payload: PriceUpdateApprovalPayload,
  actor: AuditActor
): Promise<{ priceChangeId: string; status: PriceChangeStatusValue; results: PricePushShopResult[] }> {
  const now = new Date();
  if (!payload.garmentVariantId) {
    await prisma.garment.update({
      where: { id: payload.garmentId },
      data: { sellingPricePhp: new Prisma.Decimal(payload.newPricePhp.toFixed(2)) },
    });
  }

  const listings = await prisma.listingVariant.findMany({
    where: {
      shopConnection: { isDemo: false },
      ...(payload.garmentVariantId
        ? { garmentVariantId: payload.garmentVariantId }
        : { garmentVariant: { garmentId: payload.garmentId } }),
    },
    include: {
      shopConnection: true,
    },
  });

  const results = await pushListingGroups(listings, payload.newPricePhp, now);
  const status = derivePriceChangeStatus(results);

  await prisma.priceChange.update({
    where: { id: payload.priceChangeId },
    data: {
      status,
      resultsJson: results as unknown as Prisma.InputJsonValue,
      decidedBy: actor.name,
      pushedAt: now,
    },
  });

  await recordAudit({
    actor,
    action: "price_change.pushed",
    entity: "PriceChange",
    entityId: payload.priceChangeId,
    after: {
      actionRequestId,
      status,
      newPricePhp: payload.newPricePhp,
      okCount: results.filter((r) => r.status === "OK").length,
      failedCount: results.filter((r) => r.status !== "OK").length,
    },
  });

  return { priceChangeId: payload.priceChangeId, status, results };
}

export async function retryPriceChange(
  priceChangeId: string,
  actor: AuditActor
): Promise<PriceChangeHistoryDto> {
  const pc = await prisma.priceChange.findUniqueOrThrow({
    where: { id: priceChangeId },
    include: {
      garment: { select: { name: true } },
      garmentVariant: { select: { label: true } },
    },
  });
  if (pc.status !== PriceChangeStatus.PARTIAL && pc.status !== PriceChangeStatus.FAILED) {
    throw new Error("Only partial or failed price updates can be retried.");
  }

  const existingResults = asResultsArray(pc.resultsJson);
  const okResults = existingResults.filter((r) => r.status === "OK");
  const retryIds = existingResults
    .filter((r) => r.status !== "OK")
    .map((r) => r.listingVariantId);

  const listings = await prisma.listingVariant.findMany({
    where: retryIds.length
      ? { id: { in: retryIds } }
      : {
          shopConnection: { isDemo: false },
          ...(pc.garmentVariantId
            ? { garmentVariantId: pc.garmentVariantId }
            : { garmentVariant: { garmentId: pc.garmentId } }),
        },
    include: {
      shopConnection: true,
    },
  });

  const now = new Date();
  const retried = await pushListingGroups(listings, Number(pc.newPricePhp), now);
  const merged = [...okResults, ...retried];
  const nextStatus = derivePriceChangeStatus(merged);

  const updated = await prisma.priceChange.update({
    where: { id: pc.id },
    data: {
      status: nextStatus,
      resultsJson: merged as unknown as Prisma.InputJsonValue,
      pushedAt: now,
    },
    include: {
      garment: { select: { name: true } },
      garmentVariant: { select: { label: true } },
    },
  });

  await recordAudit({
    actor,
    action: "price_change.retried",
    entity: "PriceChange",
    entityId: pc.id,
    after: { status: nextStatus, retriedCount: retried.length },
  });

  return {
    id: updated.id,
    garmentId: updated.garmentId,
    garmentName: updated.garment.name,
    variantLabel: updated.garmentVariant?.label ?? null,
    actionRequestId: updated.actionRequestId,
    oldPricePhp: toNum(updated.oldPricePhp),
    newPricePhp: toNum(updated.newPricePhp) ?? 0,
    status: updated.status,
    results: merged,
    createdBy: updated.createdBy,
    decidedBy: updated.decidedBy,
    pushedAt: updated.pushedAt ? updated.pushedAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
  };
}

export interface CopyListingApprovalPayload {
  sourceChannelProductId: string;
  sourcePlatform: "SHOPEE" | "TIKTOK";
  targetShopConnectionId: string;
  targetShopName: string;
  targetPlatform: "SHOPEE" | "TIKTOK";
  title: string;
  description: string;
  categoryId: string;
  pricePhp: number;
  stock: number;
  imageUrls: string[];
  variants: Array<{ label: string; pricePhp: number; stock: number }>;
}

export async function proposeCopyListing(
  input: {
    sourceChannelProductId: string;
    targetShopConnectionId: string;
    title: string;
    description: string;
    categoryId: string;
    pricePhp: number;
    variants: Array<{ label: string; pricePhp: number; stock: number }>;
  },
  actor: AuditActor
): Promise<{ actionRequestId: string }> {
  const checkedPrice = validateProposedPrice(input.pricePhp);
  if (!checkedPrice.ok) throw new Error(checkedPrice.error);
  if (!input.categoryId.trim()) {
    throw new Error("Enter the destination shop's category ID.");
  }

  const [source, targetShop] = await Promise.all([
    prisma.channelProduct.findUniqueOrThrow({
      where: { id: input.sourceChannelProductId },
      include: {
        shopConnection: { select: { id: true, shopName: true, platform: true } },
      },
    }),
    prisma.shopConnection.findUniqueOrThrow({
      where: { id: input.targetShopConnectionId },
    }),
  ]);

  if (targetShop.isDemo) throw new Error("Cannot copy into a demo shop.");
  if (targetShop.id === source.shopConnectionId) {
    throw new Error("Pick a different destination shop.");
  }

  const preview = buildListingCopyPreview(
    {
      title: input.title,
      description: input.description,
      categoryId: source.categoryId,
      categoryName: source.categoryName,
      imageUrls: asStringArray(source.imageUrls),
      variants: input.variants,
    },
    targetShop.platform,
    targetShop.writesEnabled
  );

  const totalStock = preview.variants.reduce((sum, v) => sum + v.stock, 0);
  const payload: CopyListingApprovalPayload = {
    sourceChannelProductId: source.id,
    sourcePlatform: source.platform,
    targetShopConnectionId: targetShop.id,
    targetShopName: targetShop.shopName,
    targetPlatform: targetShop.platform,
    title: preview.title,
    description: preview.description,
    categoryId: input.categoryId.trim(),
    pricePhp: checkedPrice.value,
    stock: totalStock,
    imageUrls: preview.imageUrls,
    variants: preview.variants.length
      ? preview.variants
      : [{ label: "Default", pricePhp: checkedPrice.value, stock: totalStock }],
  };

  const now = new Date();
  const req = await prisma.$transaction(async (tx) => {
    const row = await tx.actionRequest.create({
      data: {
        kind: "listing.copy",
        status: ActionRequestStatus.PENDING,
        title: `Copy draft: ${payload.title.slice(0, 80)}`,
        summary: `${source.platform === "SHOPEE" ? "Shopee" : "TikTok"} -> ${targetShop.shopName} (${payload.variants.length} variant${payload.variants.length === 1 ? "" : "s"}, ₱${payload.pricePhp.toFixed(2)})`,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        proposedBy: actor.name,
        expiresAt: new Date(now.getTime() + ACTION_REQUEST_TTL_MS),
      },
    });
    await recordAudit(
      {
        actor,
        action: "listing_copy.proposed",
        entity: "ActionRequest",
        entityId: row.id,
        after: {
          title: payload.title,
          targetShopName: targetShop.shopName,
          targetPlatform: targetShop.platform,
        },
      },
      tx
    );
    return row;
  });

  const card = formatCopyListingApprovalCard({
    title: payload.title,
    sourcePlatform: payload.sourcePlatform,
    targetShopName: targetShop.shopName,
    targetPlatform: targetShop.platform,
    variantCount: payload.variants.length,
    baseUrl: process.env.APP_BASE_URL,
  });
  await notifyOwnerTelegram(card, buildApprovalInlineKeyboard(req.id)).catch((err) =>
    console.error("[listings] copy approval notify", err)
  );

  return { actionRequestId: req.id };
}

export async function executeApprovedCopyListing(
  actionRequestId: string,
  payload: CopyListingApprovalPayload,
  actor: AuditActor
): Promise<{ externalListingId: string; status: string }> {
  const targetShop = await prisma.shopConnection.findUniqueOrThrow({
    where: { id: payload.targetShopConnectionId },
  });
  if (targetShop.isDemo || !targetShop.writesEnabled || !targetShop.accessToken) {
    throw new Error(
      `Turn on shop writes for ${targetShop.shopName} in Settings before creating this draft.`
    );
  }

  const token = await ensureFreshToken(targetShop);
  const connector = getChannelConnector(targetShop.platform);
  const res = await connector.createDraftListing(targetShop, token, {
    title: payload.title,
    description: payload.description,
    categoryId: payload.categoryId,
    pricePhp: payload.pricePhp,
    stock: payload.stock,
    imageUrls: payload.imageUrls,
    variants: payload.variants,
  });

  if (res.externalListingId) {
    const prices = payload.variants.map((v) => v.pricePhp);
    const minP = Math.min(...prices, payload.pricePhp);
    const maxP = Math.max(...prices, payload.pricePhp);
    await prisma.channelProduct.upsert({
      where: {
        shopConnectionId_listingId: {
          shopConnectionId: targetShop.id,
          listingId: res.externalListingId,
        },
      },
      create: {
        shopConnectionId: targetShop.id,
        platform: targetShop.platform,
        listingId: res.externalListingId,
        title: payload.title,
        description: payload.description,
        categoryId: payload.categoryId,
        status: res.status,
        imageUrls: payload.imageUrls as Prisma.InputJsonValue,
        minPricePhp: new Prisma.Decimal(minP.toFixed(2)),
        maxPricePhp: new Prisma.Decimal(maxP.toFixed(2)),
        syncedAt: new Date(),
      },
      update: {
        title: payload.title,
        description: payload.description,
        categoryId: payload.categoryId,
        status: res.status,
        syncedAt: new Date(),
      },
    });
  }

  await recordAudit({
    actor,
    action: "listing_copy.created",
    entity: "ActionRequest",
    entityId: actionRequestId,
    after: {
      targetShopName: targetShop.shopName,
      externalListingId: res.externalListingId,
      status: res.status,
    },
  });

  return res;
}
