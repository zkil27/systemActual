/**
 * Shopee and TikTok penalise sellers who move buyers off the platform. Before a
 * reply goes out we look for contact or payment details and warn the owner.
 * This only warns; it never blocks a message.
 *
 * Order numbers, tracking numbers and prices must not trip it, so numbers only
 * count when they look like a Philippine phone number on their own.
 */

// Not part of a longer run of letters or digits (so SPXPH0123456789 and
// 18-digit TikTok order ids are left alone).
const EDGE_START = String.raw`(?<![A-Za-z0-9])`;
const EDGE_END = String.raw`(?![A-Za-z0-9])`;
const SEP = String.raw`[\s.-]?`;

const MOBILE = new RegExp(
  `${EDGE_START}(?:\\+?63|0)${SEP}9\\d{2}${SEP}\\d{3}${SEP}\\d{4}${EDGE_END}`
);
// Landline with an area code and a separator: "(02) 8123 4567", "032-234-5678".
const LANDLINE = new RegExp(
  `${EDGE_START}(?:\\(0\\d{1,3}\\)|0\\d{1,3})[\\s-]\\d{3,4}[\\s-]?\\d{4}${EDGE_END}`
);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;
const BARE_DOMAIN =
  /(?<![A-Za-z0-9@.])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|ph|net|org|me|ly|link|shop|store|io|co|app|page|site|online|gl)(?:\/\S*)?(?![A-Za-z0-9])/i;

const KEYWORDS: Array<{ label: string; re: RegExp }> = [
  { label: "GCash", re: /\bg-?cash\b/i },
  { label: "Maya", re: /\b(?:pay)?maya\b/i },
  { label: "Messenger", re: /\bmessenger\b/i },
  { label: "Facebook", re: /\b(?:facebook|fb)\b/i },
  { label: "Viber", re: /\bviber\b/i },
  { label: "WhatsApp", re: /\bwhats\s?app\b/i },
  { label: "Telegram", re: /\btelegram\b/i },
  { label: "Instagram", re: /\b(?:instagram|ig)\b/i },
  { label: "a bank", re: /\b(?:bank|bdo|bpi|metrobank|landbank|unionbank|security\s?bank|rcbc)\b/i },
];

/** What off-platform details the message seems to contain, in plain words. Empty when none. */
export function findOffPlatformDetails(text: string): string[] {
  const found: string[] = [];
  if (!text.trim()) return found;
  if (MOBILE.test(text) || LANDLINE.test(text)) found.push("a phone number");
  if (EMAIL.test(text)) found.push("an email");
  // Email domains shouldn't count twice as a link.
  const withoutEmails = text.replace(new RegExp(EMAIL.source, "g"), " ");
  if (URL_RE.test(withoutEmails) || BARE_DOMAIN.test(withoutEmails)) found.push("a link");
  for (const k of KEYWORDS) if (k.re.test(text)) found.push(k.label);
  return found;
}

/** "a phone number and GCash" */
export function describeFound(found: string[]): string {
  if (found.length <= 1) return found[0] ?? "";
  return `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
}
