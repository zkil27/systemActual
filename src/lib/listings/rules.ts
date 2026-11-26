export type PriceChangeStatusValue =
  | "PENDING"
  | "PUSHED"
  | "PARTIAL"
  | "FAILED"
  | "REJECTED";

export interface PricePushShopResult {
  listingVariantId: string;
  shopConnectionId: string;
  shopName: string;
  platform: "SHOPEE" | "TIKTOK";
  listingId: string;
  variationId: string;
  status: "OK" | "FAILED" | "SKIPPED";
  error?: string;
  pushedAt?: string;
}

export function validateProposedPrice(
  raw: number
): { ok: true; value: number } | { ok: false; error: string } {
  if (!Number.isFinite(raw)) {
    return { ok: false, error: "Enter a valid price." };
  }
  const rounded = Number(raw.toFixed(2));
  if (rounded < 1 || rounded > 100_000) {
    return { ok: false, error: "Price must be between ₱1 and ₱100,000." };
  }
  return { ok: true, value: rounded };
}

export function derivePriceChangeStatus(
  results: ReadonlyArray<{ status: "OK" | "FAILED" | "SKIPPED" }>
): "PUSHED" | "PARTIAL" | "FAILED" {
  if (!results.length) return "FAILED";
  const okCount = results.filter((r) => r.status === "OK").length;
  if (okCount === results.length) return "PUSHED";
  if (okCount > 0) return "PARTIAL";
  return "FAILED";
}

export interface ListingCopyPreview {
  title: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  imageUrls: string[];
  variants: Array<{ label: string; pricePhp: number; stock: number }>;
  warnings: string[];
}

/**
 * Builds the owner preview + shop safety warnings before queuing a cross-shop draft copy.
 */
export function buildListingCopyPreview(
  source: {
    title: string;
    description: string | null;
    categoryId: string | null;
    categoryName: string | null;
    imageUrls: string[];
    variants: Array<{
      label: string;
      pricePhp: number | null;
      stock: number;
    }>;
  },
  targetPlatform: "SHOPEE" | "TIKTOK",
  targetWritesEnabled: boolean
): ListingCopyPreview {
  const warnings: string[] = [];
  if (!targetWritesEnabled) {
    warnings.push(
      `Writes are currently off for ${targetPlatform === "SHOPEE" ? "Shopee" : "TikTok"} in Settings. Turn writes on before approving.`
    );
  }
  if (targetPlatform === "TIKTOK") {
    warnings.push(
      "Saved as a TikTok draft (AS_DRAFT). Publishing later on Seller Center triggers TikTok review."
    );
  } else {
    warnings.push(
      "Saved as an unlisted Shopee item (UNLIST). Verify required category attributes and photos before listing."
    );
  }
  warnings.push(
    "Provide the destination shop's numeric category ID; Shopee and TikTok use separate category trees."
  );

  return {
    title: source.title.trim().slice(0, targetPlatform === "SHOPEE" ? 120 : 255),
    description: (source.description?.trim() || source.title.trim()).slice(0, 3000),
    categoryId: null,
    categoryName: source.categoryName,
    imageUrls: source.imageUrls.slice(0, 9),
    variants: source.variants.map((v) => ({
      label: v.label,
      pricePhp: v.pricePhp !== null && Number.isFinite(v.pricePhp) ? v.pricePhp : 199,
      stock: Math.max(0, Math.round(v.stock)),
    })),
    warnings,
  };
}

export function formatPriceChangeApprovalCard(opts: {
  garmentName: string;
  variantLabel?: string | null;
  oldPricePhp: number | null;
  newPricePhp: number;
  targetShops: Array<{ shopName: string; platform: "SHOPEE" | "TIKTOK"; writesEnabled: boolean }>;
  baseUrl?: string | null;
}): string {
  const targetTitle = opts.variantLabel
    ? `${opts.garmentName} (${opts.variantLabel})`
    : opts.garmentName;
  const oldStr = opts.oldPricePhp !== null ? `₱${opts.oldPricePhp.toFixed(2)}` : "Unset";
  const shopLine = opts.targetShops
    .map((s) => `${s.shopName}${s.writesEnabled ? "" : " (writes off)"}`)
    .join(", ");
  const base = opts.baseUrl?.trim().replace(/\/$/, "");
  const lines = [
    `APPROVAL NEEDED — Price update`,
    `Item: ${targetTitle}`,
    `Price: ${oldStr} -> ₱${opts.newPricePhp.toFixed(2)}`,
    `Shops: ${shopLine || "Local item only"}`,
  ];
  if (base) lines.push(``, `Review in Kyna Ops: ${base}/approvals`);
  return lines.join("\n");
}

export function formatCopyListingApprovalCard(opts: {
  title: string;
  sourcePlatform: "SHOPEE" | "TIKTOK";
  targetShopName: string;
  targetPlatform: "SHOPEE" | "TIKTOK";
  variantCount: number;
  baseUrl?: string | null;
}): string {
  const fromLabel = opts.sourcePlatform === "SHOPEE" ? "Shopee" : "TikTok";
  const toLabel = opts.targetPlatform === "SHOPEE" ? "Shopee (Unlisted)" : "TikTok (Draft)";
  const base = opts.baseUrl?.trim().replace(/\/$/, "");
  const lines = [
    `APPROVAL NEEDED — Copy listing as draft`,
    `Title: ${opts.title}`,
    `Route: ${fromLabel} -> ${opts.targetShopName} (${toLabel})`,
    `Variants: ${opts.variantCount}`,
  ];
  if (base) lines.push(``, `Review in Kyna Ops: ${base}/approvals`);
  return lines.join("\n");
}
