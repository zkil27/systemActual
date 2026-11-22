/**
 * One sticker per parcel, with the shop's label left exactly as Shopee/TikTok
 * made it. Shopee and TikTok both forbid changing or adding to the waybill
 * (couriers may reject it), and its QR code and barcodes must stay whole.
 *
 * A many-item order makes the shop's label run onto a second page (the product
 * list carrying on). We copy only page 1, untouched, and add our own packing
 * slip page right after it with the full item list. The slip goes inside the
 * parcel, never on it.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { toWinAnsi } from "./pdf";
import { shortenGarmentName } from "../waves/pick-list";

export interface WaybillLine {
  name: string;
  variationName?: string | null;
  quantity: number;
}

export interface WaybillParcel {
  orderSn: string;
  trackingNumber: string | null;
  lines: WaybillLine[];
  /** Parcels the order was split into. Lines are per order, so >1 means the slip lists the whole order. */
  parcelsInOrder?: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Text width in points at a font size. */
export type Measure = (text: string, size: number) => number;

export interface FittedList {
  size: number;
  columns: number;
  rows: Array<{ text: string; x: number; y: number }>;
  /** Item rows that didn't fit and are summed up in the "+N more" row. */
  hiddenItems: number;
}

/** Tried in order; the first that holds every row wins. Single column first, it reads best. */
const FIT_CANDIDATES: ReadonlyArray<readonly [size: number, columns: number]> = [
  [9, 1],
  [8, 1],
  [7, 1],
  [8, 2],
  [7, 2],
  [6, 2],
];
const LEADING = 1.25;
const COLUMN_GAP = 6;

/** "2× Linen Polo · Black, M", identical lines merged. */
export function itemRows(lines: WaybillLine[]): Array<{ text: string; qty: number }> {
  const merged = new Map<string, { name: string; variation: string; qty: number }>();
  for (const line of lines) {
    const name = toWinAnsi(shortenGarmentName(line.name) || line.name).trim();
    const variation = toWinAnsi(line.variationName ?? "").trim();
    const key = `${name}\u0000${variation}`;
    const row = merged.get(key);
    if (row) row.qty += line.quantity;
    else merged.set(key, { name, variation, qty: line.quantity });
  }
  return [...merged.values()].map((r) => ({
    text: `${r.qty}× ${r.name}${r.variation ? ` · ${r.variation}` : ""}`,
    qty: r.qty,
  }));
}

/** Cuts text to fit a width, ending in "…". */
export function clipText(text: string, width: number, size: number, measure: Measure): string {
  if (measure(text, size) <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}…`, size) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/**
 * Lays the item list out inside a fixed box. Never paginates: picks the
 * largest size/column count that holds every row, otherwise fills the box at
 * the smallest size and ends with "+N more (Q pcs) — see pick list".
 */
export function fitItemList(lines: WaybillLine[], box: Box, measure: Measure): FittedList {
  const entries = itemRows(lines);
  const perColumn = (size: number) => Math.max(0, Math.floor(box.height / (size * LEADING)));

  const place = (texts: string[], size: number, columns: number, hiddenItems: number): FittedList => {
    const per = perColumn(size);
    const colWidth = (box.width - COLUMN_GAP * (columns - 1)) / columns;
    const top = box.y + box.height - size;
    return {
      size,
      columns,
      hiddenItems,
      rows: texts.map((text, i) => {
        const col = Math.floor(i / per);
        const row = i % per;
        return {
          text: clipText(text, colWidth, size, measure),
          x: box.x + col * (colWidth + COLUMN_GAP),
          y: top - row * size * LEADING,
        };
      }),
    };
  };

  for (const [size, columns] of FIT_CANDIDATES) {
    if (perColumn(size) * columns >= entries.length) {
      return place(entries.map((e) => e.text), size, columns, 0);
    }
  }

  const [size, columns] = FIT_CANDIDATES[FIT_CANDIDATES.length - 1];
  const capacity = perColumn(size) * columns;
  if (capacity <= 0) return { size, columns, rows: [], hiddenItems: entries.length };
  const shown = entries.slice(0, capacity - 1);
  const hidden = entries.slice(capacity - 1);
  const hiddenPcs = hidden.reduce((sum, e) => sum + e.qty, 0);
  return place(
    [...shown.map((e) => e.text), `+${hidden.length} more (${hiddenPcs} pcs) — see pick list`],
    size,
    columns,
    hidden.length
  );
}

const MARGIN = 12;
const HEADER_SIZE = 11;
const META_SIZE = 8;

/** "Order …123456 · Tracking …654321 · 14 pcs" */
export function slipMetaLine(parcel: WaybillParcel): string {
  const pcs = parcel.lines.reduce((sum, l) => sum + l.quantity, 0);
  const parts = [`Order …${parcel.orderSn.slice(-6)}`];
  if (parcel.trackingNumber) parts.push(`Tracking …${parcel.trackingNumber.slice(-6)}`);
  parts.push(`${pcs} pcs`);
  const split = (parcel.parcelsInOrder ?? 1) > 1 ? ` (whole order, ${parcel.parcelsInOrder} parcels)` : "";
  return toWinAnsi(parts.join(" · ") + split);
}

/** Our packing slip: same size as the label, full item list, nothing that looks like a waybill. */
function drawPackingSlip(page: PDFPage, parcel: WaybillParcel, font: PDFFont, bold: PDFFont) {
  const { width: W, height: H } = page.getSize();
  const black = rgb(0, 0, 0);
  const inner = W - MARGIN * 2;
  const boldWidth: Measure = (t, s) => bold.widthOfTextAtSize(t, s);

  let y = H - MARGIN - HEADER_SIZE;
  page.drawText(clipText("PACKING SLIP · PUT INSIDE PARCEL", inner, HEADER_SIZE, boldWidth), {
    x: MARGIN,
    y,
    size: HEADER_SIZE,
    font: bold,
    color: black,
  });
  y -= META_SIZE * 1.8;
  page.drawText(clipText(slipMetaLine(parcel), inner, META_SIZE, boldWidth), {
    x: MARGIN,
    y,
    size: META_SIZE,
    font: bold,
    color: black,
  });
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 0.75, color: black });

  const listBox: Box = { x: MARGIN, y: MARGIN, width: inner, height: y - 6 - MARGIN };
  const fitted = fitItemList(parcel.lines, listBox, (t, s) => font.widthOfTextAtSize(t, s));
  for (const row of fitted.rows) {
    page.drawText(row.text, { x: row.x, y: row.y, size: fitted.size, font, color: black });
  }
}

export interface WaybillSource {
  parcel: WaybillParcel;
  /** The shop's label PDF this parcel's label comes from. */
  pdf: Uint8Array;
  /** Page of `pdf` holding this parcel's label (its first page, if it ran over). */
  pageIndex: number;
  /** The shop's label for this parcel was more than one page; a packing slip replaces the rest. */
  overflowed: boolean;
}

/**
 * Each parcel's label page copied as-is (same size, QR code and barcodes
 * untouched), followed by a packing slip when its label ran over. Throws
 * rather than print something unexpected; the caller then prints the shop PDF.
 */
export async function composeWaybills(sources: WaybillSource[]): Promise<Buffer> {
  if (!sources.length) throw new Error("No labels to compose.");
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const loaded = new Map<Uint8Array, PDFDocument>();

  for (const { parcel, pdf, pageIndex, overflowed } of sources) {
    let src = loaded.get(pdf);
    if (!src) {
      src = await PDFDocument.load(pdf, { ignoreEncryption: true });
      loaded.set(pdf, src);
    }
    if (pageIndex >= src.getPageCount()) throw new Error(`Label PDF has no page ${pageIndex + 1}.`);

    const [label] = await out.copyPages(src, [pageIndex]);
    out.addPage(label);

    if (overflowed) {
      const { width, height } = label.getSize();
      drawPackingSlip(out.addPage([width, height]), parcel, font, bold);
    }
  }

  const expected = sources.length + sources.filter((s) => s.overflowed).length;
  if (out.getPageCount() !== expected) {
    throw new Error(`Waybill has ${out.getPageCount()} pages, expected ${expected}.`);
  }
  return Buffer.from(await out.save());
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function pageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount();
}

/**
 * Matches label pages to parcels. A merged batch PDF maps 1:1 only when every
 * label is one page; if any ran over, the split is unknowable, so each
 * parcel's own label is fetched again (5 at a time).
 */
export async function assembleWaybillSources(
  platformPdf: Uint8Array,
  parcels: WaybillParcel[],
  refetch: (index: number) => Promise<Uint8Array>
): Promise<WaybillSource[]> {
  const count = await pageCount(platformPdf);
  if (parcels.length === 1) {
    return [{ parcel: parcels[0], pdf: platformPdf, pageIndex: 0, overflowed: count > 1 }];
  }
  if (count === parcels.length) {
    return parcels.map((parcel, i) => ({ parcel, pdf: platformPdf, pageIndex: i, overflowed: false }));
  }
  const pdfs = await mapLimit(
    parcels.map((_, i) => i),
    5,
    refetch
  );
  const counts = await Promise.all(pdfs.map(pageCount));
  return parcels.map((parcel, i) => ({ parcel, pdf: pdfs[i], pageIndex: 0, overflowed: counts[i] > 1 }));
}
