"use client";

import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import type { CategoryChip, CategoryOption, ShopPlatform } from "@/lib/listings/create-rules";

export function CategoryPickerSheet({
  open,
  onClose,
  shopId,
  shopName,
  platform,
  selectedCategoryId,
  recentCategories,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  shopId: string;
  shopName: string;
  platform: ShopPlatform;
  selectedCategoryId: string;
  recentCategories: CategoryChip[];
  onSelect: (categoryId: string, categoryName: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualId, setManualId] = useState(selectedCategoryId);

  useEffect(() => {
    if (!open) return;
    setManualId(selectedCategoryId);
    setQuery("");
  }, [open, selectedCategoryId]);

  useEffect(() => {
    if (!open || !shopId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/listings/categories?shopId=${encodeURIComponent(shopId)}&q=${encodeURIComponent(query)}`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error || "Couldn't load categories from shop.");
          setCategories([]);
          return;
        }
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      } catch {
        if (!cancelled) {
          setLoadError("No connection. You can still enter a category ID below.");
          setCategories([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 220 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, shopId, query]);

  const platformLabel = platform === "SHOPEE" ? "Shopee" : "TikTok";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${platformLabel} category`}
      stickyHeader={
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${shopName} categories...`}
              className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface pl-10 pr-3 text-[16px] text-ink outline-none focus:border-brand"
            />
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {recentCategories.length > 0 && !query.trim() && (
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.03em] text-ink-3">
              Used in your shop
            </p>
            <div className="flex flex-wrap gap-2">
              {recentCategories.map((c) => {
                const active = selectedCategoryId === c.categoryId;
                return (
                  <button
                    key={c.categoryId}
                    type="button"
                    onClick={() => {
                      onSelect(c.categoryId, c.categoryName);
                      onClose();
                    }}
                    className={`pressable min-h-10 rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                      active
                        ? "bg-brand-solid text-on-brand"
                        : "bg-surface-muted text-ink hover:bg-ink/10"
                    }`}
                  >
                    {c.categoryName ? `${c.categoryName} (${c.categoryId})` : c.categoryId}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.03em] text-ink-3">
            {query.trim() ? "Matching categories" : "Browse categories"}
          </p>
          {loading ? (
            <p className="rounded-[var(--radius-control)] bg-surface-subtle p-4 text-center text-[14px] text-ink-3">
              Loading {platformLabel} categories...
            </p>
          ) : loadError ? (
            <p className="rounded-[var(--radius-control)] bg-amber-500/10 p-3 text-[13px] text-amber-900 dark:text-amber-200">
              {loadError}
            </p>
          ) : categories.length === 0 ? (
            <p className="rounded-[var(--radius-control)] bg-surface-subtle p-4 text-center text-[14px] text-ink-3">
              No matching categories found.
            </p>
          ) : (
            <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-control)] border border-ink/10 bg-surface">
              {categories.map((cat) => {
                const active = selectedCategoryId === cat.id;
                return (
                  <li key={cat.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(cat.id, cat.name);
                        onClose();
                      }}
                      className="pressable-row flex min-h-12 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-surface-subtle"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">
                          {cat.name}
                        </span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {cat.path} · ID {cat.id}
                        </span>
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0 text-brand" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2 rounded-[var(--radius-control)] bg-surface-subtle p-3">
          <label className="block text-[12px] font-semibold text-ink-2">
            Or enter {platformLabel} category ID manually
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder={platform === "SHOPEE" ? "e.g. 100351" : "e.g. 601226"}
              className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
            />
            <Button
              variant="secondary"
              disabled={!manualId.trim()}
              onClick={() => {
                onSelect(manualId.trim(), null);
                onClose();
              }}
              className="!h-11 !px-4"
            >
              Use ID
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
