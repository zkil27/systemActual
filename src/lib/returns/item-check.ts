import { ItemCheckResult, PhysicalCondition, ReturnCategory } from "@prisma/client";

/**
 * Item-by-item return check. Pure functions only: the scan table, the owner's
 * parcel sheet, restock and reports all work from these.
 *
 * Staff only mark what's wrong. Every expected piece counts as received good
 * unless staff said it was missing, wrong, or damaged.
 */

export type PriceSource = "RETURN" | "ORDER_LINE" | "PRO_RATA";

/** One item line the parcel should contain. */
export interface ExpectedLine {
  lineKey: string;
  name: string;
  variationName: string | null;
  imageUrl: string | null;
  quantity: number;
  listingId: string | null;
  variationId: string | null;
  /** Price of one piece, when the shop told us. Owner only. */
  unitPricePhp: number | null;
}

/** What staff reported for one line. Pieces not listed here came back good. */
export interface ItemCheckInput {
  lineKey: string;
  missing?: number;
  wrong?: number;
  damaged?: number;
}

export interface CheckedLine extends ExpectedLine {
  goodQty: number;
  damagedQty: number;
  wrongQty: number;
  missingQty: number;
  result: ItemCheckResult;
}

export interface PricedLine extends CheckedLine {
  /** Price used for the "came back" value; null when nothing is known. */
  pricePhp: number | null;
  priceSource: PriceSource | null;
}

export interface ReturnCheckSummary {
  piecesExpected: number;
  piecesGood: number;
  piecesDamaged: number;
  piecesWrong: number;
  piecesMissing: number;
  /** (good + damaged) × price. Wrong items are worth nothing to the seller. */
  receivedValuePhp: number;
  /** True when any line's price is an even split of the refund. */
  valueIsEstimate: boolean;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const id = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return text(v);
};

/** Same key on the phone, the server and in restock: ids when the shop gave them, else name + colour/size. */
export function lineKeyOf(item: {
  name: string;
  variationName?: string | null;
  listingId?: string | null;
  variationId?: string | null;
}): string {
  if (item.listingId && item.variationId) return `${item.listingId}:${item.variationId}`;
  return `n:${item.name.toLowerCase()}:${(item.variationName ?? "").toLowerCase()}`;
}

/**
 * Expected lines from a parcel's itemsJson. Lines for the same item are merged
 * (TikTok sends one line per piece) and kept in first-seen order. Junk entries
 * are skipped.
 */
export function expectedLinesFromItems(raw: unknown): ExpectedLine[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, ExpectedLine>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const name = text(rec.name);
    if (!name) continue;
    const rawQty = typeof rec.quantity === "number" ? rec.quantity : Number(rec.quantity);
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1;
    const rawPrice = typeof rec.unitPricePhp === "number" ? rec.unitPricePhp : Number(rec.unitPricePhp);
    const unitPricePhp =
      rec.unitPricePhp !== null && rec.unitPricePhp !== undefined && Number.isFinite(rawPrice) && rawPrice > 0
        ? rawPrice
        : null;
    const line: ExpectedLine = {
      lineKey: "",
      name,
      variationName: text(rec.variationName),
      imageUrl: text(rec.imageUrl),
      quantity,
      listingId: id(rec.listingId),
      variationId: id(rec.variationId),
      unitPricePhp,
    };
    line.lineKey = lineKeyOf(line);
    const prev = byKey.get(line.lineKey);
    if (prev) {
      prev.quantity += quantity;
      prev.unitPricePhp ??= unitPricePhp;
      prev.imageUrl ??= line.imageUrl;
    } else {
      byKey.set(line.lineKey, line);
    }
  }
  return [...byKey.values()];
}

/** One-piece parcels: the parcel condition staff already tap says everything. */
export function isSinglePiece(lines: ExpectedLine[]): boolean {
  return lines.length === 1 && lines[0].quantity === 1;
}

export function lineResult(line: { damagedQty: number; wrongQty: number; missingQty: number }): ItemCheckResult {
  if (line.wrongQty > 0) return ItemCheckResult.WRONG_ITEM;
  if (line.missingQty > 0) return ItemCheckResult.SOME_MISSING;
  if (line.damagedQty > 0) return ItemCheckResult.SOME_DAMAGED;
  return ItemCheckResult.ALL_GOOD;
}

function checked(line: ExpectedLine, missing: number, wrong: number, damaged: number): CheckedLine {
  const counts = {
    goodQty: line.quantity - missing - wrong - damaged,
    damagedQty: damaged,
    wrongQty: wrong,
    missingQty: missing,
  };
  return { ...line, ...counts, result: lineResult(counts) };
}

const count = (v: unknown): number | null => {
  if (v === undefined || v === null) return 0;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
};

/**
 * Applies what staff reported to the expected lines. Lines staff didn't touch
 * are all good. Rejects unknown lines and counts that don't add up, so a
 * tampered or stale phone can't record more pieces than the parcel holds.
 */
export function applyItemChecks(
  expected: ExpectedLine[],
  submitted: ItemCheckInput[]
): { ok: true; lines: CheckedLine[] } | { ok: false; error: string } {
  const byKey = new Map<string, ItemCheckInput>();
  for (const s of submitted) {
    if (!s || typeof s.lineKey !== "string") return { ok: false, error: "Item check is missing an item." };
    if (byKey.has(s.lineKey)) return { ok: false, error: "An item was checked twice." };
    byKey.set(s.lineKey, s);
  }
  const known = new Set(expected.map((l) => l.lineKey));
  for (const key of byKey.keys()) {
    if (!known.has(key)) return { ok: false, error: "This parcel's items changed. Scan it again." };
  }
  const lines: CheckedLine[] = [];
  for (const line of expected) {
    const s = byKey.get(line.lineKey);
    const missing = count(s?.missing);
    const wrong = count(s?.wrong);
    const damaged = count(s?.damaged);
    if (missing === null || wrong === null || damaged === null) {
      return { ok: false, error: "Item counts must be whole numbers." };
    }
    if (missing + wrong + damaged > line.quantity) {
      return { ok: false, error: `${line.name}: more pieces marked than expected.` };
    }
    lines.push(checked(line, missing, wrong, damaged));
  }
  return { ok: true, lines };
}

/** A one-piece parcel's check, taken from the condition staff tapped. */
export function checkFromCondition(line: ExpectedLine, condition: PhysicalCondition): CheckedLine {
  const q = line.quantity;
  switch (condition) {
    case PhysicalCondition.DAMAGED_ITEM:
      return checked(line, 0, 0, q);
    case PhysicalCondition.WRONG_OR_SWAPPED_ITEM:
      return checked(line, 0, q, 0);
    case PhysicalCondition.MISSING_PIECE:
      return checked(line, q, 0, 0);
    default:
      return checked(line, 0, 0, 0);
  }
}

/** The parcel's single condition, worst item wins. Keeps the existing filters and alerts working. */
export function deriveParcelCondition(lines: CheckedLine[], packagingTorn: boolean): PhysicalCondition {
  if (lines.some((l) => l.wrongQty > 0)) return PhysicalCondition.WRONG_OR_SWAPPED_ITEM;
  if (lines.some((l) => l.missingQty > 0)) return PhysicalCondition.MISSING_PIECE;
  if (lines.some((l) => l.damagedQty > 0)) return PhysicalCondition.DAMAGED_ITEM;
  if (packagingTorn) return PhysicalCondition.DAMAGED_PACKAGING;
  return PhysicalCondition.GOOD_RESTOCKABLE;
}

/**
 * A price per piece for every line: the shop's own price first, else the
 * refund (or order value) split evenly over all expected pieces, marked as
 * an estimate.
 */
export function priceLines(
  lines: CheckedLine[],
  category: ReturnCategory,
  refundTotalPhp: number
): PricedLine[] {
  const pieces = lines.reduce((n, l) => n + l.quantity, 0);
  const even = pieces > 0 && refundTotalPhp > 0 ? Math.round((refundTotalPhp / pieces) * 100) / 100 : null;
  const known: PriceSource = category === ReturnCategory.FAILED_DELIVERY ? "ORDER_LINE" : "RETURN";
  return lines.map((l) =>
    l.unitPricePhp !== null
      ? { ...l, pricePhp: l.unitPricePhp, priceSource: known }
      : { ...l, pricePhp: even, priceSource: even === null ? null : "PRO_RATA" }
  );
}

export function returnCheckSummary(lines: PricedLine[]): ReturnCheckSummary {
  let value = 0;
  const s = {
    piecesExpected: 0,
    piecesGood: 0,
    piecesDamaged: 0,
    piecesWrong: 0,
    piecesMissing: 0,
  };
  for (const l of lines) {
    s.piecesExpected += l.quantity;
    s.piecesGood += l.goodQty;
    s.piecesDamaged += l.damagedQty;
    s.piecesWrong += l.wrongQty;
    s.piecesMissing += l.missingQty;
    if (l.pricePhp !== null) value += (l.goodQty + l.damagedQty) * l.pricePhp;
  }
  return {
    ...s,
    receivedValuePhp: Math.round(value * 100) / 100,
    valueIsEstimate: lines.some((l) => l.priceSource === "PRO_RATA"),
  };
}

/** Short plain-English line for alerts and dispute drafts, e.g. "Ribbed Top (Black, M): expected 2 — 1 good, 1 missing". */
export function describeLine(l: Pick<CheckedLine, "name" | "variationName" | "quantity" | "goodQty" | "damagedQty" | "wrongQty" | "missingQty">): string {
  const parts: string[] = [];
  if (l.goodQty) parts.push(`${l.goodQty} good`);
  if (l.damagedQty) parts.push(`${l.damagedQty} damaged`);
  if (l.wrongQty) parts.push(`${l.wrongQty} wrong item`);
  if (l.missingQty) parts.push(`${l.missingQty} missing`);
  const label = l.variationName ? `${l.name} (${l.variationName})` : l.name;
  return `${label}: expected ${l.quantity} — ${parts.join(", ") || "none"}`;
}

/** Parcel summary fields rebuilt from a scan's saved checks (after undo or an owner fix). All null without checks. */
export function summaryFromStoredChecks(
  checks: Array<{
    goodQty: number;
    damagedQty: number;
    wrongQty: number;
    missingQty: number;
    unitPricePhp: number | { toString(): string } | null;
  }>,
  checkedAt: Date | null
): {
  piecesGood: number | null;
  piecesDamaged: number | null;
  piecesWrong: number | null;
  piecesMissing: number | null;
  receivedValuePhp: number | null;
  itemCheckedAt: Date | null;
} {
  if (!checks.length) {
    return {
      piecesGood: null,
      piecesDamaged: null,
      piecesWrong: null,
      piecesMissing: null,
      receivedValuePhp: null,
      itemCheckedAt: null,
    };
  }
  let value = 0;
  const out = { piecesGood: 0, piecesDamaged: 0, piecesWrong: 0, piecesMissing: 0 };
  for (const c of checks) {
    out.piecesGood += c.goodQty;
    out.piecesDamaged += c.damagedQty;
    out.piecesWrong += c.wrongQty;
    out.piecesMissing += c.missingQty;
    const price = c.unitPricePhp === null ? null : Number(String(c.unitPricePhp));
    if (price !== null && Number.isFinite(price)) value += (c.goodQty + c.damagedQty) * price;
  }
  return { ...out, receivedValuePhp: Math.round(value * 100) / 100, itemCheckedAt: checkedAt };
}
