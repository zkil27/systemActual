"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { buildListingCopyPreview } from "@/lib/listings/rules";
import type { ShopSummaryDto, UnifiedListingItemDto } from "@/lib/listings/service";

export function CopyListingSheet({
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
  const sources = useMemo(() => item?.sourceProducts ?? [], [item]);
  const [sourceId, setSourceId] = useState("");
  const [targetShopId, setTargetShopId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priceText, setPriceText] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === sourceId) ?? sources[0] ?? null,
    [sources, sourceId]
  );

  const targetChoices = useMemo(
    () =>
      shops.filter(
        (s) => s.connected && (!selectedSource || s.id !== selectedSource.shopConnectionId)
      ),
    [shops, selectedSource]
  );

  const selectedTarget = useMemo(
    () => targetChoices.find((s) => s.id === targetShopId) ?? targetChoices[0] ?? null,
    [targetChoices, targetShopId]
  );

  useEffect(() => {
    if (!open || !item || !sources.length) return;
    const src = sources[0];
    setSourceId(src.id);
    const dest = shops.find((s) => s.connected && s.id !== src.shopConnectionId);
    setTargetShopId(dest?.id ?? "");
    setTitle(src.title);
    setDescription(src.description ?? src.title);
    setCategoryId("");
    const firstPrice =
      item.sellingPricePhp ??
      src.variants.find((v) => v.pricePhp !== null)?.pricePhp ??
      199;
    setPriceText(String(firstPrice));
  }, [open, item, sources, shops]);

  const preview = useMemo(() => {
    if (!selectedSource || !selectedTarget) return null;
    return buildListingCopyPreview(
      {
        title: title || selectedSource.title,
        description: description || selectedSource.description,
        categoryId: selectedSource.categoryId,
        categoryName: selectedSource.categoryName,
        imageUrls: selectedSource.imageUrls,
        variants: selectedSource.variants,
      },
      selectedTarget.platform,
      selectedTarget.writesEnabled
    );
  }, [selectedSource, selectedTarget, title, description]);

  async function submit() {
    if (!selectedSource || !selectedTarget) {
      toast("Connect the destination shop first.", "error");
      return;
    }
    const price = Number.parseFloat(priceText);
    if (!Number.isFinite(price) || price < 1 || price > 100_000) {
      toast("Enter a valid price between ₱1 and ₱100,000.", "error");
      return;
    }
    if (!categoryId.trim()) {
      toast("Enter the destination shop category ID.", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "proposeCopy",
          sourceChannelProductId: selectedSource.id,
          targetShopConnectionId: selectedTarget.id,
          title: title.trim(),
          description: description.trim(),
          categoryId: categoryId.trim(),
          pricePhp: price,
          variants: selectedSource.variants.map((v) => ({
            label: v.label,
            pricePhp: v.pricePhp ?? price,
            stock: v.stock,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't queue draft copy.", "error");
        return;
      }
      toast("Draft copy queued in Approvals");
      await onProposed();
      onClose();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Copy listing as draft"
      footer={
        selectedSource ? (
          <Button
            full
            onClick={submit}
            disabled={saving || !selectedTarget || !title.trim() || !categoryId.trim()}
          >
            {saving ? "Queuing..." : "Queue draft copy for approval"}
          </Button>
        ) : undefined
      }
    >
      {!selectedSource ? (
        <p className="text-[14px] text-ink-2">
          Run &ldquo;Read stock again&rdquo; in Items &amp; stock first so Kyna Ops captures the full listing title, description, and photos.
        </p>
      ) : (
        <div className="space-y-4">
          {sources.length > 1 && (
            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                Copy from
              </label>
              <select
                value={selectedSource.id}
                onChange={(e) => {
                  const next = sources.find((s) => s.id === e.target.value);
                  setSourceId(e.target.value);
                  if (next) {
                    setTitle(next.title);
                    setDescription(next.description ?? next.title);
                  }
                }}
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shopName} ({s.platform === "SHOPEE" ? "Shopee" : "TikTok"})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-ink-2">
              Destination shop
            </label>
            {targetChoices.length === 0 ? (
              <p className="rounded-[var(--radius-control)] bg-surface-muted p-3 text-[13px] text-ink-2">
                No other connected shop is ready yet.
              </p>
            ) : (
              <select
                value={selectedTarget?.id ?? ""}
                onChange={(e) => setTargetShopId(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
              >
                {targetChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.shopName} ({s.platform === "SHOPEE" ? "Shopee Unlisted" : "TikTok Draft"})
                    {s.writesEnabled ? "" : " — Writes off"}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-ink-2">
              Listing title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-ink-2">
              Description
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface p-3 text-[16px] text-ink outline-none focus:border-brand"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                Target category ID
              </label>
              <input
                type="text"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                placeholder="e.g. 601226"
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                Default price (₱)
              </label>
              <input
                type="number"
                min={1}
                step="0.01"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] font-bold text-ink outline-none focus:border-brand"
              />
            </div>
          </div>

          {selectedSource.categoryName && (
            <p className="text-[12px] text-ink-3">
              Source category: {selectedSource.categoryName} ({selectedSource.categoryId ?? "—"})
            </p>
          )}

          {preview && preview.warnings.length > 0 && (
            <div className="space-y-1.5 rounded-[var(--radius-card)] bg-amber-500/10 p-3 text-[12px] text-amber-900 dark:text-amber-200">
              {preview.warnings.map((w) => (
                <div key={w} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
