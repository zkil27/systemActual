import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

/** Owner's rule: 10+ available, 1–9 few left, 0 sold out. Exact counts never reach the AI. */
export function stockWord(n: number | null): StockWord | null {
  if (n === null || !Number.isFinite(n)) return null;
  if (n <= 0) return "sold out";
  return n < 10 ? "few left" : "available";
}

const DESCRIPTION_CHARS = 900;

// Lines about policies or selling, not the product. Shop answers own these topics.
const NOT_PRODUCT =
  /\b(ship|shipping|deliver|delivery|receive|arrive|days?|araw|cod|cash on delivery|refund|return|exchange|report|contact us|message us|lowest price|best price|best value|purchas\w*|guarantee|assure|order now|order today|add to cart|check ?out|sale|promo|discount|voucher|free\s+(shipping|gift|item)|freebies?|onhand|on hand|ready to ship|high quality|quality product|compromising|concerns?)\b/i;

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
  for (const l of lines) {
    if (used + l.length > DESCRIPTION_CHARS) break;
    out.push(l);
    used += l.length + 1;
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
 */
export function listingBlock(l: ListingFacts): string {
  const lines = [`"${l.title.slice(0, 160)}"`];
  if (l.attributes.length) lines.push(`Details: ${l.attributes.join("; ")}`);
  if (l.description) lines.push(`From the listing:\n${l.description}`);

  const prices = [...new Set(l.skus.map((s) => s.pricePhp).filter((p): p is number => p !== null))];
  if (prices.length === 1) lines.push(`Price: ${peso(prices[0])} for every color and size`);

  const byColor = new Map<string, string[]>();
  for (const s of l.skus) {
    const color = s.color ?? "One color";
    const word = stockWord(s.stock);
    const price = prices.length > 1 && s.pricePhp !== null ? ` ${peso(s.pricePhp)}` : "";
    const part = `${s.size ?? "One size"}${price}${word ? `: ${word}` : ""}`;
    byColor.set(color, [...(byColor.get(color) ?? []), part]);
  }
  const when = l.source === "live" ? "checked just now" : "from the last stock check, a few hours ago";
  lines.push(`Colors and sizes (stock ${when}):`);
  let shown = 0;
  for (const [color, parts] of byColor) {
    if (shown >= 30) {
      lines.push(`…and ${byColor.size - shown} more colors`);
      break;
    }
    lines.push(`- ${color}: ${parts.join(", ")}`);
    shown++;
  }
  return lines.join("\n");
}

// ---- Fetching ---------------------------------------------------------------

const CACHE_MS = 5 * 60_000;
const LIVE_TIMEOUT_MS = 6_000;
const cache = new Map<string, { at: number; facts: ListingFacts }>();

export type ListingFetcher = (productId: string) => Promise<Raw | null>;

/** Stored listing rows (last stock import) when TikTok can't be reached. */
async function storedListing(shopConnectionId: string, productId: string): Promise<ListingFacts | null> {
  const rows = await prisma.listingVariant.findMany({
    where: { shopConnectionId, listingId: productId },
    select: { name: true, variationName: true, availableStock: true },
  });
  if (!rows.length) return null;
  return {
    productId,
    title: rows[0].name,
    attributes: [],
    description: "",
    skus: rows.map((r) => {
      const [color, ...rest] = (r.variationName ?? "").split(", ");
      return { color: color || null, size: rest.join(", ") || null, pricePhp: null, stock: r.availableStock };
    }),
    source: "stored",
  };
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
      where: { order: { orderSn: opts.orderSn, platform: Platform.TIKTOK } },
      select: { listingId: true },
    });
    for (const l of lines) add(l.listingId);
  }
  return ids;
}
