"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import type { PublishMode, ShopPlatform } from "@/lib/listings/create-rules";
import type { UnifiedListingItemDto } from "@/lib/listings/service";
import { CategoryPickerSheet } from "./CategoryPickerSheet";

export type ItemPublishSummary = UnifiedListingItemDto["publishes"][number];

export function RetryPublishSheet({
  open,
  onClose,
  itemTitle,
  publish,
  onRetried,
}: {
  open: boolean;
  onClose: () => void;
  itemTitle: string;
  publish: ItemPublishSummary | null;
  onRetried: () => Promise<void> | void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [publishMode, setPublishMode] = useState<PublishMode>("DRAFT");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !publish) return;
    setCategoryId(publish.categoryId ?? "");
    setCategoryName(publish.categoryName ?? null);
    setPublishMode(publish.publishMode);
    setPickerOpen(false);
  }, [open, publish]);

  async function submit() {
    if (!publish) return;
    if (!categoryId.trim()) {
      toast("Pick a category first.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retryPublish",
          itemPublishId: publish.id,
          categoryId: categoryId.trim(),
          categoryName,
          publishMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Retry failed.", "error");
        return;
      }
      if (data.result?.status === "PUSHED") {
        toast(`Pushed to ${publish.shopName}`);
        await onRetried();
        onClose();
      } else {
        toast(data.result?.error || "Still couldn't push.", "error");
        await onRetried();
      }
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={publish ? `Push to ${publish.shopName}` : "Retry push"}
        footer={
          publish ? (
            <Button full size="lg" disabled={busy || !categoryId.trim()} onClick={submit}>
              {busy ? "Pushing..." : `Push to ${publish.shopName}`}
            </Button>
          ) : undefined
        }
      >
        {publish && (
          <div className="space-y-4">
            <p className="text-[15px] font-bold text-ink">{itemTitle}</p>

            {publish.error && (
              <div className="flex items-start gap-2 rounded-[var(--radius-card)] bg-amber-500/10 p-3 text-[13px] text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{publish.error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="block text-[13px] font-semibold text-ink-2">Listing status</span>
              <SegmentedControl
                label="Publish mode"
                value={publishMode}
                onChange={setPublishMode}
                options={[
                  { id: "DRAFT", label: "Draft / Unlisted" },
                  { id: "LIVE", label: "Publish live" },
                ]}
              />
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="pressable-row flex min-h-12 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3.5 py-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-ink-3">Category</span>
                <span className="block truncate text-[14px] font-semibold text-ink">
                  {categoryId
                    ? categoryName
                      ? `${categoryName} (${categoryId})`
                      : `ID ${categoryId}`
                    : "Tap to pick a category"}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
            </button>
          </div>
        )}
      </Sheet>

      {publish && (
        <CategoryPickerSheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          shopId={publish.shopConnectionId}
          shopName={publish.shopName}
          platform={publish.platform as ShopPlatform}
          selectedCategoryId={categoryId}
          recentCategories={[]}
          onSelect={(id, name) => {
            setCategoryId(id);
            setCategoryName(name);
          }}
        />
      )}
    </>
  );
}
