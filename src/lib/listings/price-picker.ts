import type { UnifiedListingItemDto } from "@/lib/listings/service";
import type { PickerOption } from "@/lib/ui/option-picker";

function formatPeso(amount: number): string {
  return Number.isInteger(amount) ? `₱${amount}` : `₱${amount.toFixed(2)}`;
}

function formatPriceSummary(prices: number[], useRange: boolean): string {
  const unique = [...new Set(prices.filter((p) => Number.isFinite(p)))].sort((a, b) => a - b);
  if (unique.length === 0) return "No price";
  if (unique.length === 1) return formatPeso(unique[0]);
  if (unique.length === 2 && !useRange) {
    return `${formatPeso(unique[0])} / ${formatPeso(unique[1])}`;
  }
  return `${formatPeso(unique[0])}–${formatPeso(unique[unique.length - 1])}`;
}

/** Build picker options for choosing which variants of a garment receive a price update. */
export function buildPriceVariantOptions(item: UnifiedListingItemDto): PickerOption[] {
  const allListingPrices = item.variants.flatMap((v) =>
    v.listings.map((l) => l.pricePhp).filter((p): p is number => p !== null)
  );
  const summaryPrices =
    allListingPrices.length > 0
      ? allListingPrices
      : item.sellingPricePhp !== null
        ? [item.sellingPricePhp]
        : [];

  const options: PickerOption[] = [
    {
      value: "",
      label: "All sizes & colours",
      description: `${item.variants.length} variant${item.variants.length === 1 ? "" : "s"}`,
      trailing: formatPriceSummary(summaryPrices, true),
      keywords: "all sizes colours colors variants",
      pinned: true,
    },
  ];

  for (const v of item.variants) {
    const platforms: string[] = [];
    for (const l of v.listings) {
      const name = l.platform === "SHOPEE" ? "Shopee" : "TikTok";
      if (!platforms.includes(name)) platforms.push(name);
    }

    const description =
      v.listings.length === 0
        ? `No linked listing · ${v.onShelfCount} on shelf`
        : v.listings.length === 1
          ? `${platforms[0]} · ${v.onShelfCount} on shelf`
          : `${platforms.join(", ")} (${v.listings.length} listings) · ${v.onShelfCount} on shelf`;

    const prices = v.listings
      .map((l) => l.pricePhp)
      .filter((p): p is number => p !== null);

    options.push({
      value: v.id,
      label: v.label,
      description,
      trailing: formatPriceSummary(prices, false),
      keywords: [
        ...platforms,
        ...v.listings.map((l) => l.shopName),
        `${v.listings.length} listing`,
      ].join(" "),
    });
  }

  return options;
}
