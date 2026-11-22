/**
 * Minimal text-only PDF writer (Helvetica, one or more pages). Enough for test
 * prints and pick lists without adding a PDF library. Shipping labels come as
 * PDFs from Shopee/TikTok and are passed through untouched.
 *
 * Default page is 4x6 in (288 x 432 pt), the thermal label size.
 */
export interface PdfOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  margin?: number;
}

/** PDF string literal in WinAnsi: escape \ ( ), drop control chars, '?' for anything outside Latin-1. */
export function pdfEscape(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 32) continue;
    const c = code > 255 ? "?" : ch;
    out += c === "\\" || c === "(" || c === ")" ? `\\${c}` : c;
  }
  return out;
}

/** Characters above Latin-1 that the WinAnsi encoding (and pdf-lib's standard fonts) can still draw. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/**
 * Plain text that pdf-lib's Helvetica can encode: control chars dropped,
 * anything outside WinAnsi (emoji, CJK, C1 controls) turned into '?'.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || code === 127) continue;
    if (code < 127 || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (code === 0xfe0f || code === 0x200d) continue; // emoji joiners: drop silently
    else out += "?";
  }
  return out.replace(/\?{2,}/g, "?");
}

export function buildPdf(pages: string[][], opts: PdfOptions = {}): Buffer {
  const W = opts.width ?? 288;
  const H = opts.height ?? 432;
  const size = opts.fontSize ?? 11;
  const margin = opts.margin ?? 18;
  const leading = (size * 1.3).toFixed(1);

  const objs: string[] = [];
  const pageIds: number[] = [];
  let next = 4;
  for (const lines of pages.length ? pages : [[""]]) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const body = lines.map((l) => `(${pdfEscape(l)}) Tj T*`).join("\n");
    const stream = `BT /F1 ${size} Tf ${leading} TL ${margin} ${H - margin - size} Td\n${body}\nET`;
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  }
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < next; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
