"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { OptionPickerSheet } from "@/components/ui/OptionPickerSheet";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { buildPriceVariantOptions } from "@/lib/listings/price-picker";
import type { ShopSummaryDto, UnifiedListingItemDto } from "@/lib/listings/service";

export function PriceEditSheet({
  open,
  onClose,
  item,
  shops,
  onProposed,
}: {
  open: boolean;
  onClose: () => void;
  item: UnifiedListingItemDto | null;
  shops: ShopSummaryDto[];
  onProposed: () => Promise<void> | void;
}) {
  const [priceText, setPriceText] = useState("");
  const [variantId, setVariantId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPickerOpen(false);
    if (!open || !item) return;
    const firstPrice =
      item.sellingPricePhp ??
      item.variants.flatMap((v) => v.listings).find((l) => l.pricePhp !== null)?.pricePhp;
    setPriceText(firstPrice !== null && firstPrice !== undefined ? String(firstPrice) : "");
    setVariantId("");
  }, [open, item]);

  const variantOptions = useMemo(
    () => (item ? buildPriceVariantOptions(item) : []),
    [item]
  );

  const selectedOption = useMemo(
    () => variantOptions.find((o) => o.value === variantId) ?? variantOptions[0],
    [variantOptions, variantId]
  );

  const targetShops = useMemo(() => {
    if (!item) return [];
    const seen = new Map<
      string,
      { shopName: string; platform: "SHOPEE" | "TIKTOK"; writesEnabled: boolean; currentPrices: number[] }
    >();
    const variants = variantId
      ? item.variants.filter((v) => v.id === variantId)
      : item.variants;
    for (const v of variants) {
      for (const l of v.listings) {
        const shopMeta = shops.find((s) => s.id === l.shopConnectionId);
        let entry = seen.get(l.shopConnectionId);
        if (!entry) {
          entry = {
            shopName: l.shopName,
            platform: l.platform,
            writesEnabled: shopMeta?.writesEnabled ?? false,
            currentPrices: [],
          };
          seen.set(l.shopConnectionId, entry);
        }
        if (l.pricePhp !== null && !entry.currentPrices.includes(l.pricePhp)) {
          entry.currentPrices.push(l.pricePhp);
        }
      }
    }
    return [...seen.values()];
  }, [item, variantId, shops]);

  async function submit() {
    if (!item) return;
    const parsed = Number.parseFloat(priceText);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100_000) {
      toast("Enter a price between ₱1 and ₱100,000.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "proposePrice",
          garmentId: item.garmentId,
          garmentVariantId: variantId || null,
          newPricePhp: parsed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't queue price change.", "error");
        return;
      }
      toast("Price update queued in Approvals (and sent to Telegram)");
      await onProposed();
      onClose();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={item ? `Price: ${item.garmentName}` : "Update price"}>
        {item && (
          <div className="space-y-4">
            {item.variants.length > 1 && selectedOption && (
              <div className="space-y-1.5">
                <label
                  htmlFor="price-apply-to-trigger"
                  className="block text-[13px] font-semibold text-ink-2"
                >
                  Apply to
                </label>
                <button
                  id="price-apply-to-trigger"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen(true)}
                  className="pressable flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-hairline-strong bg-surface px-3.5 py-2.5 text-left hover:bg-surface-subtle active:bg-surface-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">
                      {selectedOption.label}
                    </span>
                    {selectedOption.description && (
                      <span className="mt-0.5 block truncate text-[12px] tabular-nums text-ink-3">
                        {selectedOption.description}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {selectedOption.trailing && (
                      <span className="text-[13px] font-semibold tabular-nums text-ink-2">
                        {selectedOption.trailing}
                      </span>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" />
                  </span>
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                New selling price (₱ PHP)
              </label>
              <input
                type="number"
                min={1}
                max={100000}
                step="0.01"
                inputMode="decimal"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder="e.g. 199"
                className="h-12 w-full rounded-[var(--radius-control)] border border-hairline-strong bg-surface px-3.5 text-[18px] font-bold tabular-nums text-ink outline-none focus:border-brand"
              />
            </div>

          <div className="space-y-2 rounded-[var(--radius-card)] bg-surface-subtle p-3.5">
            <p className="text-[12px] font-bold uppercase tracking-[0.03em] text-ink-3">
              Target shops preview
            </p>
            {targetShops.length === 0 ? (
              <p className="text-[13px] text-ink-2">
                No linked Shopee or TikTok listings on this item.
              </p>
            ) : (
              <ul className="space-y-2">
                {targetShops.map((s) => (
                  <li key={s.shopName} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="font-semibold text-ink">
                      {s.shopName}{" "}
                      <span className="text-ink-3">
                        ({s.platform === "SHOPEE" ? "Shopee" : "TikTok"})
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-ink-2">
                        {s.currentPrices.length
                          ? s.currentPrices.map((p) => `₱${p}`).join(" / ")
                          : "Unset"}
                      </span>
                      {!s.writesEnabled && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                          Writes off
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {targetShops.some((s) => !s.writesEnabled) && (
            <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-amber-500/10 p-3 text-[12px] text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Shops with writes off will be skipped on push until you enable writes in Settings (you can retry later).
              </span>
            </div>
          )}

          <p className="text-[12px] text-ink-3">
            Nothing changes live until you tap Approve in Approvals or Telegram.
          </p>

          <Button
            full
            onClick={submit}
            disabled={saving || targetShops.length === 0 || !priceText.trim()}
          >
            {saving ? "Queuing..." : "Queue price update for approval"}
          </Button>
          </div>
        )}
      </Sheet>

      <OptionPickerSheet
        open={open && pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Apply price to"
        options={variantOptions}
        value={variantId}
        onChange={setVariantId}
        searchPlaceholder="Search colour or size..."
        emptyLabel="No matching sizes or colours"
      />
    </>
  );
}
