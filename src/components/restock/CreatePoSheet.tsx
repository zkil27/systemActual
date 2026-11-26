"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import type { SupplierDto, VariantPickerItem } from "./types";

export interface PoPrefill {
  supplierId?: string | null;
  variantId?: string | null;
  orderedQty?: number;
  unitCostPhp?: number | null;
}

interface DraftLine {
  variant: VariantPickerItem;
  orderedQtyText: string;
  unitCostText: string;
}

export function CreatePoSheet({
  open,
  onClose,
  suppliers,
  variants,
  prefill,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: SupplierDto[];
  variants: VariantPickerItem[];
  prefill?: PoPrefill | null;
  onCreated: () => Promise<void> | void;
}) {
  const activeSuppliers = useMemo(
    () => suppliers.filter((s) => !s.archivedAt),
    [suppliers]
  );

  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [markOrdered, setMarkOrdered] = useState(true);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const defaultSupplierId =
      (prefill?.supplierId &&
      activeSuppliers.some((s) => s.id === prefill.supplierId)
        ? prefill.supplierId
        : activeSuppliers[0]?.id) ?? "";
    setSupplierId(defaultSupplierId);
    setExpectedDate("");
    setNote("");
    setMarkOrdered(true);
    setSearch("");

    if (prefill?.variantId) {
      const match = variants.find((v) => v.variantId === prefill.variantId);
      if (match) {
        const qty = Math.max(1, prefill.orderedQty ?? 10);
        const cost = prefill.unitCostPhp ?? match.unitCostPhp;
        setLines([
          {
            variant: match,
            orderedQtyText: String(qty),
            unitCostText: cost !== null && cost !== undefined ? String(cost) : "",
          },
        ]);
        return;
      }
    }
    setLines([]);
  }, [open, prefill, activeSuppliers, variants]);

  const filteredVariants = useMemo(() => {
    const q = search.trim().toLowerCase();
    const chosenIds = new Set(lines.map((l) => l.variant.variantId));
    return variants
      .filter((v) => !chosenIds.has(v.variantId))
      .filter(
        (v) =>
          !q ||
          v.garmentName.toLowerCase().includes(q) ||
          v.variantLabel.toLowerCase().includes(q) ||
          (v.binLocation?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 12);
  }, [variants, lines, search]);

  const selectedSupplier = activeSuppliers.find((s) => s.id === supplierId);

  function addVariant(v: VariantPickerItem) {
    setLines((prev) => [
      ...prev,
      {
        variant: v,
        orderedQtyText: "10",
        unitCostText: v.unitCostPhp !== null ? String(v.unitCostPhp) : "",
      },
    ]);
    setSearch("");
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variant.variantId !== variantId));
  }

  function updateLine(
    variantId: string,
    patch: Partial<Pick<DraftLine, "orderedQtyText" | "unitCostText">>
  ) {
    setLines((prev) =>
      prev.map((l) =>
        l.variant.variantId === variantId ? { ...l, ...patch } : l
      )
    );
  }

  const estimatedTotal = useMemo(() => {
    let total = 0;
    let hasCost = false;
    for (const l of lines) {
      const q = Math.max(0, Number.parseInt(l.orderedQtyText, 10) || 0);
      const c = Number.parseFloat(l.unitCostText);
      if (Number.isFinite(c) && c >= 0) {
        hasCost = true;
        total += q * c;
      }
    }
    return hasCost ? total : null;
  }, [lines]);

  async function submit() {
    if (!supplierId) {
      toast("Pick a supplier first.", "error");
      return;
    }
    if (!lines.length) {
      toast("Add at least one item.", "error");
      return;
    }

    const payloadLines = lines.map((l) => {
      const qty = Math.max(1, Number.parseInt(l.orderedQtyText, 10) || 1);
      const parsedCost = Number.parseFloat(l.unitCostText);
      return {
        garmentVariantId: l.variant.variantId,
        orderedQty: qty,
        unitCostPhp:
          l.unitCostText.trim() !== "" && Number.isFinite(parsedCost) && parsedCost >= 0
            ? parsedCost
            : null,
      };
    });

    setSaving(true);
    try {
      const res = await fetch("/api/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createPo",
          supplierId,
          expectedAt: expectedDate || null,
          note: note.trim() || null,
          markOrdered,
          lines: payloadLines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't create supplier order.", "error");
        return;
      }
      toast(
        markOrdered
          ? `Placed ${data.purchaseOrder?.poNumber ?? "supplier order"}`
          : `Saved draft ${data.purchaseOrder?.poNumber ?? "order"}`
      );
      await onCreated();
      onClose();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="New supplier order">
      <div className="space-y-4">
        {!activeSuppliers.length ? (
          <div className="rounded-[var(--radius-card)] bg-surface-muted p-4 text-[14px] text-ink-2">
            Add a supplier first in the Suppliers tab before creating a restock order.
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                Supplier
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[15px] font-medium text-ink outline-none focus:border-brand"
              >
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.leadTimeDays}d lead)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-ink-2">
                  Expected date
                </label>
                <input
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
                />
                {!expectedDate && selectedSupplier && (
                  <p className="text-[12px] text-ink-3">
                    Defaults to +{selectedSupplier.leadTimeDays}d
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-ink-2">
                  Order status
                </label>
                <select
                  value={markOrdered ? "ORDERED" : "DRAFT"}
                  onChange={(e) => setMarkOrdered(e.target.value === "ORDERED")}
                  className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
                >
                  <option value="ORDERED">Ordered now</option>
                  <option value="DRAFT">Save as draft</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-[13px] font-semibold text-ink-2">
                Add items ({lines.length} selected)
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-3" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search item, size, or bin..."
                  className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface pl-9 pr-3 text-[14px] text-ink outline-none focus:border-brand"
                />
              </div>

              {(search.trim().length > 0 || lines.length === 0) &&
                filteredVariants.length > 0 && (
                  <div className="max-h-44 overflow-y-auto rounded-[var(--radius-card)] border border-ink/10 bg-surface-card divide-y divide-ink/[0.06]">
                    {filteredVariants.map((v) => (
                      <button
                        key={v.variantId}
                        type="button"
                        onClick={() => addVariant(v)}
                        className="pressable flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-ink/[0.03]"
                      >
                        <ItemThumb src={v.imageUrl} alt={v.garmentName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-semibold text-ink">
                            {v.garmentName}
                          </div>
                          <div className="text-[12px] text-ink-2">
                            {v.variantLabel} • {v.onShelfCount} on shelf
                            {v.binLocation ? ` • Bin ${v.binLocation}` : ""}
                          </div>
                        </div>
                        <Plus className="h-4 w-4 shrink-0 text-brand" />
                      </button>
                    ))}
                  </div>
                )}
            </div>

            {lines.length > 0 && (
              <div className="space-y-2">
                {lines.map((line) => (
                  <div
                    key={line.variant.variantId}
                    className="rounded-[var(--radius-card)] border border-ink/10 bg-surface p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <ItemThumb
                        src={line.variant.imageUrl}
                        alt={line.variant.garmentName}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-ink">
                          {line.variant.garmentName}
                        </div>
                        <div className="text-[12px] text-ink-2">
                          {line.variant.variantLabel} • {line.variant.onShelfCount} on shelf
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.variant.variantId)}
                        aria-label="Remove item"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-ink/[0.06] hover:text-missing-ink"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-ink-3">
                          Qty (pcs)
                        </label>
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={line.orderedQtyText}
                          onChange={(e) =>
                            updateLine(line.variant.variantId, {
                              orderedQtyText: e.target.value,
                            })
                          }
                          className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface-card px-3 text-[15px] font-semibold text-ink outline-none focus:border-brand"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-ink-3">
                          Unit cost (₱ optional)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          placeholder="e.g. 82"
                          value={line.unitCostText}
                          onChange={(e) =>
                            updateLine(line.variant.variantId, {
                              unitCostText: e.target.value,
                            })
                          }
                          className="h-10 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface-card px-3 text-[15px] text-ink outline-none focus:border-brand"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                Note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Batch colour, downpayment, or pickup instructions"
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
              />
            </div>

            {estimatedTotal !== null && (
              <div className="flex items-center justify-between rounded-[var(--radius-control)] bg-surface-muted px-3.5 py-2.5 text-[14px]">
                <span className="text-ink-2">Estimated total</span>
                <span className="font-bold text-ink">
                  ₱{estimatedTotal.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <Button full onClick={submit} disabled={saving || !lines.length}>
              {saving
                ? "Saving..."
                : markOrdered
                  ? "Place supplier order"
                  : "Save draft order"}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
