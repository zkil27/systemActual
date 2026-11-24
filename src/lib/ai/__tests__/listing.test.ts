import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    listingVariant: {
      findMany: vi.fn(async () => [
        { name: "Stored Skirt", variationName: "Black, M (27-30)", availableStock: 3 },
        { name: "Stored Skirt", variationName: "Black, L (31-34)", availableStock: 0 },
      ]),
    },
  },
}));

import { checkReply } from "../output-check";
import { buildPrompt, groundingText } from "../prompt";
import { cleanDescription, clearListingCache, getListingFacts, listingBlock, mapTikTokListing, stockWord } from "../listing";

// Trimmed from a real Kyna TikTok listing (Get Product).
const SKORTS = {
  id: "1729000000000000001",
  title: "Kyna PH Jacquard Brocade Skorts High Waist A-Line Mini Skirt",
  description:
    "<p>✨ Elevate your summer wardrobe with the Jacquard Brocade Skorts.</p><p>It's machine washable and features an elastic waist.</p>" +
    "<p>✅ High Quality Product</p><p>✅ Onhand and ready to ship</p><p>We assure you of the lowest price without compromising quality.</p>" +
    "<p>🚚 Order today, ship tomorrow</p><p>📦 Receive within 2-7 days</p><p>📏 Size Guide</p><p>Medium</p><p>Waist: 25–30 inches</p><p>Length: 17 inches</p><p>Free size fits most</p>",
  product_attributes: [
    { name: "Material", values: [{ name: "Jacquard" }] },
    { name: "Fit", values: [{ name: "A-line" }] },
    { name: "Size type", values: [{ name: "Juniors" }, { name: "Plus size" }] },
  ],
  skus: [
    { sales_attributes: [{ name: "Color", value_name: "JB Black" }, { name: "Size", value_name: "M (27-30)" }], price: { sale_price: "299" }, inventory: [{ quantity: 117 }] },
    { sales_attributes: [{ name: "Color", value_name: "JB Black" }, { name: "Size", value_name: "L (31-34)" }], price: { sale_price: "299" }, inventory: [{ quantity: 85 }] },
    { sales_attributes: [{ name: "Color", value_name: "JB Navyblue" }, { name: "Size", value_name: "L (31-34)" }], price: { sale_price: "299" }, inventory: [{ quantity: 4 }] },
    { sales_attributes: [{ name: "Color", value_name: "JB Navyblue" }, { name: "Size", value_name: "XL (35-38)" }], price: { sale_price: "299" }, inventory: [{ quantity: 0 }] },
  ],
};

// A real listing names its color attribute "size|colour".
const ODD = {
  id: "1729000000000000002",
  title: "Floral Skort",
  description: "",
  skus: [
    { sales_attributes: [{ name: "size|colour", value_name: "white" }, { name: "Size", value_name: "XL (30-40)" }], price: { sale_price: "299" }, inventory: [{ quantity: 136 }] },
    { sales_attributes: [{ name: "size|colour", value_name: "Print #2" }, { name: "Size", value_name: "Medium (23-31)" }], price: { sale_price: "349" }, inventory: [{ quantity: 15 }] },
  ],
};

describe("listing facts", () => {
  beforeEach(() => clearListingCache());

  it("uses the owner's stock words, never counts", () => {
    expect(stockWord(117)).toBe("available");
    expect(stockWord(10)).toBe("available");
    expect(stockWord(4)).toBe("few left");
    expect(stockWord(0)).toBe("sold out");
    expect(stockWord(null)).toBeNull();
  });

  it("keeps product lines and drops shipping, policy and sales talk", () => {
    const d = cleanDescription(SKORTS.description);
    expect(d).toContain("machine washable");
    expect(d).toContain("Waist: 25–30 inches");
    expect(d).toContain("Length: 17 inches");
    expect(d).toContain("Free size fits most");
    expect(d).not.toMatch(/ship|Receive|lowest price|Onhand|High Quality/i);
  });

  it("rejoins wrapped lines and drops whole sales sentences", () => {
    const wrapped =
      "⚠ Colors may vary slightly due to lighting or screen settings. Consider the\nprice and quality range when purchasing. We offer the best value without\nsacrificing quality.\nSoft ribbed\nstretch fabric";
    expect(cleanDescription(wrapped)).toBe("⚠ Colors may vary slightly due to lighting or screen settings.\nSoft ribbed stretch fabric");
  });

  it("reads colors, sizes, prices and stock", () => {
    const l = mapTikTokListing(SKORTS);
    expect(l.attributes).toEqual(["Material: Jacquard", "Fit: A-line", "Size type: Juniors/Plus size"]);
    expect(l.skus[2]).toEqual({ color: "JB Navyblue", size: "L (31-34)", pricePhp: 299, stock: 4 });
    expect(mapTikTokListing(ODD).skus[0]).toMatchObject({ color: "white", size: "XL (30-40)" });
  });

  it("writes one line per color with stock words and no counts", () => {
    const block = listingBlock(mapTikTokListing(SKORTS));
    expect(block).toContain("Price: ₱299 for every color and size");
    expect(block).toContain("- JB Black: M (27-30): available, L (31-34): available");
    expect(block).toContain("- JB Navyblue: L (31-34): few left, XL (35-38): sold out");
    expect(block).toContain("stock checked just now");
    expect(block).not.toMatch(/\b(117|85)\b/);
    // Different prices are shown per size.
    expect(listingBlock(mapTikTokListing(ODD))).toContain("- Print #2: Medium (23-31) ₱349: available");
  });

  it("reads live, caches, and falls back to the last stock import", async () => {
    const fetcher = vi.fn(async () => SKORTS);
    const a = await getListingFacts({ shopConnectionId: "s1", productId: SKORTS.id, fetcher, now: 1_000 });
    const b = await getListingFacts({ shopConnectionId: "s1", productId: SKORTS.id, fetcher, now: 60_000 });
    expect(a?.source).toBe("live");
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => {
      throw new Error("TikTok down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stored = await getListingFacts({ shopConnectionId: "s1", productId: "other", fetcher: down });
    expect(stored).toMatchObject({ source: "stored", title: "Stored Skirt" });
    expect(stored?.skus.map((s) => [s.size, stockWord(s.stock)])).toEqual([
      ["M (27-30)", "few left"],
      ["L (31-34)", "sold out"],
    ]);
    expect(listingBlock(stored!)).toContain("from the last stock check");
  });
});

describe("prompt and checks with a listing", () => {
  const listings = [mapTikTokListing(SKORTS)];
  const answers = [{ topic: "shipping", title: "Shipping", answer: "Order today, ship tomorrow po. Natatanggap within 2-7 days." }];
  const messages = [{ sender: "BUYER" as const, kind: "TEXT" as const, text: "may navy blue L pa po? 29 waist ko", card: null }];

  it("adds PRODUCT DETAILS after the order", () => {
    const [, user] = buildPrompt({ answers, order: null, messages, listings });
    expect(user.content).toMatch(/ORDER:[\s\S]*PRODUCT DETAILS:\n"Kyna PH Jacquard[\s\S]*CHAT/);
  });

  const facts = groundingText({ answers, order: null, messages, listings });

  it("allows stock words and listing numbers when the listing is known", () => {
    expect(checkReply("Opo, few left na lang po ang Navy Blue L (31-34), check out na po agad!", { facts, stockKnown: true })).toEqual({ ok: true });
    expect(checkReply("May stock pa po ang Black M, ₱299 lang po.", { facts, stockKnown: true })).toEqual({ ok: true });
    // Same reply without a listing is a stock guess.
    expect(checkReply("May stock pa po ang Black M.", { facts: "", stockKnown: false })).toMatchObject({ reason: "stock" });
  });

  it("still blocks counts and holding items", () => {
    expect(checkReply("4 pcs na lang po ang Navy Blue L.", { facts, stockKnown: true })).toMatchObject({ reason: "number" });
    expect(checkReply("Itatabi ko na po para sa inyo.", { facts, stockKnown: true })).toMatchObject({ reason: "promise" });
    expect(checkReply("I can reserve one for you.", { facts, stockKnown: true })).toMatchObject({ reason: "promise" });
  });
});
