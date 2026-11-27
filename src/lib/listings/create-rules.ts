export const MAX_LISTING_PHOTOS = 9;
export const MAX_VARIANTS = 50;
export const MAX_TIERS = 2;
export const DEFAULT_WEIGHT_KG = 0.3;

export type ShopPlatform = "SHOPEE" | "TIKTOK";
export type PublishMode = "DRAFT" | "LIVE";

export interface TierSpec {
  name: string;
  options: string[];
}

export interface VariantMatrixRow {
  label: string;
  tierValues: string[];
  pricePhp: number;
  stock: number;
  skuCode?: string | null;
}

export interface CreateItemShopTargetInput {
  shopConnectionId: string;
  platform: ShopPlatform;
  categoryId: string;
  categoryName?: string | null;
}

export interface CreateItemValidatedInput {
  title: string;
  description: string;
  publishMode: PublishMode;
  imageUrls: string[];
  weightKg: number;
  dimensionsCm: { length: number; width: number; height: number } | null;
  unitCostPhp: number | null;
  safetyBuffer: number | null;
  binLocation: string | null;
  tiers: TierSpec[];
  variants: VariantMatrixRow[];
  targets: CreateItemShopTargetInput[];
}

export interface CategoryChip {
  categoryId: string;
  categoryName: string | null;
  count: number;
}

export interface CategoryPreset {
  key: string;
  label: string;
  shopeeCategoryId: string;
  shopeeCategoryName: string | null;
  tiktokCategoryId: string;
  tiktokCategoryName: string | null;
  count: number;
}

export interface CategoryNodeInput {
  id: string;
  parentId: string | null;
  name: string;
  isLeaf: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
  path: string;
  isLeaf: boolean;
}

function cleanOptions(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Generates the single-SKU, 1-tier, or 2-tier variation matrix while keeping
 * any existing price, stock, and SKU values entered by the owner.
 */
export function buildVariantMatrix(
  rawTiers: TierSpec[],
  defaultPricePhp: number,
  defaultStock: number,
  existing?: ReadonlyMap<string, { pricePhp: number; stock: number; skuCode?: string | null }>
): { ok: true; tiers: TierSpec[]; variants: VariantMatrixRow[] } | { ok: false; error: string } {
  if (rawTiers.length > MAX_TIERS) {
    return { ok: false, error: `Use at most ${MAX_TIERS} option groups (like Color and Size).` };
  }

  const tiers: TierSpec[] = [];
  const tierNames = new Set<string>();
  for (const t of rawTiers) {
    const name = t.name.trim().replace(/\s+/g, " ").slice(0, 30);
    const options = cleanOptions(t.options);
    if (!name && options.length === 0) continue;
    if (!name) return { ok: false, error: "Give each option group a name (like Color or Size)." };
    if (!options.length) return { ok: false, error: `Add at least one choice under "${name}".` };
    const nameKey = name.toLowerCase();
    if (tierNames.has(nameKey)) {
      return { ok: false, error: `Option group "${name}" is listed twice.` };
    }
    tierNames.add(nameKey);
    tiers.push({ name, options });
  }

  const safePrice = Number.isFinite(defaultPricePhp) && defaultPricePhp >= 1 ? Number(defaultPricePhp.toFixed(2)) : 199;
  const safeStock = Number.isFinite(defaultStock) && defaultStock >= 0 ? Math.floor(defaultStock) : 0;

  if (tiers.length === 0) {
    const prev = existing?.get("One size");
    return {
      ok: true,
      tiers: [],
      variants: [
        {
          label: "One size",
          tierValues: [],
          pricePhp: prev?.pricePhp ?? safePrice,
          stock: prev?.stock ?? safeStock,
          skuCode: prev?.skuCode ?? null,
        },
      ],
    };
  }

  if (tiers.length === 1) {
    if (tiers[0].options.length > MAX_VARIANTS) {
      return { ok: false, error: `Shopee allows up to ${MAX_VARIANTS} variations per item.` };
    }
    return {
      ok: true,
      tiers,
      variants: tiers[0].options.map((opt) => {
        const prev = existing?.get(opt);
        return {
          label: opt,
          tierValues: [opt],
          pricePhp: prev?.pricePhp ?? safePrice,
          stock: prev?.stock ?? safeStock,
          skuCode: prev?.skuCode ?? null,
        };
      }),
    };
  }

  const total = tiers[0].options.length * tiers[1].options.length;
  if (total > MAX_VARIANTS) {
    return {
      ok: false,
      error: `${total} combinations exceeds Shopee's limit of ${MAX_VARIANTS} per item.`,
    };
  }

  const variants: VariantMatrixRow[] = [];
  for (const a of tiers[0].options) {
    for (const b of tiers[1].options) {
      const label = `${a}, ${b}`;
      const prev = existing?.get(label);
      variants.push({
        label,
        tierValues: [a, b],
        pricePhp: prev?.pricePhp ?? safePrice,
        stock: prev?.stock ?? safeStock,
        skuCode: prev?.skuCode ?? null,
      });
    }
  }
  return { ok: true, tiers, variants };
}

/**
 * Validates the complete Add Item payload before writing to Kyna Ops or shops.
 */
export function validateCreateItemInput(input: {
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
  targets: CreateItemShopTargetInput[];
}): { ok: true; value: CreateItemValidatedInput } | { ok: false; error: string } {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) return { ok: false, error: "Enter an item name." };

  const targets = input.targets ?? [];
  const hasShopee = targets.some((t) => t.platform === "SHOPEE");
  if (hasShopee && title.length > 120) {
    return { ok: false, error: "Shopee item names can be at most 120 characters." };
  }
  if (title.length > 255) {
    return { ok: false, error: "Item name can be at most 255 characters." };
  }

  const description = (input.description ?? "").trim().slice(0, 3000);
  const imageUrls = (input.imageUrls ?? []).map((u) => u.trim()).filter(Boolean);
  if (imageUrls.length > MAX_LISTING_PHOTOS) {
    return { ok: false, error: `Upload at most ${MAX_LISTING_PHOTOS} photos.` };
  }

  const weightKg =
    input.weightKg === null || input.weightKg === undefined ? DEFAULT_WEIGHT_KG : Number(input.weightKg);
  if (!Number.isFinite(weightKg) || weightKg < 0.01 || weightKg > 50) {
    return { ok: false, error: "Weight must be between 0.01 kg and 50 kg." };
  }

  let dimensionsCm: { length: number; width: number; height: number } | null = null;
  if (input.dimensionsCm) {
    const l = Math.round(input.dimensionsCm.length);
    const w = Math.round(input.dimensionsCm.width);
    const h = Math.round(input.dimensionsCm.height);
    if (
      !Number.isFinite(l) ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      l < 1 ||
      w < 1 ||
      h < 1 ||
      l > 300 ||
      w > 300 ||
      h > 300
    ) {
      return { ok: false, error: "Package dimensions must be between 1 cm and 300 cm." };
    }
    dimensionsCm = { length: l, width: w, height: h };
  }

  const tiers = input.tiers ?? [];
  if (tiers.length > MAX_TIERS) {
    return { ok: false, error: `Use at most ${MAX_TIERS} option groups.` };
  }
  const cleanTiers: TierSpec[] = tiers.map((t) => ({
    name: t.name.trim().replace(/\s+/g, " ").slice(0, 30),
    options: cleanOptions(t.options),
  }));
  for (const t of cleanTiers) {
    if (!t.name || !t.options.length) {
      return { ok: false, error: "Each option group needs a name and at least one choice." };
    }
  }

  if (!input.variants.length) {
    return { ok: false, error: "Add at least one price and stock row." };
  }
  if (input.variants.length > MAX_VARIANTS) {
    return { ok: false, error: `Maximum ${MAX_VARIANTS} variations per item.` };
  }

  const cleanVariants: VariantMatrixRow[] = [];
  for (const v of input.variants) {
    const label = v.label.trim().slice(0, 80) || "One size";
    const price = Number(v.pricePhp);
    if (!Number.isFinite(price) || price < 1 || price > 100_000) {
      return { ok: false, error: `Price for "${label}" must be between ₱1 and ₱100,000.` };
    }
    const stock = Number(v.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100_000) {
      return { ok: false, error: `Stock for "${label}" must be a whole number from 0 to 100,000.` };
    }
    if (cleanTiers.length > 0 && v.tierValues.length !== cleanTiers.length) {
      return { ok: false, error: `Variation "${label}" is missing an option choice.` };
    }
    cleanVariants.push({
      label,
      tierValues: v.tierValues,
      pricePhp: Number(price.toFixed(2)),
      stock,
      skuCode: v.skuCode?.trim().slice(0, 50) || null,
    });
  }

  const seenShops = new Set<string>();
  const cleanTargets: CreateItemShopTargetInput[] = [];
  for (const t of targets) {
    if (seenShops.has(t.shopConnectionId)) continue;
    seenShops.add(t.shopConnectionId);
    const catId = t.categoryId.trim();
    if (!catId) {
      return {
        ok: false,
        error: `Pick a ${t.platform === "SHOPEE" ? "Shopee" : "TikTok"} category before pushing.`,
      };
    }
    if (t.platform === "SHOPEE") {
      const n = Number(catId);
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, error: "Shopee category ID must be a positive number." };
      }
    }
    cleanTargets.push({
      shopConnectionId: t.shopConnectionId,
      platform: t.platform,
      categoryId: catId,
      categoryName: t.categoryName?.trim() || null,
    });
  }

  let unitCostPhp: number | null = null;
  if (input.unitCostPhp !== null && input.unitCostPhp !== undefined) {
    const c = Number(input.unitCostPhp);
    if (!Number.isFinite(c) || c < 0 || c > 100_000) {
      return { ok: false, error: "Unit cost must be between ₱0 and ₱100,000." };
    }
    unitCostPhp = Number(c.toFixed(2));
  }

  let safetyBuffer: number | null = null;
  if (input.safetyBuffer !== null && input.safetyBuffer !== undefined) {
    const b = Number(input.safetyBuffer);
    if (!Number.isInteger(b) || b < 0 || b > 10_000) {
      return { ok: false, error: "Safety buffer must be a whole number from 0 to 10,000." };
    }
    safetyBuffer = b;
  }

  return {
    ok: true,
    value: {
      title,
      description,
      publishMode: input.publishMode === "LIVE" ? "LIVE" : "DRAFT",
      imageUrls,
      weightKg: Number(weightKg.toFixed(3)),
      dimensionsCm,
      unitCostPhp,
      safetyBuffer,
      binLocation: input.binLocation?.trim().slice(0, 40) || null,
      tiers: cleanTiers,
      variants: cleanVariants,
      targets: cleanTargets,
    },
  };
}

/**
 * Available-to-sell quantity pushed to shops for a new item:
 * on-shelf count minus the effective safety buffer, never below 0.
 */
export function computeShopPublishStock(
  onShelf: number,
  garmentSafetyBuffer: number | null | undefined,
  globalSafetyBuffer: number
): number {
  const buf =
    garmentSafetyBuffer === null || garmentSafetyBuffer === undefined
      ? Math.max(0, globalSafetyBuffer)
      : Math.max(0, garmentSafetyBuffer);
  return Math.max(0, Math.floor(onShelf) - buf);
}

/** Escapes plain text and wraps paragraphs in <p>...</p> for TikTok Shop descriptions. */
export function formatPlainTextToTikTokHtml(text: string): string {
  const trimmed = text.trim();
  const safe = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  if (!safe) return "<p></p>";
  const paragraphs = safe.split(/\n{2,}/).map((block) => `<p>${block.replace(/\n/g, "<br/>")}</p>`);
  return paragraphs.join("");
}

/** Deterministic SKU string sent to TikTok / Shopee so created remote SKUs map back cleanly. */
export function deterministicSellerSku(garmentVariantId: string, userSku?: string | null): string {
  const clean = userSku?.trim();
  if (clean) return clean.slice(0, 50);
  return `kyna-${garmentVariantId.slice(-10)}`;
}

/**
 * Matches Shopee `init_tier_variation` response models back to `ListingVariantInput`
 * by exact `tier_index` tuple, falling back to positional index when absent.
 */
export function mapShopeeModelsToVariants<T extends { garmentVariantId: string; tierValues: string[]; pricePhp: number; stock: number; label: string }>(
  variants: T[],
  tiers: TierSpec[],
  returnedModels: Array<{ model_id?: unknown; tier_index?: unknown }>
): Array<{
  garmentVariantId: string;
  variationId: string;
  variationName: string;
  pricePhp: number;
  stock: number;
}> {
  const optionIndices = tiers.map((t) => new Map(t.options.map((opt, idx) => [opt, idx])));
  const byTierKey = new Map<string, string>();
  for (const m of returnedModels) {
    if (m.model_id === undefined || m.model_id === null) continue;
    if (Array.isArray(m.tier_index)) {
      byTierKey.set((m.tier_index as number[]).join(":"), String(m.model_id));
    }
  }

  return variants.map((v, i) => {
    const expectedTuple = v.tierValues
      .map((val, tIdx) => optionIndices[tIdx]?.get(val) ?? -1)
      .join(":");
    const matchedId =
      byTierKey.get(expectedTuple) ??
      (returnedModels[i]?.model_id !== undefined && returnedModels[i]?.model_id !== null
        ? String(returnedModels[i].model_id)
        : "");
    return {
      garmentVariantId: v.garmentVariantId,
      variationId: matchedId,
      variationName: v.label,
      pricePhp: v.pricePhp,
      stock: v.stock,
    };
  });
}

/**
 * Matches TikTok `POST /product/202309/products` response SKUs back to
 * `ListingVariantInput` by `seller_sku`, falling back to positional order.
 */
export function mapTikTokSkusToVariants<
  T extends { garmentVariantId: string; skuCode?: string | null; pricePhp: number; stock: number; label: string; tierValues: string[] },
>(
  variants: T[],
  returnedSkus: Array<{ id?: unknown; sku_id?: unknown; seller_sku?: unknown }>,
  warehouseId: string | null
): Array<{
  garmentVariantId: string;
  variationId: string;
  variationName: string | null;
  warehouseId: string | null;
  pricePhp: number;
  stock: number;
}> {
  const bySellerSku = new Map<string, string>();
  for (const s of returnedSkus) {
    const id = s.id ?? s.sku_id;
    if (!id) continue;
    if (typeof s.seller_sku === "string" && s.seller_sku.trim()) {
      bySellerSku.set(s.seller_sku.trim(), String(id));
    }
  }

  return variants.map((v, i) => {
    const expectedSku = deterministicSellerSku(v.garmentVariantId, v.skuCode);
    const fallback = returnedSkus[i]?.id ?? returnedSkus[i]?.sku_id;
    const variationId = bySellerSku.get(expectedSku) ?? (fallback ? String(fallback) : "");
    return {
      garmentVariantId: v.garmentVariantId,
      variationId,
      variationName: v.tierValues.length > 0 ? v.label : null,
      warehouseId,
      pricePhp: v.pricePhp,
      stock: v.stock,
    };
  });
}

/**
 * Flattens a Shopee or TikTok category tree into leaf `CategoryOption`s with
 * `Parent > Child > Leaf` breadcrumb paths, safely guarding against cycles.
 */
export function buildCategoryBreadcrumbs(nodes: CategoryNodeInput[]): CategoryOption[] {
  const byId = new Map<string, CategoryNodeInput>();
  for (const n of nodes) {
    if (n.id) byId.set(n.id, n);
  }

  const pathFor = (id: string): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: CategoryNodeInput | undefined = byId.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.name.trim()) parts.unshift(cur.name.trim());
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" > ");
  };

  return nodes
    .filter((n) => n.isLeaf && n.id && n.name.trim())
    .map((n) => ({
      id: n.id,
      name: n.name.trim(),
      path: pathFor(n.id) || n.name.trim(),
      isLeaf: true,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Extracts paired Shopee + TikTok category presets from already-linked garments,
 * plus recent single-shop categories for quick 1-tap selection.
 */
export function deriveCategoryPresets(
  garments: Array<{
    products: Array<{
      platform: ShopPlatform;
      categoryId: string | null;
      categoryName: string | null;
    }>;
  }>
): {
  presets: CategoryPreset[];
  recentByPlatform: { SHOPEE: CategoryChip[]; TIKTOK: CategoryChip[] };
} {
  const presetMap = new Map<string, CategoryPreset>();
  const shopeeMap = new Map<string, CategoryChip>();
  const tiktokMap = new Map<string, CategoryChip>();

  for (const g of garments) {
    let sp: { categoryId: string; categoryName: string | null } | null = null;
    let tt: { categoryId: string; categoryName: string | null } | null = null;

    for (const p of g.products) {
      const catId = p.categoryId?.trim();
      if (!catId) continue;
      if (p.platform === "SHOPEE") {
        if (!sp) sp = { categoryId: catId, categoryName: p.categoryName };
        const cur = shopeeMap.get(catId);
        if (cur) cur.count += 1;
        else shopeeMap.set(catId, { categoryId: catId, categoryName: p.categoryName, count: 1 });
      } else {
        if (!tt) tt = { categoryId: catId, categoryName: p.categoryName };
        const cur = tiktokMap.get(catId);
        if (cur) cur.count += 1;
        else tiktokMap.set(catId, { categoryId: catId, categoryName: p.categoryName, count: 1 });
      }
    }

    if (sp && tt) {
      const key = `${sp.categoryId}|${tt.categoryId}`;
      const existing = presetMap.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.shopeeCategoryName && sp.categoryName) existing.shopeeCategoryName = sp.categoryName;
        if (!existing.tiktokCategoryName && tt.categoryName) existing.tiktokCategoryName = tt.categoryName;
      } else {
        presetMap.set(key, {
          key,
          label: tt.categoryName || sp.categoryName || `Shopee ${sp.categoryId} + TikTok ${tt.categoryId}`,
          shopeeCategoryId: sp.categoryId,
          shopeeCategoryName: sp.categoryName,
          tiktokCategoryId: tt.categoryId,
          tiktokCategoryName: tt.categoryName,
          count: 1,
        });
      }
    }
  }

  return {
    presets: [...presetMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    recentByPlatform: {
      SHOPEE: [...shopeeMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      TIKTOK: [...tiktokMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    },
  };
}
