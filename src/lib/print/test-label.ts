/**
 * The "Test print" page: the size of a TikTok label (105 x 148 mm), with an
 * edge border, rulers, corner names and a 40 mm square, so one sticker shows
 * whether the printer cuts anything off and how much it scales. No order,
 * tracking number or buyer on it.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { toWinAnsi } from "./pdf";

const mm = (v: number) => (v / 25.4) * 72;

/** Same page size as TikTok's label PDF (105 x 148 mm). */
export const TEST_LABEL_MM = { width: 105, height: 148 } as const;

export async function buildTestLabelPdf(opts: { sentAt: string; printerName?: string | null }): Promise<Buffer> {
  const W = mm(TEST_LABEL_MM.width);
  const H = mm(TEST_LABEL_MM.height);
  const doc = await PDFDocument.create();
  doc.setTitle("Kyna Ops test print");
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([W, H]);
  const k = rgb(0, 0, 0);

  const text = (t: string, x: number, yFromTop: number, size: number, font: PDFFont = f) =>
    p.drawText(toWinAnsi(t), { x, y: H - mm(yFromTop), size, font, color: k });
  const center = (t: string, yFromTop: number, size: number, font: PDFFont = f) =>
    text(t, (W - font.widthOfTextAtSize(toWinAnsi(t), size)) / 2, yFromTop, size, font);
  const right = (t: string, yFromTop: number, size: number, font: PDFFont = f) =>
    text(t, W - mm(9) - font.widthOfTextAtSize(t, size), yFromTop, size, font);

  // Border right on the page edge: a missing side means that side was cut off.
  p.drawRectangle({ x: 0.75, y: 0.75, width: W - 1.5, height: H - 1.5, borderWidth: 1.5, borderColor: k });

  // Rulers: ticks every 5 mm on all four edges, numbers every 10 mm.
  for (let v = 0; v <= TEST_LABEL_MM.width; v += 5) {
    const len = mm(v % 10 === 0 ? 4 : 2);
    p.drawLine({ start: { x: mm(v), y: H }, end: { x: mm(v), y: H - len }, thickness: 0.6, color: k });
    p.drawLine({ start: { x: mm(v), y: 0 }, end: { x: mm(v), y: len }, thickness: 0.6, color: k });
    if (v % 10 === 0 && v > 0 && v < TEST_LABEL_MM.width) text(String(v), mm(v) - 4, 7.5, 6);
  }
  for (let v = 0; v <= TEST_LABEL_MM.height; v += 5) {
    const len = mm(v % 10 === 0 ? 4 : 2);
    p.drawLine({ start: { x: 0, y: H - mm(v) }, end: { x: len, y: H - mm(v) }, thickness: 0.6, color: k });
    p.drawLine({ start: { x: W, y: H - mm(v) }, end: { x: W - len, y: H - mm(v) }, thickness: 0.6, color: k });
    if (v % 10 === 0 && v > 0 && v < TEST_LABEL_MM.height) text(String(v), mm(5), v + 0.7, 6);
  }

  text("TOP LEFT", mm(9), 13, 7, b);
  right("TOP RIGHT", 13, 7, b);
  text("BOTTOM LEFT", mm(9), 140, 7, b);
  right("BOTTOM RIGHT", 140, 7, b);

  center("TEST PRINT", 30, 22, b);
  center("NOT A WAYBILL - DO NOT SHIP", 37, 10, b);
  center("Same size as a TikTok label: 105 x 148 mm", 43, 8);

  // Scale check: 40 mm on the page.
  const s = mm(40);
  p.drawRectangle({ x: (W - s) / 2, y: H - mm(95), width: s, height: s, borderWidth: 1.5, borderColor: k });
  center("Measure this square on the sticker:", 52, 8);
  center("40 mm = 100%", 68, 9, b);
  center("about 39 mm = fitted to 4x6 (OK)", 74, 7);
  center("about 29 mm = paper set to 76x130", 79, 7);
  center("(wrong - change to 4 x 6)", 83, 7);

  const checks = [
    "CHECK:",
    "1. The thick outer line shows on ALL 4 sides.",
    "2. All 4 corner names are printed.",
    "If a side is missing: set the printer's default",
    "paper to 4 x 6 in Printing preferences.",
  ];
  checks.forEach((t, i) => text(t, mm(10), 103 + i * 4.6, 7.5, i === 0 ? b : f));
  text(`Sent: ${opts.sentAt}`, mm(10), 129, 7);
  text(`Printer: ${opts.printerName || "default printer"}`, mm(10), 133.5, 7);

  return Buffer.from(await doc.save());
}
