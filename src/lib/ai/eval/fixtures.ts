import type { OrderPanel } from "@/lib/chats/types";
import { mapTikTokListing, type ListingFacts } from "../listing";
import type { PromptAnswer } from "../prompt";

/**
 * Fixed data for the assistant test run, so results can be compared run to
 * run. Shop answers are the owner's answers as of 2026-11-24; listings are
 * trimmed copies of the shop's four best sellers (stock as seen that day).
 * `npm run ai:eval -- --live-answers` uses the answers saved in Settings instead.
 */

export const EVAL_ANSWERS: PromptAnswer[] = [
  { topic: "cod", title: "COD available", answer: "Yes po, available ang COD (Cash on Delivery). Piliin lang po ang COD sa checkout at magbayad pagdating ng rider." },
  { topic: "never", title: "Never say or promise", answer: "Huwag mag-promise ng discount, freebie, voucher o refund sa chat; ang TikTok ang nagdedesisyon sa refunds. Huwag magbigay ng GCash, phone number, email o link sa labas ng TikTok. Huwag manghula ng stock o delivery date na wala sa order details." },
  { topic: "other", title: "Change size, color or address", answer: "Kung hindi pa po naipapadala ang order, pwede pa pong mag-request ng cancel sa TikTok app at mag-order ulit ng tamang size, kulay o address. Kapag na-ship na po, hindi na ito mapapalitan." },
  { topic: "product", title: "Fabric and details", answer: "Nakasulat po sa product title at description ang tela ng bawat item, halimbawa corduroy, jacquard brocade o cotton knit. Kung may tanong po kayo sa isang specific na item, i-send lang po ang product at sasagutin namin." },
  { topic: "returns", title: "How to return or refund", answer: "Pwede po mag-request ng return o refund sa TikTok app within 30 days mula nang ma-deliver ang order. Buksan lang po ang order sa My Orders at i-tap ang Return/Refund, at mag-attach ng malinaw na photo o video ng item. Ang TikTok po ang magre-review ng request." },
  { topic: "shipping", title: "Shipping and delivery time", answer: "Order today, ship tomorrow po. Kadalasan po natatanggap within 2-7 days depende sa lugar, at minsan mas matagal po sa malalayong probinsya. Makikita po ang tracking sa TikTok app, sa My Orders." },
  { topic: "size", title: "How to pick a size", answer: "Nakalagay po sa bawat variation ang sukat in inches, waist para sa skirts at shorts (hal. Medium 27-31 waist) at bust para sa tops (hal. L fit 32-36 bust). Sukatin lang po ang waist o bust niyo at piliin ang size na pasok sa range. Kung nasa pagitan po kayo ng dalawang size, mas okay po ang mas malaki para komportable." },
  { topic: "size", title: "Plus sizes", answer: "May plus sizes din po kami: L-2XL, L-XL at 2XL-3XL sa ibang items, at One size (fit M-2XL) sa ibang terno. Makikita po ang available na sizes sa variation ng bawat item." },
];

const sku = (color: string, size: string, price: number, qty: number) => ({
  sales_attributes: [
    { name: "Color", value_name: color },
    { name: "Size", value_name: size },
  ],
  price: { sale_price: String(price) },
  inventory: [{ quantity: qty }],
});

const RAW_LISTINGS = {
  skorts: {
    id: "eval-skorts",
    title: "Kyna PH Jacquard Brocade Skorts for Women High Waist A-Line Mini Skirt with Elastic Waist",
    description:
      "<p>This high-waist A-line mini skirt is perfect for casual summer wear. It's machine washable and features an elastic waist for comfort.</p>" +
      "<p>✅ Onhand and ready to ship</p><p>🚚 Order today, ship tomorrow</p><p>⚠ Colors may vary slightly due to lighting or screen settings.</p>",
    product_attributes: [
      { name: "Washing instructions", values: [{ name: "Machine washable" }] },
      { name: "Fit", values: [{ name: "A-line" }] },
      { name: "Material", values: [{ name: "Jacquard" }] },
      { name: "Skirt length", values: [{ name: "Mini" }] },
      { name: "Closure type", values: [{ name: "Elastic waist" }] },
    ],
    skus: [
      sku("JB Black", "M (27-30)", 299, 117),
      sku("JB Black", "L (31-34)", 299, 85),
      sku("JB Black", "XL (35-38)", 299, 55),
      sku("JB Black", "2XL (39-42)", 299, 58),
      sku("JB Navyblue", "M (27-30)", 299, 98),
      sku("JB Navyblue", "L (31-34)", 299, 4),
      sku("JB Navyblue", "XL (35-38)", 299, 0),
      sku("JB Navyblue", "2XL (39-42)", 299, 21),
    ],
  },
  strawberrySet: {
    id: "eval-strawberry-set",
    title: "Kyna Top Skirt Coords - Floral Print, Short Sleeve, Round Neck, Casual Style",
    description:
      "<p>Strawberry Floral Skirt Set</p><p>This 2-piece set features a cute strawberry and flower print on soft ribbed fabric, with a fitted short-sleeve top and a flared skirt with an adjustable drawstring waist.</p>" +
      "<p>Fabric: Ribbed knit</p><p>Set: Top + Skirt</p>",
    skus: [
      sku("RB Print 1", "M (27-32)", 299, 0),
      sku("RB Print 1", "L (33-36)", 299, 33),
      sku("RB Print 1", "XL (36-40)", 299, 51),
      sku("RB Print 2", "M (27-32)", 299, 0),
      sku("RB Print 2", "L (33-36)", 299, 56),
      sku("RB Print 2", "XL (36-40)", 299, 64),
    ],
  },
  floralSkort: {
    id: "eval-floral-skort",
    title: "Women's Casual Floral Skort Summer with inner short A-Line Mini Skirt Shorts",
    description: "<p>Breathable and lightweight fabric with eyelet detail.</p><p>Size Options: Medium, XL</p>",
    product_attributes: [{ name: "Material", values: [{ name: "Cotton" }, { name: "Nylon" }] }],
    skus: [
      sku("White", "Medium (23-31)", 299, 73),
      sku("White", "XL (30-40)", 299, 136),
      sku("Print #2", "Medium (23-31)", 299, 15),
      sku("Print #2", "XL (30-40)", 299, 0),
    ],
  },
  longSkirt: {
    id: "eval-long-skirt",
    title: "Women's Palda Long with inner Mini Skirt High Waist Stretch Ruffle Skater Skirt",
    description:
      "<p>Made from soft ribbed stretch fabric with a high-waist elastic waistband and a double-tier ruffle design.</p>" +
      "<p>Size Guide</p><p>Medium</p><p>Waist: 25–30 inches</p><p>Length: 34 inches</p><p>XL</p><p>Waist: 31–40 inches</p><p>Length: 35 inches</p>",
    product_attributes: [{ name: "Material", values: [{ name: "knitted" }] }],
    skus: [
      sku("Long Black", "Medium 27-34", 399, 0),
      sku("Long Black", "XL 34-38", 399, 147),
      sku("Long Army", "Medium 27-34", 399, 18),
      sku("Long Army", "XL 34-38", 399, 8),
    ],
  },
} as const;

export type EvalListingKey = keyof typeof RAW_LISTINGS;

export const EVAL_LISTINGS: Record<EvalListingKey, ListingFacts> = Object.fromEntries(
  Object.entries(RAW_LISTINGS).map(([k, raw]) => [k, mapTikTokListing(raw as unknown as Record<string, unknown>, "live")])
) as Record<EvalListingKey, ListingFacts>;

export type EvalOrderKey = "shipped" | "toShip" | "delivered";

export const EVAL_ORDERS: Record<EvalOrderKey, OrderPanel> = {
  shipped: {
    orderSn: "578111122223333444",
    photoUrl: null,
    itemName: "Kyna PH Jacquard Brocade Skorts",
    variation: "JB Black, M (27-30)",
    moreItems: 0,
    statusLabel: "On the way",
    carrier: "J&T Express",
    trackingNumber: "732600011122",
  },
  toShip: {
    orderSn: "578111122225555666",
    photoUrl: null,
    itemName: "Kyna Top Skirt Coords",
    variation: "RB Print 2, L (33-36)",
    moreItems: 1,
    statusLabel: "Getting ready to ship",
    carrier: null,
    trackingNumber: null,
  },
  delivered: {
    orderSn: "578111122227777888",
    photoUrl: null,
    itemName: "Women's Palda Long",
    variation: "Long Army, XL 34-38",
    moreItems: 0,
    statusLabel: "Delivered",
    carrier: "J&T Express",
    trackingNumber: "732600099988",
  },
};
