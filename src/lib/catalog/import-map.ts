import { shopeeModelLabel } from "./variants";

/** One sellable listing variation with the shop's current "available" stock. */
export interface ImportedListing {
  listingId: string;
  variationId: string;
  name: string;
  variationName: string | null;
  imageUrl: string | null;
  availableStock: number;
  /** TikTok only: needed later to update this SKU's stock. */
  warehouseId: string | null;
}

type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function shopeeAvailable(stockInfoV2: unknown): number {
  const summary = (stockInfoV2 as Raw | undefined)?.summary_info as Raw | undefined;
  if (summary && summary.total_available_stock !== undefined) return num(summary.total_available_stock);
  // Fallback: sum of seller-managed stock.
  return arr((stockInfoV2 as Raw | undefined)?.seller_stock).reduce((n, s) => n + num(s.stock), 0);
}

/**
 * Shopee: one item from get_item_base_info, plus its get_model_list response
 * when the item has variations. Items without variations become model_id "0",
 * matching how order lines store them.
 */
export function mapShopeeItem(base: Raw, models: Raw | null): ImportedListing[] {
  const listingId = String(base.item_id);
  const name = String(base.item_name ?? "Item");
  const images = arr((base.image as Raw | undefined)?.image_url_list as unknown);
  const itemImage = images.length ? String(images[0]) : null;

  if (!base.has_model || !models) {
    return [
      {
        listingId,
        variationId: "0",
        name,
        variationName: null,
        imageUrl: itemImage,
        availableStock: shopeeAvailable(base.stock_info_v2),
        warehouseId: null,
      },
    ];
  }

  const tiers = arr(models.tier_variation) as Array<{ option_list?: Array<{ option?: string; image?: { image_url?: string } }> }>;
  return arr(models.model)
    .filter((m) => String(m.model_status ?? "MODEL_NORMAL") !== "MODEL_UNAVAILABLE")
    .map((m) => {
      const tierIndex = Array.isArray(m.tier_index) ? (m.tier_index as number[]) : [];
      const optionImage = tiers[0]?.option_list?.[tierIndex[0] ?? -1]?.image?.image_url;
      return {
        listingId,
        variationId: String(m.model_id),
        name,
        variationName: (m.model_name ? String(m.model_name) : null) ?? shopeeModelLabel(tiers, tierIndex),
        imageUrl: optionImage ? String(optionImage) : itemImage,
        availableStock: shopeeAvailable(m.stock_info_v2),
        warehouseId: null,
      };
    });
}

/**
 * TikTok: one product from Get Product (/product/202309/products/{id}).
 * A SKU can hold stock in several warehouses, but we only ever update one, so
 * "available" is that warehouse's quantity: the one already linked
 * (`knownWarehouses`, by SKU id), else the first listed.
 */
export function mapTikTokProduct(p: Raw, knownWarehouses?: ReadonlyMap<string, string>): ImportedListing[] {
  const listingId = String(p.id);
  const name = String(p.title ?? "Item");
  const mainUrls = arr(arr(p.main_images)[0]?.urls as unknown);
  const productImage = mainUrls.length ? String(mainUrls[0]) : null;
  return arr(p.skus).map((s) => {
    const attrs = arr(s.sales_attributes);
    const skuImg = arr((attrs.find((a) => a.sku_img)?.sku_img as Raw | undefined)?.urls as unknown);
    const label = attrs.map((a) => String(a.value_name ?? "")).filter(Boolean).join(", ");
    const inventory = arr(s.inventory).filter((i) => i.warehouse_id !== undefined && i.warehouse_id !== null);
    const known = knownWarehouses?.get(String(s.id));
    const chosen = (known && inventory.find((i) => String(i.warehouse_id) === known)) || inventory[0];
    return {
      listingId,
      variationId: String(s.id),
      name,
      variationName: label || null,
      imageUrl: skuImg.length ? String(skuImg[0]) : productImage,
      availableStock: chosen ? num(chosen.quantity) : arr(s.inventory).reduce((n, i) => n + num(i.quantity), 0),
      warehouseId: chosen ? String(chosen.warehouse_id) : null,
    };
  });
}

/** Parent listing metadata & per-variation prices captured during read-only catalog import. */
export interface ImportedChannelProduct {
  listingId: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: string | null;
  imageUrls: string[];
  currency: string;
  priceByVariation: Record<string, number>;
}

function positiveNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : null;
}

function pickShopeePrice(raw: Raw | undefined): number | null {
  if (!raw) return null;
  const info = arr(raw.price_info)[0];
  if (!info) return null;
  return positiveNum(info.original_price) ?? positiveNum(info.current_price);
}

export function mapShopeeChannelProduct(base: Raw, models: Raw | null): ImportedChannelProduct {
  const listingId = String(base.item_id);
  const title = String(base.item_name ?? "Item");
  const descInfo = base.description_info as Raw | undefined;
  const extendedDesc = arr(descInfo?.extended_description as unknown)
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n");
  const description =
    (typeof base.description === "string" && base.description.trim()) ||
    extendedDesc ||
    null;
  const imageUrls = arr((base.image as Raw | undefined)?.image_url_list as unknown)
    .map((u) => String(u ?? "").trim())
    .filter(Boolean);

  const priceByVariation: Record<string, number> = {};
  if (!base.has_model || !models) {
    const p = pickShopeePrice(base);
    if (p !== null) priceByVariation["0"] = p;
  } else {
    for (const m of arr(models.model)) {
      if (String(m.model_status ?? "MODEL_NORMAL") === "MODEL_UNAVAILABLE") continue;
      const p = pickShopeePrice(m) ?? pickShopeePrice(base);
      if (p !== null) priceByVariation[String(m.model_id)] = p;
    }
  }

  return {
    listingId,
    title,
    description,
    categoryId: base.category_id !== undefined && base.category_id !== null ? String(base.category_id) : null,
    categoryName: null,
    status: base.item_status ? String(base.item_status) : null,
    imageUrls,
    currency: "PHP",
    priceByVariation,
  };
}

export function mapTikTokChannelProduct(p: Raw): ImportedChannelProduct {
  const listingId = String(p.id);
  const title = String(p.title ?? "Item");
  const description = typeof p.description === "string" && p.description.trim() ? p.description.trim() : null;
  const chains = arr(p.category_chains);
  const leafCat = chains.length ? chains[chains.length - 1] : undefined;
  const imageUrls = arr(p.main_images)
    .flatMap((img) => arr(img.urls as unknown))
    .map((u) => String(u ?? "").trim())
    .filter(Boolean);

  const priceByVariation: Record<string, number> = {};
  for (const s of arr(p.skus)) {
    const priceObj = s.price as Raw | undefined;
    const price =
      positiveNum(priceObj?.tax_exclusive_price) ??
      positiveNum(priceObj?.sale_price) ??
      positiveNum(priceObj?.original_price);
    if (price !== null) priceByVariation[String(s.id)] = price;
  }

  return {
    listingId,
    title,
    description,
    categoryId: leafCat?.id !== undefined && leafCat?.id !== null ? String(leafCat.id) : null,
    categoryName: typeof leafCat?.local_name === "string" ? leafCat.local_name : null,
    status: p.status ? String(p.status) : null,
    imageUrls,
    currency: "PHP",
    priceByVariation,
  };
}
