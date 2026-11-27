import type { AiTopic } from "./settings";

/**
 * What a buyer's message is about, from English and Taglish keywords. No AI.
 * Order matters: money and complaints are checked first so they always reach
 * a person, then the more specific topics.
 */

const RETURNS =
  /(\b(?:smaller|bigger|maliit|malaki|liit|laki|masikip|maluwag)\b[^.!?]{0,40}\b(?:naipadala|dumating|natanggap|pinadala|padala|sent|received|arrived|nareceive)\b|\b(?:naipadala|dumating|natanggap|pinadala|sent|received|arrived|nareceive)\b[^.!?]{0,40}\b(?:smaller|bigger|maliit|malaki|masikip|maluwag|hindi\s+kasya|di\s+kasya)\b|\b(?:di|hindi)\s+(?:po\s+)?(?:na\s+)?kasya\b|\b(return|refund|ibalik|ibabalik|isauli|palit|palitan|papalitan|pa-?palit|exchange|sira|sirang|damaged?|defect(ive)?|punit|butas|mantsa|wrong\s+(item|size|color|order)|kulang|missing\s+item|complain|reklamo|scam|manloloko|cancel|i-?cancel|cancelled|bwisit|walang\s+kwenta|report|dispute|singil|siningil|sinisingil|overcharged?|double\s+charged?|sobra(ng)?\s+(bayad|singil))\b|\bmali(ng)?\b[^?.!]{0,25}\b(item|size|kulay|color|order|padala|dumating|naipadala)\b)/i;
const ORDER =
  /\b(asan|nasaan|saan\s+na|where('?s| is)?\s+(my\s+)?(order|parcel|package)|order\s+ko|parcel\s+ko|tracking|track|status|na-?ship|naship|shipped|ship\s+na|na-?padala|pinadala|out\s+for\s+delivery|rider|courier|j&t|jnt|spx|flash\s+express|dumating|darating|dadating|kelan|kailan|when\s+(will|is|po)|arrive|deliver(ed|y)?)\b/i;
const SHIPPING =
  /\b(ilang\s+araw|how\s+many\s+days|gaano\s+katagal|how\s+long|shipping\s+fee|\bsf\b|shipping|ship\s+to|lead\s+time|province|probinsya|cebu|davao|iloilo|mindanao|visayas|luzon|metro\s+manila|ncr)\b/i;
const COD =
  /\b(cod|c\.o\.d|cash\s+on\s+delivery|payment|bayad|magbayad|bayaran|babayaran|pay\s+(later|via|thru|through|when|upon|on\s+delivery)|installment|card)\b/i;
// The buyer's own existing order, not one they're thinking of placing.
const OWN_ORDER =
  /\b(order|parcel|package|item)\s+(ko|namin|nyo|ninyo)\b|\bmy\s+(order|parcel|package)\b|\b(tracking|track)\b|\binorder\b|\bnaka-?order\b/i;
const HYPOTHETICAL = /\b(pag|kapag|kung|if|once)\s+(po\s+)?(ako\s+)?(nag|mag|um)?-?\s*order/i;
const RESTOCK =
  /\b(re-?stock(ed|ing|s)?|replenish(ed|ment)?|back\s+in\s+stock|sold\s*out|out\s+of\s+stock|ubos\s+na|wala\s+na\s+(po\s+)?stock|mag\s*-?\s*kaka\s*-?\s*stock|mag\s*-?\s*ka\s*-?\s*stock|mag\s*-?\s*re-?stock|mag-?stock\s+ulit|babalik\s+(ang\s+)?stock)\b/i;
// How long shipping takes in general.
const DURATION = /\b(ilang\s+araw|how\s+many\s+days|gaano\s+(po\s+)?katagal|how\s+long|lead\s+time)\b/i;
const STOCK =
  /(\b(may|meron|mayroon)\b[^?.!]{0,40}?\bpa\b|\b(available|avail|in\s+stock|stock|restock|sold\s*out|out\s+of\s+stock|ubos|wala\s+na)\b)/i;
const SIZE =
  /(\b(size|sizes|sizing|sukat|kasya|kakasya|fit|fits|fitting|small|medium|large|x?xl|free\s*size|waist|bewang|bust|dibdib|hips?|balakang|height|tangkad|haba|length|liit|maliit|laki|malaki|maluwag|luwag|masikip|sikip)\b|\d\s*(kg|kilo|lbs|cm|inch(es)?|in)\b|\d'\s*\d|\b\d{2}\s*-\s*\d{2}\b)/i;
const PRODUCT =
  /\b(tela|fabric|material|makapal|manipis|see[\s-]?through|stretch(y|able)?|garter|lining|tahi|quality|original|actual\s+(pic|photo)|real\s+(pic|photo)|wash|labhan|plantsa|kulay\s+ba|color\s+ba|kumukupas|fade)\b/i;

// Asking for a lower price or something free. No shop answer covers it, so
// a person or the AI answers ("the price is as listed"), never a template.
const PRICE_ASK =
  /\b(discount(s|ed)?|diskwento|less|tawad|bawas|libre(ng)?|free\s*(shipping|sf|gift|item)|freebies?|vouchers?|promo(\s*code)?|coupons?|cash\s?back)\b|\d+\s*%|%\s*off\b/i;
// Trying to get the assistant to drop its rules.
const TRICK =
  /\b(ignore|disregard|forget)\b[^.!?]{0,30}\b(rules?|instructions?|prompt|previous|above)\b|\bsystem\s+prompt\b|\byou\s+are\s+now\b|\bpretend\s+(to\s+be|you)\b|\bact\s+as\b/i;

// Requests only a person can grant or check. Replies to these always need the owner's eye.
const OWNER_ONLY: RegExp[] = [
  // A date or event the order must reach in time.
  /\b(agad|asap|urgent|rush|need(ed)?\s+(it\s+)?by|in\s+time|before\s+(the\s+)?\d|bago\s+(mag\s+)?(ang\s+)?(pasko|christmas|bday|birthday|\d)|this\s+(mon|tues|wednes|thurs|fri|satur|sun)day|(sa|this|on)\s+(lunes|martes|miyerkules|huwebes|biyernes|sabado|linggo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|birthday|bday|party|okasyon|occasion|byahe|biyahe|pauwi|uuwi|aalis)\b/i,
  // Photos or videos of the actual item.
  /\b(pa-?pic|picturan|kunan|litrato|actual\s+(pic|photo|picture)|real\s+(pic|photo)|send\s+(a\s+)?(pic|photo|picture|video)|video\s+(po|nga))\b/i,
  // Changing an order already placed.
  /\b(pa-?change|change|palitan|pa-?palit|i-?update|edit)\b[^.!?]{0,30}\b(order|size|kulay|color|colour|address|item|design)\b/i,
  // Checking an order carefully before it ships.
  /\b(pki|paki|pa)-?\s*check\b[^.!?]{0,20}\b(mabuti|maigi|maayos|ng\s+mabuti)\b|\bmake\s+sure\b[^.!?]{0,30}\b(damage|defect|tama|maayos|correct|good|check)\b/i,
  // Reviews, reselling, going live, bulk.
  /\b(review|reviews|5\s*-?\s*stars?|five\s+stars?|rating|reseller|resell|wholesale|bulk|maramihan|i-?live|mag-?live)\b/i,
  /\b(pwede|pwedi|pwd|can)\b[^.!?]{0,20}\blive\b/i,
];

/** The buyer asks for something only a person can grant: a deadline, photos, an order change, a review reward. */
export function needsOwner(texts: string[]): boolean {
  return texts.some((t) => OWNER_ONLY.some((re) => re.test(normalizeText(t))));
}

/** A discount or freebie request, or an attempt to trick the assistant. */
export function isPriceAskOrTrick(text: string | null | undefined): boolean {
  const s = normalizeText(text);
  return PRICE_ASK.test(s) || TRICK.test(s);
}

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

/** Duoke's holding message as the shop receives it (for tests and the test run). */
export const HOLDING_SAMPLE =
  "Salamat sa iyong mensahe. Sa kasalukuyan, maraming mensahe ang natatanggap namin, kaya maaaring medyo matagalan ang aming tugon.";

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
  // "other" alongside a real topic is usually filler ("nag order ako sa live"),
  // but a discount ask or a trick is a real question no template answers.
  if (texts.some(isPriceAskOrTrick)) return out;
  return out.length > 1 ? out.filter((t) => t !== "other") : out;
}

/**
 * One message can hold several questions: split on question marks, sentence
 * ends, commas and joining words ("and", "tapos", "at saka", "also", "+").
 * Short leftovers ("po") are dropped; a message with no split stays whole.
 */
export function splitQuestions(text: string): string[] {
  const parts = normalizeText(text)
    // Not "plus": "plus size" is one thing.
    .split(/[?!.;,\n]+|\s(?:and|tapos|at\s+saka|atsaka|saka|also|\+|&)\s/i)
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
  if (isPriceAskOrTrick(s)) return "other";
  if (COD.test(s)) return "cod";
  // "When will you restock…" asks about stock, not delivery.
  if (RESTOCK.test(s)) return "stock";
  const own = OWN_ORDER.test(s) && !HYPOTHETICAL.test(s);
  // "QC po ako, gaano katagal delivery?" / "kelan ma-ship pag nag order ako?"
  if ((DURATION.test(s) || HYPOTHETICAL.test(s)) && !own) return "shipping";
  const asksArrival = /\b(kelan|kailan|when|arrive|darating|dadating|dumating|ilang\s+araw|how\s+many\s+days)\b/i.test(s);
  if (ORDER.test(s) && !(asksArrival && !opts.hasOrder && !own && !/\border\b/i.test(s))) {
    return "order";
  }
  if (SHIPPING.test(s) || asksArrival) return "shipping";
  if (STOCK.test(s)) return "stock";
  if (SIZE.test(s)) return "size";
  if (PRODUCT.test(s)) return "product";
  return "other";
}
