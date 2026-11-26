"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Group } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toast } from "@/components/ui/Toast";
import {
  CreatePoSheet,
  type PoPrefill,
} from "@/components/restock/CreatePoSheet";
import { PurchaseOrdersPanel } from "@/components/restock/PurchaseOrdersPanel";
import { ReorderSoonPanel } from "@/components/restock/ReorderSoonPanel";
import { SuppliersPanel } from "@/components/restock/SuppliersPanel";
import type {
  PurchaseOrderDto,
  ReorderSuggestion,
  SupplierDto,
  VariantPickerItem,
} from "@/components/restock/types";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";

type RestockTab = "orders" | "reorder" | "suppliers";

export default function RestockPage() {
  const [tab, setTab] = useState<RestockTab>("orders");
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDto[]>([]);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [variants, setVariants] = useState<VariantPickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [prefill, setPrefill] = useState<PoPrefill | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/restock", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          toast("Sign in as the owner first.", "error");
        }
        return;
      }
      const data = await res.json();
      setSuppliers(data.suppliers ?? []);
      setPurchaseOrders(data.purchaseOrders ?? []);
      setSuggestions(data.suggestions ?? []);
      setVariants(data.variants ?? []);
    } catch {
      toast("Couldn't refresh restock data.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh({ onRefresh: load });

  const openPoCount = useMemo(
    () =>
      purchaseOrders.filter(
        (po) =>
          po.status === "DRAFT" ||
          po.status === "ORDERED" ||
          po.status === "PARTIAL"
      ).length,
    [purchaseOrders]
  );

  const overdueCount = useMemo(
    () => purchaseOrders.filter((po) => po.isOverdue).length,
    [purchaseOrders]
  );

  const activeSupplierCount = useMemo(
    () => suppliers.filter((s) => !s.archivedAt).length,
    [suppliers]
  );

  function openNewPo(nextPrefill: PoPrefill | null = null) {
    setPrefill(nextPrefill);
    setCreateOpen(true);
  }

  return (
    <AppShell
      title="Restock & suppliers"
      onRefresh={load}
      headerRight={
        <button
          type="button"
          onClick={() => openNewPo(null)}
          aria-label="New supplier order"
          title="New supplier order"
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-ink/[0.05]"
        >
          <Plus className="h-[22px] w-[22px]" />
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2.5">
          <Group className="p-3.5 text-center">
            <div className="text-[22px] font-extrabold tabular-nums text-ink">
              {suggestions.length}
            </div>
            <div className="text-[12px] font-medium text-ink-3">Reorder soon</div>
          </Group>
          <Group className="p-3.5 text-center">
            <div className="text-[22px] font-extrabold tabular-nums text-ink">
              {openPoCount}
            </div>
            <div className="text-[12px] font-medium text-ink-3">Open POs</div>
          </Group>
          <Group className="p-3.5 text-center">
            <div
              className={`text-[22px] font-extrabold tabular-nums ${
                overdueCount > 0 ? "text-missing-ink" : "text-ink"
              }`}
            >
              {overdueCount}
            </div>
            <div className="text-[12px] font-medium text-ink-3">Overdue</div>
          </Group>
        </div>

        <SegmentedControl
          label="Restock sections"
          value={tab}
          onChange={setTab}
          options={[
            { id: "orders" as const, label: `Orders (${openPoCount})` },
            { id: "reorder" as const, label: `Reorder (${suggestions.length})` },
            { id: "suppliers" as const, label: `Suppliers (${activeSupplierCount})` },
          ]}
        />

        {loading ? (
          <Group className="p-6 text-center text-[14px] text-ink-3">
            Loading restock data...
          </Group>
        ) : tab === "orders" ? (
          <PurchaseOrdersPanel
            purchaseOrders={purchaseOrders}
            onChanged={load}
            onOpenNewPo={() => openNewPo(null)}
          />
        ) : tab === "reorder" ? (
          <ReorderSoonPanel
            suggestions={suggestions}
            onOrder={(s) =>
              openNewPo({
                supplierId: s.lastSupplier?.id ?? null,
                variantId: s.variantId,
                orderedQty: s.suggestedQty,
                unitCostPhp: s.unitCostPhp,
              })
            }
          />
        ) : (
          <SuppliersPanel suppliers={suppliers} onChanged={load} />
        )}
      </div>

      <CreatePoSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        suppliers={suppliers}
        variants={variants}
        prefill={prefill}
        onCreated={load}
      />
    </AppShell>
  );
}
