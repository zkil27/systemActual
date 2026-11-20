export interface FashionCatalogItem {
  itemSummary: string;
  variationName: string;
  pricePhp: number;
  unitCostPhp: number;
  imageUrl: string;
}

function makeGarmentSvgDataUri(
  bgHex: string,
  accentHex: string,
  silhouette: "skirt" | "short" | "tee",
  label: string
): string {
  const shape =
    silhouette === "skirt"
      ? `<path d="M38 26 H82 L94 94 H26 Z" fill="${accentHex}" opacity="0.92"/><line x1="48" y1="28" x2="42" y2="94" stroke="${bgHex}" stroke-width="2" opacity="0.45"/><line x1="60" y1="28" x2="60" y2="94" stroke="${bgHex}" stroke-width="2" opacity="0.45"/><line x1="72" y1="28" x2="78" y2="94" stroke="${bgHex}" stroke-width="2" opacity="0.45"/>`
      : silhouette === "short"
      ? `<path d="M34 28 H86 L90 88 H65 L60 66 L55 88 H30 Z" fill="${accentHex}" opacity="0.92"/><line x1="34" y1="39" x2="86" y2="39" stroke="${bgHex}" stroke-width="2" opacity="0.4"/>`
      : `<path d="M40 24 L22 38 L31 52 L40 46 V94 H80 V46 L89 52 L98 38 L80 24 L68 30 H52 Z" fill="${accentHex}" opacity="0.92"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="16" fill="${bgHex}"/>${shape}<text x="60" y="111" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="${accentHex}" opacity="0.85">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const KYNA_FASHION_ITEMS: FashionCatalogItem[] = [
  {
    itemSummary: "Korean Pleated Tennis Skirt",
    variationName: "Black • Medium",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#e2e8f0", "#1e293b", "skirt", "BLACK • M"),
  },
  {
    itemSummary: "Korean Pleated Tennis Skirt",
    variationName: "Cream White • Small",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#fef3c7", "#92400e", "skirt", "CREAM • S"),
  },
  {
    itemSummary: "High-Waist Denim Dolphin Short",
    variationName: "Light Wash • Large",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#dbeafe", "#1d4ed8", "short", "DENIM • L"),
  },
  {
    itemSummary: "High-Waist Linen Trouser Short",
    variationName: "Khaki • Free Size",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#f5f5f4", "#78716c", "short", "KHAKI • FS"),
  },
  {
    itemSummary: "Ribbed Cotton Baby Tee",
    variationName: "Dusty Rose • Free Size",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#fce7f3", "#be185d", "tee", "ROSE • FS"),
  },
  {
    itemSummary: "Oversized Graphic Street Tee",
    variationName: "Sage Green • Free Size",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#dcfce7", "#15803d", "tee", "SAGE • FS"),
  },
  {
    itemSummary: "A-Line Ruched Mini Skirt",
    variationName: "Mocha Brown • Medium",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#ffedd5", "#9a3412", "skirt", "MOCHA • M"),
  },
  {
    itemSummary: "Basic Square-Neck Fitted Top",
    variationName: "Navy Blue • Small",
    pricePhp: 199,
    unitCostPhp: 82,
    imageUrl: makeGarmentSvgDataUri("#e0e7ff", "#3730a3", "tee", "NAVY • S"),
  },
];
