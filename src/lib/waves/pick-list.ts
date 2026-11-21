export interface ParsedPickItem {
  garmentName: string;
  shortGarmentName: string;
  variation: string | null;
  color: string | null;
  size: string | null;
}

export interface PickVariantItem {
  label: string;
  variation: string | null;
  color: string | null;
  size: string | null;
  qty: number;
}

export interface PickGarmentGroup {
  key: string;
  shortName: string;
  fullName: string;
  totalQty: number;
  variants: PickVariantItem[];
}

export interface WaveParcelLine {
  id: string;
  key: string;
  /** Canonical pick-list label ("Garment - Variant" or "Listing - Variation") */
  label: string;
  name: string;
  shortName: string;
  variationName: string | null;
  color: string | null;
  size: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePhp: number;
}

export interface WaveParcel {
  id: string;
  packageId: string;
  orderId: string;
  orderSn: string;
  platform: "SHOPEE" | "TIKTOK";
  shopName: string;
  groupKey: string;
  /** 1-based print / packing position in the wave */
  position: number;
  totalInWave: number;
  status: string;
  orderStatus: string;
  error: string | null;
  courier: string;
  trackingNumber: string | null;
  packageNumber: string;
  isCod: boolean;
  totalPhp: number;
  createdAt: string;
  shippedAt: string | null;
  totalPieces: number;
  lines: WaveParcelLine[];
}

const LEADING_PREFIX_RE = /^(?:kyna\s+ph|kyna|women['’]?s|womens|ladies['’]?|ladies)\s+/i;
const BRAND_ONLY_RE = /^(?:kyna(?:\s+ph)?|women['’]?s|womens|ladies['’]?|ladies)$/i;
const TRAILING_SEO_RE =
  /^(.{3,}?)\s+(?:for\s+(?:women|ladies)\b|with\s+inner\s+short\b|with\s+elastic\s+waist\b|high[\s-]+waist\b|comfortable\s+and\b|machine\s+washable\b|trendy\s+and\b).*$/i;
const SIZE_TOKEN_RE =
  /\b(xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl|small|medium|large|free\s*size|one\s*size|freesize|onesize|fs)\b/i;
const MARKETING_KEYWORDS_RE =
  /\b(daily\s*wear|casual|trendy|comfortable|comfy|perfect\s*for|women|womens|ladies|short\s*sleeve|round\s*neck|high[\s-]+waist|machine\s*washable|elastic\s*waist|summer\s*wear|bottoms|inspired|basic\s*style|sleeveless)\b/i;

function stripLeadingPrefixes(text: string): string {
  let out = text.trim();
  while (LEADING_PREFIX_RE.test(out)) {
    const next = out.replace(LEADING_PREFIX_RE, "").trim();
    if (next.length < 3) break;
    out = next;
  }
  return out;
}

function isMarketingClause(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return true;
  if (/\d/.test(trimmed) || SIZE_TOKEN_RE.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 7) return true;
  if (words.length >= 4 && MARKETING_KEYWORDS_RE.test(trimmed)) return true;
  return false;
}

function isShortVariationQualifier(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed || trimmed.length > 20) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;
  return !MARKETING_KEYWORDS_RE.test(trimmed) && !isMarketingClause(trimmed);
}

/**
 * Strips marketplace promo tags, brand prefixes, and SEO keyword stuffing
 * from a garment title so warehouse pickers can read the style at a glance.
 */
export function shortenGarmentName(rawName: string): string {
  const original = rawName.trim();
  if (!original) return "";

  let s = original
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\b(cod|ready\s*stock|sale|promo|new|free\s*shipping)\b[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const subMatch = s.match(/\s[-–|]\s/);
  if (subMatch && subMatch.index !== undefined) {
    const prefix = s.slice(0, subMatch.index).trim();
    const rest = s.slice(subMatch.index + subMatch[0].length).trim();
    const cleanPrefix = stripLeadingPrefixes(prefix);
    if (cleanPrefix.length >= 3 && !BRAND_ONLY_RE.test(cleanPrefix)) {
      s = prefix;
    } else if (rest.length >= 3) {
      s = rest;
    }
  }

  s = stripLeadingPrefixes(s);
  s = s.replace(/\bkorean\s+inspired\b/gi, " ").replace(/\s+/g, " ").trim();

  const seoMatch = s.match(TRAILING_SEO_RE);
  if (seoMatch && seoMatch[1].trim().length >= 3) {
    s = seoMatch[1].trim();
  }

  s = s.replace(/^(.{3,}?)\s+summer$/i, "$1").trim();
  s = s.replace(/[\s\-–|,]+$/g, "").trim();

  return s.length >= 3 ? s : original;
}

/**
 * Splits a pick-list item label ("Name - Color, Size") into its garment name,
 * shortened garment name, and colour/size components.
 */
export function parsePickItemLabel(label: string): ParsedPickItem {
  const trimmed = label.trim();
  const parts = trimmed.split(/\s+-\s+/);

  let garmentName = trimmed;
  let variation: string | null = null;

  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    if (last && !isMarketingClause(last)) {
      if (parts.length >= 3 && isShortVariationQualifier(parts[parts.length - 2])) {
        variation = `${parts[parts.length - 2].trim()} - ${last}`;
        garmentName = parts.slice(0, -2).join(" - ").trim();
      } else {
        variation = last;
        garmentName = parts.slice(0, -1).join(" - ").trim();
      }
    }
  }

  if (!garmentName) {
    garmentName = trimmed;
    variation = null;
  }

  let color: string | null = null;
  let size: string | null = null;
  if (variation) {
    const commaIdx = variation.lastIndexOf(",");
    if (commaIdx !== -1) {
      const left = variation.slice(0, commaIdx).trim();
      const right = variation.slice(commaIdx + 1).trim();
      color = left || null;
      size = right || null;
      if (!color && size) {
        color = size;
        size = null;
      }
    } else {
      color = variation;
    }
  }

  return {
    garmentName,
    shortGarmentName: shortenGarmentName(garmentName),
    variation,
    color,
    size,
  };
}

/**
 * Groups flat pick-list items under their parent garment (preserving first-
 * appearance order) so long listing titles appear once per style.
 */
export function groupPickItems(items: Array<{ label: string; qty: number }>): PickGarmentGroup[] {
  const groups: PickGarmentGroup[] = [];
  const byKey = new Map<string, PickGarmentGroup>();

  for (const item of items) {
    const parsed = parsePickItemLabel(item.label);
    const key = (parsed.shortGarmentName || item.label).toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        shortName: parsed.shortGarmentName || parsed.garmentName,
        fullName: parsed.garmentName,
        totalQty: 0,
        variants: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.totalQty += item.qty;
    group.variants.push({
      label: item.label,
      variation: parsed.variation,
      color: parsed.color,
      size: parsed.size,
      qty: item.qty,
    });
  }

  return groups;
}

function normalizedPickIdentity(label: string): string {
  const parsed = parsePickItemLabel(label);
  return `${parsed.shortGarmentName.toLowerCase()}::${(parsed.variation ?? "").toLowerCase()}`;
}

/**
 * Finds all parcels within a shop/courier group that contain a given pick-list
 * variant label, preserving ascending print/packing position order.
 */
export function matchParcelsForVariant(
  parcels: WaveParcel[],
  groupKey: string,
  variantLabel: string
): WaveParcel[] {
  const inGroup = parcels.filter((p) => p.groupKey === groupKey);
  const exact = inGroup.filter((p) => p.lines.some((l) => l.label === variantLabel));
  if (exact.length > 0) {
    return exact.sort((a, b) => a.position - b.position);
  }
  const targetIdentity = normalizedPickIdentity(variantLabel);
  return inGroup
    .filter((p) => p.lines.some((l) => normalizedPickIdentity(l.label) === targetIdentity))
    .sort((a, b) => a.position - b.position);
}
