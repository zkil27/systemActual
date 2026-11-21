import { shopeeModelLabel } from "./variants";

/** One sellable listing variation with the shop's current "available" stock. */
export interface ImportedListing {
  listingId: string;
  variationId: string;
  name: string;
  variationName: string | null;
  imageUrl: string | null;
  availableStock: number;
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
      { listingId, variationId: "0", name, variationName: null, imageUrl: itemImage, availableStock: shopeeAvailable(base.stock_info_v2) },
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
      };
    });
}

/** TikTok: one product from Get Product (/product/202309/products/{id}). */
export function mapTikTokProduct(p: Raw): ImportedListing[] {
  const listingId = String(p.id);
  const name = String(p.title ?? "Item");
  const mainUrls = arr(arr(p.main_images)[0]?.urls as unknown);
  const productImage = mainUrls.length ? String(mainUrls[0]) : null;
  return arr(p.skus).map((s) => {
    const attrs = arr(s.sales_attributes);
    const skuImg = arr((attrs.find((a) => a.sku_img)?.sku_img as Raw | undefined)?.urls as unknown);
    const label = attrs.map((a) => String(a.value_name ?? "")).filter(Boolean).join(", ");
    return {
      listingId,
      variationId: String(s.id),
      name,
      variationName: label || null,
      imageUrl: skuImg.length ? String(skuImg[0]) : productImage,
      availableStock: arr(s.inventory).reduce((n, i) => n + num(i.quantity), 0),
    };
  });
}
