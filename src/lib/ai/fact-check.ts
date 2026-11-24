import type { ListingFacts } from "./listing";

/**
 * Checks that compare an AI reply with the facts it was given: the size it
 * names against the listing's size ranges and the buyer's measurement, the
 * order status it states against the real order, and promises that an order
 * arrives in time. Pure; output-check.ts calls these.
 */

// "hindi po namin masisiguro", "we can't guarantee", "cannot promise": the reply declines to promise.
const NO_CERTAINTY =
  /\b(hindi|di|not|can'?t|cannot|unable\s+to)\s+(po\s+)?(namin\s+|kami\s+|ko\s+)?(po\s+)?(ma-?)?(siguro\w*|sigurado\w*|masisiguro\w*|guarantee\w*|promise\w*|confirm\w*|i-?confirm\w*|maipapangako\w*|maipangako\w*|be\s+sure)/i;

/** The sentence holding `index` refuses to promise, before that point. */
export function refusesCertainty(text: string, index: number): boolean {
  const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1)) + 1;
  return NO_CERTAINTY.test(text.slice(start, index));
}

export interface SizeRange {
  /** Normalised labels this size goes by: "M" for "Medium (23-31)". */
  labels: string[];
  min: number;
  max: number;
}

const WORD_SIZE: Record<string, string> = {
  xsmall: "XS",
  "extra small": "XS",
  small: "S",
  medium: "M",
  large: "L",
  "extra large": "XL",
  xlarge: "XL",
  xxl: "2XL",
  xxxl: "3XL",
};

/** "Medium" → "M", "XXL" → "2XL", "l" → "L". Null when it isn't a size word. */
export function normalSize(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[-\s]+/g, " ");
  if (WORD_SIZE[s]) return WORD_SIZE[s];
  const m = s.match(/^([2-5])?\s?(xs|s|m|l|xl)$/);
  if (m) return `${m[1] ?? ""}${m[2].toUpperCase()}`;
  return null;
}

// Size words in any case; letter sizes only in capitals, so "s" or "m" inside Taglish don't count.
const SIZE_WORDS = /\b(extra\s+large|extra\s+small|medium|large|small)\b/gi;
const SIZE_LETTERS = /\b([2-5]\s?XL|XXXL|XXL|XL|XS|S|M|L)\b(?!['’]\w)/g;

/** Every size the text names, normalised. */
export function sizesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of [...text.matchAll(SIZE_WORDS), ...text.matchAll(SIZE_LETTERS)]) {
    const n = normalSize(m[1]);
    if (n) out.add(n);
  }
  return [...out];
}

/** "M (27-30)", "Medium 27-34", "XL (30-40)" → labels and range. */
export function parseSizeRange(size: string): SizeRange | null {
  const r = size.match(/(\d{2})\s*[-–~to]+\s*(\d{2})/);
  if (!r) return null;
  const min = Number(r[1]);
  const max = Number(r[2]);
  if (!(min >= 15 && max <= 70 && min < max)) return null;
  const head = size.slice(0, r.index).replace(/[()]/g, " ").trim();
  const labels = head
    .split(/[\s/]+/)
    .map(normalSize)
    .filter((x): x is string => Boolean(x));
  return labels.length ? { labels: [...new Set(labels)], min, max } : null;
}

export function sizeRangesOf(listings: ListingFacts[]): SizeRange[] {
  const seen = new Map<string, SizeRange>();
  for (const l of listings) {
    for (const s of l.skus) {
      const r = s.size ? parseSizeRange(s.size) : null;
      if (r) seen.set(`${r.labels.join("/")}:${r.min}-${r.max}`, r);
    }
  }
  return [...seen.values()];
}

/** Waist or bust numbers the buyer gave ("32 waist", "waist ko 28", "31 waist, 38 bust"). */
export function buyerMeasurements(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{2})(?:\.\d)?\s*(?:inches|inch|in|"|'')?\s*(?:po\s+)?(?:ang\s+)?(?:waist|waistline|bewang|baywang|bust|dibdib|hips?|balakang)\b|\b(?:waist|waistline|bewang|baywang|bust|dibdib|hips?|balakang)\s*(?:ko|ko\s+po|is|po|ay|size|:)?\s*(\d{2})/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1] ?? m[2]);
    if (n >= 18 && n <= 65) out.push(n);
  }
  return out;
}

const WEIGHT_OR_HEIGHT = /\b\d{2,3}\s*(kg|kgs|kilo|kilos|lbs?|pounds)\b|\b[4-6]\s*['’]\s*\d{1,2}\b|\b[4-6]\s*ft\b|\b1[4-8]\d\s*cm\b/i;
const ASKS_MEASURE = /\b(waist|bust|bewang|baywang|dibdib|sukat|inches|measure|measurement)\b/i;

export type FactCheck = { ok: true } | { ok: false; label: string };

/**
 * The size the reply recommends must fit the buyer's measurement on the
 * listing, and a size can't come from weight or height alone.
 */
export function checkSize(reply: string, opts: { buyerText: string; ranges: SizeRange[] }): FactCheck {
  const named = sizesIn(reply);
  if (!named.length) return { ok: true };

  const measures = buyerMeasurements(opts.buyerText);
  if (!measures.length && WEIGHT_OR_HEIGHT.test(opts.buyerText) && !ASKS_MEASURE.test(reply)) {
    return { ok: false, label: "it picked a size from weight or height, without the waist or bust" };
  }
  if (!measures.length || !opts.ranges.length) return { ok: true };

  const fits = new Set<string>();
  const known = new Set<string>();
  for (const r of opts.ranges) {
    for (const l of r.labels) known.add(l);
    if (measures.some((n) => n >= r.min && n <= r.max)) for (const l of r.labels) fits.add(l);
  }
  const mentioned = named.filter((n) => known.has(n));
  // Listing several sizes is fine as long as one that fits is among them.
  if (fits.size && mentioned.length && !mentioned.some((n) => fits.has(n))) {
    return { ok: false, label: `it suggested ${mentioned.join("/")} but the buyer's ${measures[0]} fits ${[...fits].join("/")}` };
  }
  return { ok: true };
}

type Status = "delivered" | "shipped";

const STATUS_CLAIMS: Array<{ status: Status; re: RegExp }> = [
  { status: "delivered", re: /\b(na-?deliver(ed)?\s+na|naideliver\s+na|delivered\s+na|has\s+been\s+delivered|was\s+delivered|is\s+delivered|dumating\s+na|natanggap\s+(n(?:y|i)o\s+)?na)\b/gi },
  { status: "shipped", re: /\b(na-?ship\s+na|naship\s+na|naipadala\s+na|napadala\s+na|has\s+(been\s+)?shipped|was\s+shipped|is\s+shipped|already\s+shipped|nasa\s+courier\s+na|on\s+(its|the)\s+way|out\s+for\s+delivery|in\s+transit)\b/gi },
];

// "Kapag na-ship na", "if it has shipped", "hindi pa na-ship".
const STATUS_HEDGE = /\b(kapag|pag|kung|if|once|when|after|hindi\s+pa|di\s+pa|not\s+yet|wala\s+pa|check|i-?check|iche-?check|tingnan)\b[^.!?]{0,30}$/i;

/**
 * What may be said for each order status label (src/lib/chats/order-panel.ts).
 * Unknown labels allow nothing, so a new status can't be misdescribed.
 */
const STATUS_ALLOWS: Record<string, Status[]> = {
  delivered: ["delivered", "shipped"],
  completed: ["delivered", "shipped"],
  "return requested": ["delivered", "shipped"],
  "on the way": ["shipped"],
  "shipping again": ["shipped"],
  "partly shipped": ["shipped"],
  "waiting for payment": [],
  "getting ready to ship": [],
  "packed, waiting for courier": [],
  "buyer asked to cancel": [],
  cancelled: [],
  "on hold": [],
};

function allowedStatuses(orderStatus: string | null): Set<Status> {
  const s = (orderStatus ?? "").trim().toLowerCase();
  return new Set(STATUS_ALLOWS[s] ?? []);
}

/** A shipped or delivered claim must match the linked order's status. */
export function checkStatus(reply: string, orderStatus: string | null): FactCheck {
  const allowed = allowedStatuses(orderStatus);
  for (const { status, re } of STATUS_CLAIMS) {
    for (const m of reply.matchAll(re)) {
      if (allowed.has(status)) continue;
      if (STATUS_HEDGE.test(reply.slice(0, m.index ?? 0))) continue;
      const what = orderStatus ? `the order shows "${orderStatus}"` : "no order is linked";
      return { ok: false, label: `it said the order is ${status} but ${what}` };
    }
  }
  return { ok: true };
}

// The buyer says the item reached them ("naipadala niyo", "dumating", "received").
const ARRIVED =
  /\b(naipadala|napadala|pinadala|dumating|dumting|natanggap|nareceive|na-?receive|nakuha|received|arrived|got\s+(my|the)\s+(order|item|parcel)|delivered\s+(na|already)|ang\s+dating)\b/i;
const CANCEL = /\b(i-?cancel|cancel|ma-?cancel|cancellation)\b/i;

/** An order the buyer already has can't be cancelled; offering it confuses them. */
export function checkCancelAfterArrival(reply: string, buyerText: string): FactCheck {
  if (!ARRIVED.test(buyerText) || /\b(pa\s+)?cancel\b/i.test(buyerText)) return { ok: true };
  const m = reply.match(CANCEL);
  if (!m) return { ok: true };
  // "Hindi na po ma-cancel" / "it can't be cancelled anymore" is correct.
  if (NO_BEFORE.test(reply.slice(0, m.index ?? 0)) || refusesCertainty(reply, m.index ?? 0)) return { ok: true };
  return { ok: false, label: "it offered to cancel an order the buyer already received" };
}

const IN_TIME =
  /\b(aabot|aabutan|maaabot|maaabutan|aabot\s+po|makakarating\s+(po\s+)?bago|darating\s+(po\s+)?bago|dadating\s+(po\s+)?bago|matatanggap\s+(n(?:y|i)o\s+)?(po\s+)?bago|in\s+time\s+(for|before)|on\s+time\s+for|before\s+(your|the)\s+(event|party|birthday|trip|flight)|sakto\s+(po\s+)?(sa|bago))\b/gi;
const NO_BEFORE = /\b(hindi|di|not|can'?t|cannot|won'?t|walang|no)\b(?:\s+\S+){0,4}\s*$/i;

/** "Aabot po bago ang Friday" is a promise nobody can keep. */
export function checkInTime(reply: string): FactCheck {
  for (const m of reply.matchAll(IN_TIME)) {
    const before = reply.slice(0, m.index ?? 0);
    if (NO_BEFORE.test(before) || STATUS_HEDGE.test(before) || refusesCertainty(reply, m.index ?? 0)) continue;
    return { ok: false, label: `it promised the order would arrive in time ("${m[0]}")` };
  }
  return { ok: true };
}
