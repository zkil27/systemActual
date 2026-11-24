import { findOffPlatformDetails } from "@/lib/chats/contact-check";
import { checkCancelAfterArrival, checkInTime, checkSize, checkStatus, refusesCertainty, type FactCheck, type SizeRange } from "./fact-check";

/**
 * Checks an AI reply before the owner sees it (and before any automatic send).
 * A reply that fails is thrown away; nothing here rewrites it.
 *
 * "Grounded" words and numbers are fine when the shop facts, the order or the
 * buyer said them first: "refund" is fine if the returns answer mentions it,
 * "₱150" is not if no fact or message has 150.
 */

export type CheckReason = "empty" | "too_long" | "contact" | "leak" | "promise" | "stock" | "claim" | "language" | "number" | "date";

export type CheckResult = { ok: true } | { ok: false; reason: CheckReason; label: string };

export const MAX_REPLY_CHARS = 700;

const LEAK =
  /\b(as an ai|ai model|language model|i('m| am) an ai|system prompt|my instructions|these instructions|shop facts|grounding)\b|<<<|>>>|\[(check|phone|email|link|number|address)\]/i;

// Money and exchange promises. Fine only when the facts use the same word.
const PROMISE_WORDS = [
  /\bdiscount(ed|s)?\b/i,
  /\bdiskwento\b/i,
  /\bvouchers?\b/i,
  /\bfreebies?\b/i,
  /\blibre(ng)?\b/i,
  /\bfree\s+(shipping|sf|item|gift)\b/i,
  /\bcash\s?back\b/i,
  /\bpromo\s*codes?\b/i,
  /\bbawas\b/i,
  /\bless\s+(na|po|\d)/i,
  /\bi-?refund\b|\bire-?refund\b|\bmare-?refund\b|\brefund(ed)?\b/i,
  /\bibabalik\b[^.!?]{0,20}\b(pera|bayad)\b/i,
  /\breplacement\b/i,
  /\bpapalitan\b/i,
  // "para sigurado" / "para makasigurado" means "to be sure", not a promise.
  /\bguarantee(d)?\b|(?<!\bpara\s+(?:ma(?:ka)?)?)\bsigurado(ng)?\b|\bpromise\b|\bpangako\b/i,
  // Holding stock for one buyer.
  /\b(i-?reserve|reserve(d)?|itatabi|itabi|i-?hold|hold\s+(it|for))\b/i,
];

// Saying something is in stock. Only allowed when the listing's stock is in the facts.
const STOCK_CLAIM =
  /\b(may|meron|mayroon)\s+(pa\s+)?(po\s+)?(pa(ng)?|stock)\b|\bin\s+stock\b|\bavailable\s+(pa|na)\b|\bwe\s+(still\s+)?have\b|\bstill\s+available\b|\brestock(ed|ing)?\b|\bsold\s*out\b|\bubos\s+na\b|\bwala\s+na(ng)?\s+(stock|kami)\b/gi;
const HEDGE_BEFORE = /\b(kung|if|whether|check|i-?check|iche-?check|tingnan|titingnan|alamin|aalamin|confirm|i-?confirm)\b[^.!?]{0,25}$/i;

// Day words that turn into a delivery promise.
const DAY_WORDS =
  /\b(bukas|tomorrow|mamaya|later\s+today|ngayong\s+araw|tonight|mamayang\s+gabi|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miyerkules|huwebes|biyernes|sabado)\b/gi;

function normal(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ");
}

function grounded(word: string, facts: string): boolean {
  return normal(facts).includes(normal(word));
}

function digitsOf(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

const NOT_A_BOT =
  /\b(hindi|di)\s+(po\s+)?(ito\s+|ako\s+)?(po\s+)?(isang\s+)?(bot|robot|ai)\b|\bnot\s+(a\s+)?(bot|robot)\b|\bi'?m\s+(a\s+)?(real\s+)?(human|person)\b|\b(tao|totoong\s+tao)\s+(po\s+)?(ito|ako|ang\s+kausap)\b/i;

// "hindi kami nagbibigay ng voucher", "wala pong discount", "we can't reserve"
const NEGATION_BEFORE = /\b(hindi|di|wala|walang|not|no|never|can'?t|cannot|won'?t|don'?t|huwag|bawal)\b(?:\s+\S+){0,5}\s*$/i;

// "May iba't ibang blazer kami", "meron kaming red", "we have blazers": the shop
// says it has something. Fine only when that thing is in the shop's facts.
const HAVE =
  /\b(?:may|meron|mayroon)\s+((?:\S+\s+){0,4}?)(?:po\s+)?(?:din\s+|rin\s+)?(?:po\s+)?kami(?:ng)?\b(?:\s+([^.,!?;:]+))?|\bwe\s+(?:still\s+|also\s+)?(?:have|carry|sell)\s+([^.,!?;:]+)/gi;
const FILLER = new Set([
  "po", "din", "rin", "pa", "na", "iba't", "ibang", "iba", "mga", "ng", "ang", "pong", "ding", "ring", "also", "the", "a", "an",
  "some", "other", "kayo", "ninyo", "sa", "at", "and", "team", "staff", "assistant", "tanong", "available",
  // Counting words: "may two colors kami", "meron kaming tatlong sizes".
  "one", "two", "three", "four", "five", "several", "many", "isang", "dalawa", "dalawang", "tatlo", "tatlong", "apat", "apat na",
  "ilang", "colors", "colours", "kulay", "sizes", "size", "options", "variations", "choices",
]);

function words(raw: string | undefined): string[] {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && w.length > 1);
}

/** The words naming what the shop says it has: "may [X] kami", "meron kaming [X]", "we have [X]". */
function haveWords(m: RegExpMatchArray): string[] {
  const between = words(m[1]);
  if (between.length) return between;
  // The thing right after: "meron kaming COD, piliin…" → "cod".
  return words(m[2] ?? m[3]).slice(0, 3);
}

// What a fabric or fit is like. Must come from the facts even when said as "not".
const PRODUCT_CLAIM =
  /\b(see[\s-]?through|transparent|opaque|manipis|makapal|stretch(y|able)?|nababanat|breathable|presko|mainit|malambot|soft|thick|thin|kumukupas|fade(s|d)?|lumiliit|shrinks?|wrinkle[\s-]?free|true\s+to\s+size|fits?\s+small|fits?\s+big)\b/gi;

export function checkReply(
  reply: string,
  opts: {
    /** Everything the reply may repeat: shop facts, order, listings and the buyer's words. */
    facts: string;
    /**
     * Only what the shop said (answers, order, listings). Promise and day words
     * must come from here: a buyer typing "refund" or "bukas" doesn't make it a fact.
     */
    shopFacts?: string;
    /** A listing's stock (available / few left / sold out) was in the facts. */
    stockKnown?: boolean;
    /** The buyer's waiting messages, for the size checks. */
    buyerText?: string;
    /** Size ranges from the listings the chat is about. */
    sizeRanges?: SizeRange[];
    /** Status of the linked order; null = no order. Leave out to skip the status check. */
    orderStatus?: string | null;
  }
): CheckResult {
  const shopFacts = opts.shopFacts ?? opts.facts;
  const facts: Array<() => FactCheck> = [
    () => checkInTime(reply),
    () => (opts.buyerText !== undefined ? checkCancelAfterArrival(reply, opts.buyerText) : { ok: true }),
    () => (opts.buyerText !== undefined ? checkSize(reply, { buyerText: opts.buyerText, ranges: opts.sizeRanges ?? [] }) : { ok: true }),
    () => (opts.orderStatus !== undefined ? checkStatus(reply, opts.orderStatus) : { ok: true }),
  ];
  for (const f of facts) {
    const r = f();
    if (!r.ok) return { ok: false, reason: "claim", label: r.label };
  }
  const text = reply.trim();
  if (!text) return { ok: false, reason: "empty", label: "it was empty" };
  if (text.length > MAX_REPLY_CHARS) return { ok: false, reason: "too_long", label: "it was too long" };

  const contact = findOffPlatformDetails(text);
  if (contact.length) return { ok: false, reason: "contact", label: `it mentioned ${contact[0]}` };

  if (LEAK.test(text)) return { ok: false, reason: "leak", label: "it talked about its instructions" };
  // "- COD: … - Shipping: … - Return: …" is its fact list; "- M (27-30) - L (31-34)" is a fine size list.
  if ((text.match(/(^|\s)[-•*]\s+[\p{L}/ ]{2,25}:\s/gu) ?? []).length >= 3) {
    return { ok: false, reason: "leak", label: "it listed its facts instead of answering" };
  }
  // The buyer must always know they're talking to the shop's assistant.
  if (NOT_A_BOT.test(text)) return { ok: false, reason: "claim", label: "it said it isn't automated" };

  for (const re of PROMISE_WORDS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(global)) {
      if (grounded(m[0], shopFacts)) continue;
      // Saying no ("wala pong discount") is not a promise.
      if (NEGATION_BEFORE.test(text.slice(0, m.index ?? 0))) continue;
      return { ok: false, reason: "promise", label: `it promised "${m[0]}"` };
    }
  }

  for (const m of text.matchAll(HAVE)) {
    if (NEGATION_BEFORE.test(text.slice(0, m.index ?? 0))) continue;
    const words = haveWords(m);
    const unknown = words.filter((w) => !grounded(w, shopFacts));
    // "meron kaming COD" is fine; "may blazer kami" isn't, unless a fact says so.
    if (unknown.length && !(opts.stockKnown && unknown.every((w) => /^(stock|available|pa)$/.test(w)))) {
      return { ok: false, reason: "claim", label: `it said the shop has something your facts don't mention ("${unknown.slice(0, 2).join(" ")}")` };
    }
  }

  for (const m of text.matchAll(PRODUCT_CLAIM)) {
    if (grounded(m[0], shopFacts)) continue;
    // "Stretchy" is fine when the listing says stretch or spandex. An elastic waist says nothing about the fabric.
    if (/stretch|nababanat/i.test(m[0]) && /\b(stretch\w*|spandex|lycra)\b/i.test(shopFacts)) continue;
    // "Iche-check po namin kung manipis" is fine; "hindi po manipis" is a made-up fact.
    if (HEDGE_BEFORE.test(text.slice(0, m.index ?? 0))) continue;
    return { ok: false, reason: "claim", label: `it described the item ("${m[0]}") without a fact saying so` };
  }

  if (!opts.stockKnown) {
    for (const m of text.matchAll(STOCK_CLAIM)) {
      // Repeating a shop answer ("Makikita po ang available na sizes") isn't a guess.
      if (grounded(m[0], shopFacts)) continue;
      const before = text.slice(0, m.index ?? 0);
      if (!HEDGE_BEFORE.test(before) && !NEGATION_BEFORE.test(before)) return { ok: false, reason: "stock", label: "it guessed the stock" };
    }
  }

  for (const m of text.matchAll(DAY_WORDS)) {
    if (grounded(m[0], shopFacts)) continue;
    // "Hindi po namin masisiguro kung aabot bago ang Friday" says the opposite of a promise.
    if (refusesCertainty(text, m.index ?? 0)) continue;
    return { ok: false, reason: "date", label: `it promised a day ("${m[0]}")` };
  }

  // Every number must come from the facts, the order or the buyer.
  const known = new Set(digitsOf(opts.facts));
  for (const n of digitsOf(text)) {
    if (Number(n) <= 1) continue;
    if (!known.has(n)) return { ok: false, reason: "number", label: `it used a number that isn't in your facts (${n})` };
  }
  return { ok: true };
}
