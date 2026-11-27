import { prisma } from "@/lib/prisma";
import type { AiTopic } from "./settings";

/**
 * Product facts from the shop's own TikTok listing, for the Chats assistant:
 * fabric, sizes with their ranges, colors, price and stock. Fetched live when a
 * reply is written (stock changes fast during lives), with a short cache, and
 * the last stock import as a fallback.
 *
 * Only product facts go to the AI. Shipping, returns and payment come from the
 * owner's shop answers, so listing lines about them are left out.
 */

export type StockWord = "available" | "few left" | "sold out";

export interface ListingSku {
  color: string | null;
  size: string | null;
  pricePhp: number | null;
  stock: number | null;
}

export interface ListingFacts {
  productId: string;
  title: string;
  /** "Material: Jacquard", "Fit: A-line"… */
  attributes: string[];
  /** Product lines from the description, without policy or sales talk. */
  description: string;
  skus: ListingSku[];
  /** "live" = read from TikTok just now; "stored" = from the last stock import (up to 6 hours old). */
  source: "live" | "stored";
}

export interface CatalogItem {
  productId: string;
  title: string;
  category: string | null;
  /** Cleaned product description (optional; used for keyword-matched snippets). */
  description?: string;
}

/** Owner's rule: 10+ available, 1–9 few left, 0 sold out. Exact counts never reach the AI. */
export function stockWord(n: number | null): StockWord | null {
  if (n === null || !Number.isFinite(n)) return null;
  if (n <= 0) return "sold out";
  return n < 10 ? "few left" : "available";
}

const DESCRIPTION_CHARS = 900;
const CATALOG_CHARS = 1400;
const CATALOG_MAX_ITEMS = 30;
const CATALOG_TITLE_CHARS = 90;
const CATALOG_SNIPPET_MAX_ITEMS = 3;
const CATALOG_SNIPPET_CHARS = 220;

// Lines about policies or selling, not the product. Shop answers own these topics.
const NOT_PRODUCT =
  /\b(ship|shipping|deliver|delivery|receive|arrive|days?|araw|cod|cash on delivery|refund|return|exchange|report|contact us|message us|lowest price|best price|best value|purchas\w*|guarantee|assure|order now|order today|add to cart|check ?out|sale|promo|discount|voucher|free\s+(shipping|gift|item)|freebies?|onhand|on hand|ready to ship|high quality|quality product|compromising|concerns?)\b/i;

// Size guide and measurement lines often sit at the bottom of long descriptions; keep them when trimming.
const MEASUREMENT_LINE =
  /\b(size\s*guide|size\s*options?|sizing|waist|waistline|bust|hips?|length|haba|inches|inch|\bcm\b|fits?\s+(?:up\s+to|[smlx2-5])|one\s*size|free\s*size|small|medium|large|xl|2xl|3xl|4xl)\b/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** HTML description → the product lines only, trimmed. */
export function cleanDescription(html: string): string {
  const text = decodeEntities(
    html
      .replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
  // Listings often wrap mid-sentence; join a line to the one before when it
  // continues it (lowercase start, previous line without an ending).
  const joined: string[] = [];
  for (const raw of text.split(/\n+/)) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (!l) continue;
    const prev = joined[joined.length - 1];
    if (prev && !/[.!?:)]$/.test(prev) && /^[a-z(]/.test(l)) joined[joined.length - 1] = `${prev} ${l}`;
    else joined.push(l);
  }
  // Drop whole sentences about shipping, policies or selling.
  const lines = joined
    .map((l) =>
      l
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !NOT_PRODUCT.test(s))
        .join(" ")
        .trim()
    )
    .filter((l) => l.length > 1 && !/^[\p{Extended_Pictographic}\p{P}\s]+$/u.test(l));
  const out: string[] = [];
  let used = 0;
  let cutAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (used + l.length > DESCRIPTION_CHARS) {
      cutAt = i;
      break;
    }
    out.push(l);
    used += l.length + 1;
  }
  // If a long description was cut off before its size guide / length section,
  // pull those measurement lines into the tail of the budget.
  if (cutAt < lines.length) {
    const tail = lines.slice(cutAt).filter((l) => MEASUREMENT_LINE.test(l));
    if (tail.length) {
      const tailText = tail.join("\n").slice(0, Math.floor(DESCRIPTION_CHARS * 0.45));
      const headBudget = DESCRIPTION_CHARS - tailText.length - 1;
      while (out.length > 0 && out.join("\n").length > headBudget) out.pop();
      out.push(tailText);
    }
  }
  return out.join("\n");
}

type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One sales attribute by name, with "size|colour" style names handled. */
function attr(attrs: Raw[], kind: "color" | "size"): string | null {
  const name = (a: Raw) => String(a.name ?? "");
  const isColor = (a: Raw) => /colou?r|kulay|print|design|style/i.test(name(a));
  const isSize = (a: Raw) => /size|sukat/i.test(name(a)) && !isColor(a);
  const hit = attrs.find(kind === "color" ? isColor : isSize);
  return text(hit?.value_name);
}

/** TikTok Get Product (/product/202309/products/{id}) → listing facts. Pure. */
export function mapTikTokListing(p: Raw, source: ListingFacts["source"] = "live"): ListingFacts {
  const attributes = arr(p.product_attributes)
    .map((a) => {
      const name = text(a.name);
      const values = arr(a.values).map((v) => text(v.name)).filter(Boolean);
      return name && values.length ? `${name}: ${values.join("/")}` : null;
    })
    .filter((a): a is string => Boolean(a));
  const skus = arr(p.skus).map((s) => {
    const attrs = arr(s.sales_attributes);
    const price = Number((s.price as Raw | undefined)?.sale_price ?? (s.price as Raw | undefined)?.tax_exclusive_price);
    const inventory = arr(s.inventory);
    return {
      color: attr(attrs, "color") ?? (attrs.length > 1 ? text(attrs[0].value_name) : null),
      size: attr(attrs, "size") ?? (attrs.length === 1 ? null : text(attrs[attrs.length - 1]?.value_name)),
      pricePhp: Number.isFinite(price) && price > 0 ? price : null,
      stock: inventory.length ? inventory.reduce((n, i) => n + (Number(i.quantity) || 0), 0) : null,
    };
  });
  return {
    productId: String(p.id),
    title: String(p.title ?? "Item"),
    attributes,
    description: cleanDescription(String(p.description ?? "")),
    skus,
    source,
  };
}

function peso(n: number): string {
  return `₱${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/**
 * The listing as plain lines for the prompt: one line per color with each
 * size and its stock word, so the AI can answer "may L pa sa black?".
 * Large multi-SKU listings (>8 colors) collapse uniform stock words per color
 * and group colors with identical size/stock patterns to save prompt tokens
 * without losing any color, size range, price or stock word.
 */
export function listingBlock(l: ListingFacts): string {
  const lines = [`"${l.title.slice(0, 160)}"`];
  if (l.attributes.length) lines.push(`Details: ${l.attributes.join("; ")}`);
  if (l.description) lines.push(`From the listing:\n${l.description}`);

  const prices = [...new Set(l.skus.map((s) => s.pricePhp).filter((p): p is number => p !== null))];
  if (prices.length === 1) lines.push(`Price: ${peso(prices[0])} for every color and size`);

  const byColor = new Map<string, ListingSku[]>();
  for (const s of l.skus) {
    const color = s.color ?? "One color";
    byColor.set(color, [...(byColor.get(color) ?? []), s]);
  }
  const when = l.source === "live" ? "checked just now" : "from the last stock check, a few hours ago";
  lines.push(`Colors and sizes (stock ${when}):`);

  const compact = byColor.size > 8;
  const formatRow = (skus: ListingSku[]): string => {
    const words = skus.map((s) => stockWord(s.stock));
    const singlePrice = prices.length <= 1;
    const firstWord = words[0];
    if (compact && singlePrice && skus.length >= 2 && firstWord && words.every((w) => w === firstWord)) {
      const sizes = skus.map((s) => s.size ?? "One size").join(", ");
      return `${sizes} — all ${firstWord}`;
    }
    return skus
      .map((s, idx) => {
        const word = words[idx];
        const price = !singlePrice && s.pricePhp !== null ? ` ${peso(s.pricePhp)}` : "";
        return `${s.size ?? "One size"}${price}${word ? `: ${word}` : ""}`;
      })
      .join(", ");
  };

  if (compact) {
    // Group colors that share the exact same formatted sizes & stock pattern.
    const groups = new Map<string, string[]>();
    let counted = 0;
    for (const [color, skus] of byColor) {
      if (counted >= 30) break;
      const spec = formatRow(skus);
      groups.set(spec, [...(groups.get(spec) ?? []), color]);
      counted++;
    }
    for (const [spec, colors] of groups) {
      lines.push(`- ${colors.join(" / ")}: ${spec}`);
    }
    if (byColor.size > 30) lines.push(`…and ${byColor.size - 30} more colors`);
    return lines.join("\n");
  }

  let shown = 0;
  for (const [color, skus] of byColor) {
    if (shown >= 30) {
      lines.push(`…and ${byColor.size - shown} more colors`);
      break;
    }
    lines.push(`- ${color}: ${formatRow(skus)}`);
    shown++;
  }
  return lines.join("\n");
}

// Questions asking if the shop carries another item, style or length (even when a product card is attached).
const CATALOG_ASK =
  /\b(wala\s+(po\s+)?ba(ng)?|meron\s+(po\s+)?ba(ng)?|may\s+(iba|ibang|mas\s+mahaba|mas\s+maikli|long|midi|maxi|mini|blazer|dress|blouse|shorts|terno|palda|skirt|skort|top|pang-?lalak|panlalak)|ibang\s+(style|design|haba|length|item|palda|skirt|blouse|shorts)|hanggang\s+(binti|tuhod|ankle|sakong)|do\s+you\s+(have|carry|sell)\s+(any|a|other|longer|shorter))\b/i;

const CATALOG_TOPICS = new Set<AiTopic>(["product", "size", "stock", "other"]);

/**
 * Smart gate: include SHOP CATALOG only when the chat has no attached product
 * listing on a product/size/stock/other question, OR when the buyer asks if
 * the shop carries another item/style/length. Skips order/shipping/cod/returns
 * and single-item chats to protect peak token budgets.
 */
export function shouldIncludeCatalog(opts: {
  topics: AiTopic[];
  hasListings: boolean;
  buyerText: string;
}): boolean {
  if (CATALOG_ASK.test(opts.buyerText)) return true;
  if (opts.hasListings) return false;
  return opts.topics.some((t) => CATALOG_TOPICS.has(t));
}

const SYNONYMS: Record<string, string[]> = {
  palda: ["skirt", "skort", "palda"],
  skirt: ["skirt", "skort", "palda"],
  skirts: ["skirt", "skort", "palda"],
  skort: ["skort", "skirt", "palda"],
  skorts: ["skort", "skirt", "palda"],
  binti: ["long", "midi", "maxi", "length", "mini", "skirt", "palda"],
  tuhod: ["long", "midi", "length", "mini", "skirt", "palda"],
  haba: ["length", "long", "mini", "midi", "maxi"],
  mahaba: ["long", "length", "maxi", "midi"],
  length: ["length", "long", "mini", "midi"],
  blouse: ["blouse", "top", "shirt"],
  top: ["top", "blouse", "shirt", "t-shirt"],
  damit: ["blouse", "top", "dress", "shirt"],
  dress: ["dress"],
  bestida: ["dress"],
  shorts: ["shorts", "short", "tokong", "skort"],
  short: ["shorts", "short", "skort"],
  tokong: ["tokong", "shorts"],
  terno: ["terno", "set", "coords"],
  coords: ["coords", "set", "terno"],
  set: ["set", "coords", "terno"],
  bulsa: ["pocket"],
  pocket: ["pocket"],
  pockets: ["pocket"],
  tela: ["fabric", "cotton", "corduroy", "jacquard", "knitted", "ribbed", "embossed"],
  fabric: ["fabric", "cotton", "corduroy", "jacquard", "knitted", "ribbed", "embossed"],
  makapal: ["makapal", "corduroy", "embossed", "jacquard"],
  manipis: ["lightweight", "fabric"],
  slit: ["slit"],
  inner: ["inner"],
  garter: ["garter", "elastic"],
  stretch: ["stretch", "stretchable", "ribbed", "knitted"],
  stretchy: ["stretch", "stretchable", "ribbed", "knitted"],
  stretchable: ["stretch", "stretchable", "ribbed", "knitted"],
  plus: ["plus", "2xl", "3xl", "4xl"],
};

const QUERY_STOP = new Set([
  "po", "ba", "ang", "ng", "na", "sa", "nito", "ito", "yan", "iyan", "yung", "ung", "may", "meron", "wala", "bang", "kayo",
  "nyo", "niyo", "seller", "ate", "kuya", "hi", "hello", "the", "this", "that", "for", "with", "you", "have", "any", "are",
  "how", "what", "when", "where", "pwede", "pwd", "lang", "din", "rin", "naman", "kasi", "para", "ako", "ko", "my", "is",
  "hanggang", "gaano", "ano", "anong", "alin", "mga",
]);

function queryTerms(buyerText: string): string[] {
  const raw = buyerText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !QUERY_STOP.has(w));
  const out = new Set<string>();
  for (const w of raw) {
    out.add(w);
    const syns = SYNONYMS[w];
    if (syns) for (const s of syns) out.add(s);
  }
  return [...out];
}

/** Compact single-line snippet of a cleaned description, keeping first line + measurement/length lines. */
function descriptionSnippet(cleaned: string, maxChars = CATALOG_SNIPPET_CHARS): string {
  const lines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const measure = lines.filter((l) => MEASUREMENT_LINE.test(l));
  const picked: string[] = [];
  let used = 0;
  const add = (l: string) => {
    if (picked.includes(l)) return;
    const sep = picked.length ? "; " : "";
    if (used + sep.length + l.length <= maxChars) {
      picked.push(l);
      used += sep.length + l.length;
    } else if (picked.length === 0) {
      picked.push(`${l.slice(0, maxChars - 1)}…`);
      used = maxChars;
    }
  };
  // Always include measurement/length lines first if space is tight, paired with the opening product line.
  add(lines[0].length > 110 && measure.length ? `${lines[0].slice(0, 109)}…` : lines[0]);
  for (const m of measure) add(m);
  for (const l of lines.slice(1)) {
    if (used >= maxChars) break;
    add(l);
  }
  return picked.join("; ");
}

/**
 * Compact 1-line-per-product overview of the shop's active catalog (~350-450
 * tokens max). When `buyerText` matches specific products (e.g. "palda",
 * "dress", "blouse"), attaches short cleaned description snippets (fabric,
 * style, length) for the top matches so the AI can answer without a card. Pure.
 */
export function catalogBlock(items: CatalogItem[] | undefined, buyerText = ""): string {
  if (!items?.length) return "";
  const terms = buyerText ? queryTerms(buyerText) : [];
  const scored = items
    .map((item, idx) => {
      if (!terms.length) return { item, idx, score: 0 };
      const hay = `${item.title} ${item.category ?? ""} ${item.description ?? ""}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score++;
      }
      return { item, idx, score };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  let snippets = 0;
  for (const { item, score } of scored) {
    if (shown >= CATALOG_MAX_ITEMS) break;
    const title = item.title.replace(/\s+/g, " ").trim();
    if (!title) continue;
    const clipped = title.length > CATALOG_TITLE_CHARS ? `${title.slice(0, CATALOG_TITLE_CHARS - 1)}…` : title;
    const cat = item.category?.replace(/\s+/g, " ").trim();
    let line = cat ? `- [${cat}] ${clipped}` : `- ${clipped}`;
    if (score > 0 && snippets < CATALOG_SNIPPET_MAX_ITEMS && item.description) {
      const snip = descriptionSnippet(item.description);
      if (snip) {
        line = `${line} — ${snip}`;
        snippets++;
      }
    }
    if (used + line.length > CATALOG_CHARS) {
      // If a snippet pushed us over the cap, retry with just the title line.
      const plain = cat ? `- [${cat}] ${clipped}` : `- ${clipped}`;
      if (used + plain.length > CATALOG_CHARS) break;
      lines.push(plain);
      used += plain.length + 1;
    } else {
      lines.push(line);
      used += line.length + 1;
    }
    shown++;
  }
  return lines.join("\n");
}

// ---- Fetching ---------------------------------------------------------------

const CACHE_MS = 5 * 60_000;
const LIVE_TIMEOUT_MS = 6_000;
const cache = new Map<string, { at: number; facts: ListingFacts }>();
const catalogCache = new Map<string, { at: number; items: CatalogItem[] }>();

const INACTIVE_STATUSES = new Set(["DELETED", "DEACTIVATED", "INACTIVE", "UNLIST", "DRAFT", "SELLER_DEACTIVATED", "PLATFORM_DEACTIVATED", "FREEZE"]);

export type ListingFetcher = (productId: string) => Promise<Raw | null>;

/** Stored listing rows + ChannelProduct metadata (last stock import) when TikTok can't be reached. */
async function storedListing(shopConnectionId: string, productId: string): Promise<ListingFacts | null> {
  const [rows, cp] = await Promise.all([
    prisma.listingVariant.findMany({
      where: { shopConnectionId, listingId: productId },
      select: { name: true, variationName: true, availableStock: true, pricePhp: true },
    }),
    prisma.channelProduct?.findUnique
      ? prisma.channelProduct
          .findUnique({
            where: { shopConnectionId_listingId: { shopConnectionId, listingId: productId } },
            select: { title: true, description: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!rows.length && !cp) return null;
  return {
    productId,
    title: cp?.title ?? rows[0]?.name ?? "Item",
    attributes: [],
    description: cp?.description ? cleanDescription(cp.description) : "",
    skus: rows.map((r) => {
      const [color, ...rest] = (r.variationName ?? "").split(", ");
      const price = r.pricePhp !== null && r.pricePhp !== undefined ? Number(r.pricePhp) : null;
      return {
        color: color || null,
        size: rest.join(", ") || null,
        pricePhp: price !== null && Number.isFinite(price) && price > 0 ? price : null,
        stock: r.availableStock,
      };
    }),
    source: "stored",
  };
}

/** Active products stored in ChannelProduct for one shop (cached 5 minutes, zero platform API calls). */
export async function getShopCatalog(shopConnectionId: string, now = Date.now()): Promise<CatalogItem[]> {
  const hit = catalogCache.get(shopConnectionId);
  if (hit && now - hit.at < CACHE_MS) return hit.items;
  if (!prisma.channelProduct?.findMany) return [];
  try {
    const rows = await prisma.channelProduct.findMany({
      where: { shopConnectionId },
      orderBy: [{ syncedAt: "desc" }, { title: "asc" }],
      take: CATALOG_MAX_ITEMS + 10,
      select: { listingId: true, title: true, categoryName: true, status: true, description: true },
    });
    const items: CatalogItem[] = rows
      .filter((r) => !r.status || !INACTIVE_STATUSES.has(r.status.toUpperCase()))
      .slice(0, CATALOG_MAX_ITEMS)
      .map((r) => ({
        productId: r.listingId,
        title: r.title,
        category: r.categoryName,
        description: r.description ? cleanDescription(r.description) : undefined,
      }));
    catalogCache.set(shopConnectionId, { at: now, items });
    return items;
  } catch (err) {
    console.error("[assistant] catalog", shopConnectionId, err instanceof Error ? err.message : err);
    return [];
  }
}

/** Live from TikTok (cached 5 minutes), else the stored copy. Never throws. */
export async function getListingFacts(opts: {
  shopConnectionId: string;
  productId: string;
  fetcher: ListingFetcher | null;
  now?: number;
}): Promise<ListingFacts | null> {
  const now = opts.now ?? Date.now();
  const key = `${opts.shopConnectionId}:${opts.productId}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.facts;
  if (opts.fetcher) {
    try {
      const raw = await Promise.race([
        opts.fetcher(opts.productId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), LIVE_TIMEOUT_MS)),
      ]);
      if (raw && raw.id) {
        const facts = mapTikTokListing(raw, "live");
        cache.set(key, { at: now, facts });
        return facts;
      }
    } catch (err) {
      console.error("[assistant] listing", opts.productId, err instanceof Error ? err.message : err);
    }
  }
  return storedListing(opts.shopConnectionId, opts.productId).catch(() => null);
}

/** For tests. */
export function clearListingCache() {
  cache.clear();
  catalogCache.clear();
}

/**
 * Which listings a chat is about, newest first, at most `max`: product cards
 * the buyer shared (by product id, or by name for older cards), then the items
 * in the chat's order.
 */
export async function listingIdsForChat(opts: {
  shopConnectionId: string;
  cards: Array<{ productId?: string | null; itemName: string }>;
  orderSn: string | null;
  max?: number;
}): Promise<string[]> {
  const max = opts.max ?? 2;
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !ids.includes(id) && ids.length < max) ids.push(id);
  };
  const named = opts.cards.filter((c) => !c.productId && c.itemName && c.itemName !== "Product").map((c) => c.itemName);
  const byName = named.length
    ? await prisma.listingVariant.findMany({
        where: { shopConnectionId: opts.shopConnectionId, name: { in: named } },
        select: { listingId: true, name: true },
        distinct: ["listingId"],
      })
    : [];
  for (const c of [...opts.cards].reverse()) add(c.productId ?? byName.find((b) => b.name === c.itemName)?.listingId);
  if (opts.orderSn && ids.length < max) {
    const lines = await prisma.orderLine.findMany({
      where: { order: { orderSn: opts.orderSn, shopConnectionId: opts.shopConnectionId } },
      select: { listingId: true },
    });
    for (const l of lines) add(l.listingId);
  }
  return ids;
}
