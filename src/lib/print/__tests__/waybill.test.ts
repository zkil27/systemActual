import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { toWinAnsi } from "@/lib/print/pdf";
import {
  assembleWaybillSources,
  clipText,
  composeWaybills,
  fitItemList,
  itemRows,
  slipMetaLine,
  type Box,
  type Measure,
  type WaybillLine,
  type WaybillParcel,
} from "@/lib/print/waybill";

/** Rough Helvetica stand-in: half the font size per character. */
const measure: Measure = (text, size) => text.length * size * 0.5;
const box: Box = { x: 8, y: 20, width: 272, height: 120 };
const A6: [number, number] = [283.46, 419.53];

function lines(n: number): WaybillLine[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Linen Polo Style ${i + 1}`,
    variationName: `Black, ${["S", "M", "L"][i % 3]}`,
    quantity: 1 + (i % 2),
  }));
}

function expectInsideBox(fit: ReturnType<typeof fitItemList>) {
  for (const row of fit.rows) {
    expect(row.y).toBeGreaterThanOrEqual(box.y);
    expect(row.y + fit.size).toBeLessThanOrEqual(box.y + box.height + 0.001);
    expect(row.x + measure(row.text, fit.size)).toBeLessThanOrEqual(box.x + box.width + 0.001);
  }
}

/** Synthetic shop label: each page carries its own text so we can tell pages apart. */
async function samplePdf(pages: number, size: [number, number] = [288, 432]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage(size).drawText(`LABEL PAGE ${i + 1}`, { x: 20, y: size[1] - 40, size: 14 });
  }
  return Buffer.from(await doc.save());
}

function parcel(n = 3, overrides: Partial<WaybillParcel> = {}): WaybillParcel {
  return { orderSn: "2611220ABCDEF123", trackingNumber: "PH2611229876543", lines: lines(n), ...overrides };
}

describe("toWinAnsi", () => {
  it("keeps Latin-1 and WinAnsi punctuation, replaces the rest", () => {
    expect(toWinAnsi("Niña — 2× “Polo”…")).toBe("Niña — 2× “Polo”…");
    expect(toWinAnsi("Polo 🔥🔥 Shirt 韩版")).toBe("Polo ? Shirt ?");
    expect(toWinAnsi("a\u0000b\u0085c")).toBe("ab?c");
  });
});

describe("itemRows", () => {
  it("merges identical name + variation lines and sums quantity", () => {
    const rows = itemRows([
      { name: "Linen Polo", variationName: "Black, M", quantity: 1 },
      { name: "Linen Polo", variationName: "Black, M", quantity: 2 },
      { name: "Linen Polo", variationName: "White, M", quantity: 1 },
    ]);
    expect(rows).toEqual([
      { text: "3× Linen Polo · Black, M", qty: 3 },
      { text: "1× Linen Polo · White, M", qty: 1 },
    ]);
  });
});

describe("clipText", () => {
  it("ends cut text with an ellipsis that fits", () => {
    const out = clipText("A very long garment name that will not fit", 60, 8, measure);
    expect(out.endsWith("…")).toBe(true);
    expect(measure(out, 8)).toBeLessThanOrEqual(60);
  });
});

describe("fitItemList", () => {
  it("uses the largest single-column size when few items", () => {
    const fit = fitItemList(lines(1), box, measure);
    expect([fit.size, fit.columns, fit.rows.length, fit.hiddenItems]).toEqual([9, 1, 1, 0]);
    expectInsideBox(fit);
  });

  it.each([8, 25])("fits %i items without hiding any", (n) => {
    const fit = fitItemList(lines(n), box, measure);
    expect(fit.rows).toHaveLength(n);
    expect(fit.hiddenItems).toBe(0);
    expectInsideBox(fit);
  });

  it("goes to two columns before hiding anything", () => {
    expect(fitItemList(lines(25), box, measure).columns).toBe(2);
  });

  it("ends with a '+N more' row when nothing fits, never more rows than the box holds", () => {
    const fit = fitItemList(lines(80), box, measure);
    expect(fit.size).toBe(6);
    expect(fit.hiddenItems).toBeGreaterThan(0);
    expect(fit.rows[fit.rows.length - 1].text).toMatch(/^\+\d+ more \(\d+ pcs\)/);
    expect(fit.rows.length - 1 + fit.hiddenItems).toBe(80);
    expectInsideBox(fit);
  });
});

describe("slipMetaLine", () => {
  it("shows order, tracking tails and piece count, and flags split orders", () => {
    expect(slipMetaLine(parcel(2))).toBe("Order …DEF123 · Tracking …876543 · 3 pcs");
    expect(slipMetaLine(parcel(1, { trackingNumber: null, parcelsInOrder: 2 }))).toBe(
      "Order …DEF123 · 1 pcs (whole order, 2 parcels)"
    );
  });
});

describe("composeWaybills", () => {
  it("prints a one-page label as is: one page, same size, no slip", async () => {
    const label = await samplePdf(1, A6);
    const sources = await assembleWaybillSources(label, [parcel(2)], vi.fn());
    const out = await PDFDocument.load(await composeWaybills(sources));
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getWidth()).toBeCloseTo(A6[0], 1);
    expect(out.getPage(0).getHeight()).toBeCloseTo(A6[1], 1);
  });

  it("keeps only page 1 of a label that ran over, then adds a same-size packing slip", async () => {
    const label = await samplePdf(3, A6);
    const sources = await assembleWaybillSources(label, [parcel(60)], vi.fn());
    expect(sources[0].overflowed).toBe(true);
    const out = await PDFDocument.load(await composeWaybills(sources));
    expect(out.getPageCount()).toBe(2);
    for (const page of out.getPages()) {
      expect(page.getWidth()).toBeCloseTo(A6[0], 1);
      expect(page.getHeight()).toBeCloseTo(A6[1], 1);
    }
  });

  it("takes page 1 itself, never the overflow page", async () => {
    // Page 2 gets a different size so we can tell which one was copied.
    const doc = await PDFDocument.create();
    doc.addPage([288, 432]).drawText("WAYBILL", { x: 20, y: 400, size: 14 });
    doc.addPage([300, 500]).drawText("PRODUCT LIST CONT.", { x: 20, y: 400, size: 14 });
    const label = Buffer.from(await doc.save());
    const out = await PDFDocument.load(
      await composeWaybills([{ parcel: parcel(), pdf: label, pageIndex: 0, overflowed: true }])
    );
    expect(out.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [288, 432],
      [288, 432],
    ]);
  });

  it("doesn't throw on names WinAnsi can't encode", async () => {
    const emoji = parcel(1, { lines: [{ name: "Polo 🔥 韩版", variationName: "黑色", quantity: 1 }] });
    const out = await PDFDocument.load(
      await composeWaybills([{ parcel: emoji, pdf: await samplePdf(2), pageIndex: 0, overflowed: true }])
    );
    expect(out.getPageCount()).toBe(2);
  });
});

describe("test print page", () => {
  it("is one page the size of a TikTok label (105 x 148 mm)", async () => {
    const { buildTestLabelPdf } = await import("@/lib/print/test-label");
    const doc = await PDFDocument.load(await buildTestLabelPdf({ sentAt: "Nov 22, 9:40 PM", printerName: "4BARCODE 4B-2074A" }));
    expect(doc.getPageCount()).toBe(1);
    expect((doc.getPage(0).getWidth() / 72) * 25.4).toBeCloseTo(105, 1);
    expect((doc.getPage(0).getHeight() / 72) * 25.4).toBeCloseTo(148, 1);
  });
});

describe("assembleWaybillSources", () => {
  it("maps a merged batch page-for-page when every label is one page, with no slips", async () => {
    const batch = await samplePdf(3);
    const refetch = vi.fn();
    const sources = await assembleWaybillSources(batch, [parcel(), parcel(), parcel()], refetch);
    expect(sources.map((s) => [s.pageIndex, s.overflowed])).toEqual([
      [0, false],
      [1, false],
      [2, false],
    ]);
    expect(refetch).not.toHaveBeenCalled();
    expect((await PDFDocument.load(await composeWaybills(sources))).getPageCount()).toBe(3);
  });

  it("fetches each parcel's own label when a batch label ran over; only that parcel gets a slip", async () => {
    const batch = await samplePdf(4); // 3 parcels, one label 2 pages long
    const own = [await samplePdf(1), await samplePdf(2), await samplePdf(1)];
    const refetch = vi.fn(async (i: number) => own[i]);
    const sources = await assembleWaybillSources(batch, [parcel(), parcel(40), parcel()], refetch);
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(sources.map((s) => s.overflowed)).toEqual([false, true, false]);
    const out = await PDFDocument.load(await composeWaybills(sources));
    expect(out.getPageCount()).toBe(4); // 3 labels + 1 slip
  });
});

describe("parseJobKinds", () => {
  it("keeps only real job kinds, so a test-only PC can ask for TEST alone", async () => {
    const { parseJobKinds } = await import("@/lib/print/jobs");
    expect(parseJobKinds(["TEST"])).toEqual(["TEST"]);
    expect(parseJobKinds(["TEST", "NOPE"])).toEqual(["TEST"]);
    expect(parseJobKinds(["NOPE"])).toBeUndefined();
    expect(parseJobKinds("TEST")).toBeUndefined();
    expect(parseJobKinds(undefined)).toBeUndefined();
  });
});
