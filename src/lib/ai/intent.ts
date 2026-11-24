import type { AiTopic } from "./settings";

/**
 * What a buyer's message is about, from English and Taglish keywords. No AI.
 * Order matters: money and complaints are checked first so they always reach
 * a person, then the more specific topics.
 */

const RETURNS =
  /(\b(return|refund|ibalik|ibabalik|isauli|palit|papalitan|exchange|sira|sirang|damaged?|defect(ive)?|punit|butas|wrong\s+(item|size|color|order)|kulang|missing\s+item|complain|reklamo|scam|manloloko|cancel|i-?cancel|cancelled|bwisit|walang\s+kwenta|report|dispute)\b|\bmali(ng)?\b[^?.!]{0,25}\b(item|size|kulay|color|order|padala|dumating|naipadala)\b)/i;
const ORDER =
  /\b(asan|nasaan|saan\s+na|where('?s| is)?\s+(my\s+)?(order|parcel|package)|order\s+ko|parcel\s+ko|tracking|track|status|na-?ship|naship|shipped|ship\s+na|na-?padala|pinadala|out\s+for\s+delivery|rider|courier|j&t|jnt|spx|flash\s+express|dumating|darating|dadating|kelan|kailan|when\s+(will|is|po)|arrive|deliver(ed|y)?)\b/i;
const SHIPPING =
  /\b(ilang\s+araw|how\s+many\s+days|gaano\s+katagal|how\s+long|shipping\s+fee|\bsf\b|shipping|ship\s+to|lead\s+time|province|probinsya|cebu|davao|iloilo|mindanao|visayas|luzon|metro\s+manila|ncr)\b/i;
const COD = /\b(cod|c\.o\.d|cash\s+on\s+delivery|payment|bayad|magbayad|pay\s+(later|via|thru|through)|installment|card)\b/i;
const STOCK =
  /(\b(may|meron|mayroon)\b[^?.!]{0,40}?\bpa\b|\b(available|avail|in\s+stock|stock|restock|sold\s*out|out\s+of\s+stock|ubos|wala\s+na)\b)/i;
const SIZE =
  /(\b(size|sizes|sizing|sukat|kasya|kakasya|fit|fits|fitting|small|medium|large|x?xl|free\s*size|waist|bewang|bust|dibdib|hips?|balakang|height|tangkad|haba|length|liit|maliit|laki|malaki|maluwag|luwag|masikip|sikip)\b|\d\s*(kg|kilo|lbs|cm|inch(es)?|in)\b|\d'\s*\d|\b\d{2}\s*-\s*\d{2}\b)/i;
const PRODUCT =
  /\b(tela|fabric|material|makapal|manipis|see[\s-]?through|stretch(y|able)?|garter|lining|tahi|quality|original|actual\s+(pic|photo)|real\s+(pic|photo)|wash|labhan|plantsa|kulay\s+ba|color\s+ba|kumukupas|fade)\b/i;

const GREETING = /^(hi+|hello+|helo|hey|good\s+(morning|afternoon|evening|day)|magandang\s+(umaga|hapon|gabi)|hu?mm*)[\s!.,?po]*$/i;
const ACK =
  /^(ok(ay|i)?|k+|sige|noted|salamat|thank(s| you)?|ty|thx|tnx|ty po|po|yes|yup|yep|opo|oo|done|received|nareceive|natanggap|got it|wow|nice|ganda|ayos|sige po|okay po|ok po|salamat po|thank you po|thanks po)[\s!.,?😊🙏❤️👍🥰😍]*$/i;

export function normalizeText(t: string | null | undefined): string {
  return (t ?? "").replace(/\s+/g, " ").trim();
}

/** "ok po", "salamat", emoji only, or a plain greeting: nothing to answer. */
export function isAckOrGreeting(text: string | null | undefined): boolean {
  const s = normalizeText(text);
  if (!s) return true;
  if (/^[\p{Extended_Pictographic}\p{Emoji_Component}\s\p{P}]+$/u.test(s)) return true;
  if (ACK.test(s) || GREETING.test(s) || (s.length <= 12 && /^(salamat|thank|ok|sige)/i.test(s))) return true;
  // "Done na po, thank you!", "ok na po salamat": every word is a thanks or filler.
  const words = s
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, " ")
    .split(/[^\p{L}']+/u)
    .filter(Boolean);
  return words.length > 0 && words.length <= 8 && words.every((w) => ACK_WORDS.has(w));
}

const ACK_WORDS = new Set([
  "ok", "okay", "oki", "okie", "k", "sige", "noted", "salamat", "maraming", "thank", "thanks", "you", "ty", "thx", "tnx",
  "po", "na", "ho", "yes", "yup", "opo", "oo", "done", "received", "nareceive", "natanggap", "ko", "got", "it",
  "nice", "ganda", "ayos", "great", "so", "much", "again", "din", "rin", "naman", "ate", "kuya", "miss", "maam", "sir",
]);

/** TikTok's notice that the buyer asked for a person. */
export function isHandoffNotice(text: string | null | undefined): boolean {
  return /requested manual customer service|assigned to/i.test(text ?? "");
}

/**
 * The fixed "we're busy, please wait" message Duoke sends. It isn't an
 * answer, so the assistant still drafts one after it.
 */
export function isHoldingReply(text: string | null | undefined): boolean {
  const s = normalizeText(text).toLowerCase();
  if (!s) return false;
  return (
    /maraming mensahe ang natatanggap/.test(s) ||
    /abala ang aming customer service/.test(s) ||
    /(we are|we're) (currently )?(receiving a high volume|busy).*(reply|respond)/.test(s)
  );
}

/**
 * Every topic in a burst of buyer messages, one per message, in the order
 * asked, without repeats. "returns" is always kept: it decides who answers.
 */
export function classifyIntents(texts: string[], opts: { hasOrder?: boolean } = {}): AiTopic[] {
  const out: AiTopic[] = [];
  for (const t of texts) {
    // A complaint split across a comma ("mali po, yung size") is still a complaint.
    if (classifyIntent(t, opts) === "returns" && !out.includes("returns")) out.push("returns");
    // "COD po ba and ilang araw shipping?" asks two things.
    for (const part of splitQuestions(t)) {
      const topic = classifyIntent(part, opts);
      if (!out.includes(topic)) out.push(topic);
    }
  }
  // "other" alongside a real topic is usually filler ("nag order ako sa live").
  return out.length > 1 ? out.filter((t) => t !== "other") : out;
}

/**
 * One message can hold several questions: split on question marks, sentence
 * ends, commas and joining words ("and", "tapos", "at saka", "also", "+").
 * Short leftovers ("po") are dropped; a message with no split stays whole.
 */
export function splitQuestions(text: string): string[] {
  const parts = normalizeText(text)
    .split(/[?!.;,\n]+|\s(?:and|tapos|at\s+saka|atsaka|saka|also|plus|\+|&)\s/i)
    .map((p) => p.trim())
    .filter((p) => p.replace(/\b(po|ba|pa|na)\b/gi, "").trim().length >= 3);
  return parts.length ? parts : [normalizeText(text)];
}

/**
 * Topic of a buyer's question. `hasOrder` tells "kelan darating?" apart:
 * about their order when one is linked, about shipping time otherwise.
 */
export function classifyIntent(text: string, opts: { hasOrder?: boolean } = {}): AiTopic {
  const s = normalizeText(text);
  if (RETURNS.test(s)) return "returns";
  if (COD.test(s)) return "cod";
  const asksArrival = /\b(kelan|kailan|when|arrive|darating|dadating|dumating|ilang\s+araw|how\s+many\s+days)\b/i.test(s);
  if (ORDER.test(s) && !(asksArrival && !opts.hasOrder && !/order|parcel|package|tracking|track/i.test(s))) {
    return "order";
  }
  if (SHIPPING.test(s) || asksArrival) return "shipping";
  if (STOCK.test(s)) return "stock";
  if (SIZE.test(s)) return "size";
  if (PRODUCT.test(s)) return "product";
  return "other";
}
