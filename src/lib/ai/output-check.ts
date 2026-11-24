import { findOffPlatformDetails } from "@/lib/chats/contact-check";

/**
 * Checks an AI reply before the owner sees it (and before any automatic send).
 * A reply that fails is thrown away; nothing here rewrites it.
 *
 * "Grounded" words and numbers are fine when the shop facts, the order or the
 * buyer said them first: "refund" is fine if the returns answer mentions it,
 * "₱150" is not if no fact or message has 150.
 */

export type CheckReason = "empty" | "too_long" | "contact" | "leak" | "promise" | "stock" | "number" | "date";

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
  /\bguarantee(d)?\b|\bsigurado\b|\bpromise\b|\bpangako\b/i,
  // Holding stock for one buyer.
  /\b(i-?reserve|reserve(d)?|itatabi|itabi|i-?hold|hold\s+(it|for))\b/i,
];

// Saying something is in stock. Only allowed when the listing's stock is in the facts.
const STOCK_CLAIM =
  /\b(may|meron|mayroon)\s+(pa\s+)?(po\s+)?(pa(ng)?|stock|kami(ng)?|tayo(ng)?)\b|\bin\s+stock\b|\bavailable\s+(pa|na)\b|\bwe\s+(still\s+)?have\b|\bstill\s+available\b|\brestock(ed|ing)?\b|\bsold\s*out\b|\bubos\s+na\b|\bwala\s+na(ng)?\s+(stock|kami)\b/gi;
const HEDGE_BEFORE = /\b(kung|if|whether|check|tingnan|alamin)\b[^.!?]{0,25}$/i;

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

export function checkReply(
  reply: string,
  opts: {
    facts: string;
    /** A listing's stock (available / few left / sold out) was in the facts. */
    stockKnown?: boolean;
  }
): CheckResult {
  const text = reply.trim();
  if (!text) return { ok: false, reason: "empty", label: "it was empty" };
  if (text.length > MAX_REPLY_CHARS) return { ok: false, reason: "too_long", label: "it was too long" };

  const contact = findOffPlatformDetails(text);
  if (contact.length) return { ok: false, reason: "contact", label: `it mentioned ${contact[0]}` };

  if (LEAK.test(text)) return { ok: false, reason: "leak", label: "it talked about its instructions" };

  for (const re of PROMISE_WORDS) {
    const m = text.match(re);
    if (m && !grounded(m[0], opts.facts)) return { ok: false, reason: "promise", label: `it promised "${m[0]}"` };
  }

  if (!opts.stockKnown) {
    for (const m of text.matchAll(STOCK_CLAIM)) {
      const before = text.slice(0, m.index ?? 0);
      if (!HEDGE_BEFORE.test(before)) return { ok: false, reason: "stock", label: "it guessed the stock" };
    }
  }

  for (const m of text.matchAll(DAY_WORDS)) {
    if (!grounded(m[0], opts.facts)) return { ok: false, reason: "date", label: `it promised a day ("${m[0]}")` };
  }

  // Every number must come from the facts, the order or the buyer.
  const known = new Set(digitsOf(opts.facts));
  for (const n of digitsOf(text)) {
    if (Number(n) <= 1) continue;
    if (!known.has(n)) return { ok: false, reason: "number", label: `it used a number that isn't in your facts (${n})` };
  }
  return { ok: true };
}
