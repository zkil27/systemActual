/**
 * READ-ONLY. Downloads the shop's real label for an order the app already
 * shipped, so we can check what is on page 1 (the waybill: QR code, barcodes,
 * sort code, address) and what runs onto page 2+ (the product list).
 * Also writes the "one sticker per parcel" output next to it.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/fetch-label.ts <orderSn>     (fetch from Shopee/TikTok)
 *   npx tsx scripts/fetch-label.ts <label.pdf> [itemCount=30]    (preview a PDF you already have)
 *
 * Writes to label-samples/ (git-ignored: labels hold buyer names and addresses).
 * Nothing is changed on the shops: it only reads a label that already exists.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { assembleWaybillSources, composeWaybills, type WaybillParcel } from "../src/lib/print/waybill";

const OUT = path.join(process.cwd(), "label-samples");

async function describe(name: string, pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const sizes = doc.getPages().map((p, i) => {
    const { width, height } = p.getSize();
    return `  page ${i + 1}: ${width.toFixed(1)} x ${height.toFixed(1)} pt (${((width / 72) * 25.4).toFixed(0)} x ${((height / 72) * 25.4).toFixed(0)} mm)`;
  });
  console.log(`${name}: ${doc.getPageCount()} page(s)\n${sizes.join("\n")}`);
}

async function writePair(base: string, pdf: Uint8Array, parcel: WaybillParcel) {
  const rawPath = path.join(OUT, `${base}.pdf`);
  await writeFile(rawPath, pdf);
  await describe(rawPath, pdf);

  const sources = await assembleWaybillSources(pdf, [parcel], async () => pdf);
  const composed = await composeWaybills(sources);
  const outPath = path.join(OUT, `${base}.waybill.pdf`);
  await writeFile(outPath, composed);
  await describe(outPath, composed);
  console.log(sources[0].overflowed ? "  -> label ran over: page 1 kept + packing slip\n" : "  -> one page: printed as is\n");
}

async function fromFile(file: string, count: number) {
  const pdf = await readFile(file);
  const lines = Array.from({ length: count }, (_, i) => ({
    name: `Sample Garment Style ${i + 1}`,
    variationName: `${["Black", "White", "Beige"][i % 3]}, ${["S", "M", "L", "XL"][i % 4]}`,
    quantity: 1 + (i % 3),
  }));
  const base = path.basename(file).replace(/\.pdf$/i, "");
  await writePair(base, pdf, { orderSn: "PREVIEW000000", trackingNumber: null, lines });
}

async function fromShop(orderSn: string) {
  // Loaded here so previewing a local PDF needs no database or shop keys.
  const { prisma } = await import("../src/lib/prisma");
  const { fetchLabelPdf } = await import("../src/lib/shipping/labels");

  const order = await prisma.order.findFirst({
    where: { orderSn },
    select: {
      platform: true,
      orderSn: true,
      lines: { select: { name: true, variationName: true, quantity: true } },
      packages: { select: { id: true, packageNumber: true, trackingNumber: true } },
    },
  });
  if (!order) throw new Error(`No order ${orderSn} in the database.`);
  if (!order.packages.length) throw new Error(`Order ${orderSn} has no parcels yet.`);
  console.log(`${order.platform} ${order.orderSn}: ${order.lines.length} line(s), ${order.packages.length} parcel(s)\n`);

  for (const pkg of order.packages) {
    const pdf = await fetchLabelPdf(pkg.id);
    await writePair(`${order.platform.toLowerCase()}-${order.orderSn}-${pkg.packageNumber}`, pdf, {
      orderSn: order.orderSn,
      trackingNumber: pkg.trackingNumber,
      lines: order.lines,
      parcelsInOrder: order.packages.length,
    });
  }
  await prisma.$disconnect();
}

async function main() {
  const [arg, countArg] = process.argv.slice(2);
  if (!arg) {
    console.error("Usage: npx tsx --env-file=.env scripts/fetch-label.ts <orderSn | label.pdf> [itemCount]");
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  if (/\.pdf$/i.test(arg)) await fromFile(arg, Number(countArg ?? 30));
  else await fromShop(arg);
  console.log(`Open the files in ${OUT}. Check page 1 has the whole waybill (QR code, barcodes, sort code, address, COD).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
