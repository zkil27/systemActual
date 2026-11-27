"use client";

import { useMemo, useState } from "react";
import { Copy, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import type { ShopSummaryDto, UnifiedListingItemDto } from "@/lib/listings/service";
import type { ItemPublishSummary } from "./RetryPublishSheet";

export function ListingsPanel({
  items,
  shops,
  onAddItem,
  onEditPrice,
  onCopyListing,
  onRetryPublish,
}: {
  items: UnifiedListingItemDto[];
  shops: ShopSummaryDto[];
  onAddItem: () => void;
  onEditPrice: (item: UnifiedListingItemDto) => void;
  onCopyListing: (item: UnifiedListingItemDto) => void;
  onRetryPublish: (item: UnifiedListingItemDto, publish: ItemPublishSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [mismatchOnly, setMismatchOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (mismatchOnly && !item.hasPriceMismatch) return false;
      if (!q) return true;
      return (
        item.garmentName.toLowerCase().includes(q) ||
        item.variants.some((v) => v.label.toLowerCase().includes(q))
      );
    });
  }, [items, query, mismatchOnly]);

  const mismatchCount = useMemo(
    () => items.filter((i) => i.hasPriceMismatch).length,
    [items]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            className="h-11 w-full rounded-[var(--radius-control)] bg-surface pl-10 pr-3 text-[16px] text-ink shadow-[var(--shadow-card)] outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        {mismatchCount > 0 && (
          <button
            type="button"
            onClick={() => setMismatchOnly((v) => !v)}
            className={`pressable h-11 rounded-[var(--radius-control)] px-3.5 text-[14px] font-bold ${
              mismatchOnly
                ? "bg-brand-solid text-on-brand"
                : "bg-surface text-ink-2 shadow-[var(--shadow-card)]"
            }`}
          >
            Price mismatch ({mismatchCount})
          </button>
        )}
        <Button
          variant="primary"
          size="md"
          onClick={onAddItem}
          className="!h-11 !px-3.5 !text-[14px]"
        >
          <Plus className="h-4 w-4" />
          Add item
        </Button>
      </div>

      {!filtered.length ? (
        <Group className="p-6 text-center space-y-2.5">
          <p className="text-[16px] font-bold text-ink">No matching items</p>
          <p className="text-[14px] text-ink-2">
            Add a new item to both TikTok and Shopee, or run &ldquo;Read stock again&rdquo; in Items &amp; stock.
          </p>
          <div className="pt-1">
            <Button variant="primary" size="md" onClick={onAddItem} className="!h-11 !px-4">
              <Plus className="h-4 w-4" />
              Add item
            </Button>
          </div>
        </Group>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const shopPrices = new Map<string, { name: string; platform: "SHOPEE" | "TIKTOK"; prices: number[] }>();
            for (const v of item.variants) {
              for (const l of v.listings) {
                let entry = shopPrices.get(l.shopConnectionId);
                if (!entry) {
                  entry = { name: l.shopName, platform: l.platform, prices: [] };
                  shopPrices.set(l.shopConnectionId, entry);
                }
                if (l.pricePhp !== null && !entry.prices.includes(l.pricePhp)) {
                  entry.prices.push(l.pricePhp);
                }
              }
            }
            const canCopy =
              item.sourceProducts.length > 0 &&
              shops.filter((s) => s.connected).length > 1;

            return (
              <Group key={item.garmentId} className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <ItemThumb src={item.imageUrl} alt={item.garmentName} size="md" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-extrabold text-ink">
                        {item.garmentName}
                      </span>
                      {item.hasPriceMismatch && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                          Prices differ
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-ink-2 tabular-nums">
                      {item.variants.length} variant{item.variants.length === 1 ? "" : "s"} ·{" "}
                      {item.totalOnShelf} on shelf
                      {item.sellingPricePhp !== null
                        ? ` · Shop price ₱${item.sellingPricePhp.toFixed(2)}`
                        : ""}
                    </p>
                  </div>
                </div>

                {(shopPrices.size > 0 || item.publishes.some((p) => p.status !== "PUSHED")) && (
                  <div className="flex flex-wrap gap-2">
                    {[...shopPrices.values()].map((sp) => (
                      <span
                        key={sp.name}
                        className="rounded-[var(--radius-control)] bg-surface-subtle px-2.5 py-1 text-[12px] font-semibold text-ink-2 tabular-nums"
                      >
                        {sp.platform === "SHOPEE" ? "Shopee" : "TikTok"}:{" "}
                        {sp.prices.length
                          ? sp.prices.map((p) => `₱${p}`).join(" / ")
                          : "No price synced"}
                      </span>
                    ))}
                    {item.publishes
                      .filter((p) => p.status !== "PUSHED")
                      .map((pub) => (
                        <button
                          key={pub.id}
                          type="button"
                          onClick={() => onRetryPublish(item, pub)}
                          className={`pressable inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2.5 py-1 text-[12px] font-bold ${
                            pub.status === "FAILED"
                              ? "bg-missing-soft text-missing-ink"
                              : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                          }`}
                        >
                          <RefreshCw className="h-3 w-3" />
                          {pub.platform === "SHOPEE" ? "Shopee" : "TikTok"}:{" "}
                          {pub.status === "SKIPPED" ? "Not pushed · Push" : "Failed · Retry"}
                        </button>
                      ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {canCopy && (
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => onCopyListing(item)}
                      className="!h-11 !px-3.5 !text-[14px]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy draft
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => onEditPrice(item)}
                    className="!h-11 !px-3.5 !text-[14px]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit price
                  </Button>
                </div>
              </Group>
            );
          })}
        </div>
      )}
    </div>
  );
}
