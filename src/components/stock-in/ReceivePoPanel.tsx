"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Minus, Plus } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { toast } from "@/components/ui/Toast";
import { pulseAmbient } from "@/lib/ui/ambient";
import { haptic } from "@/lib/ui/motion";
import type { StaffPurchaseOrderView } from "@/lib/restock/rules";

interface LineReceiveState {
  receivedQty: number;
  damagedQty: number;
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Exception-only supplier order receiving UI:
 * By default all remaining pieces are prefilled as arrived in good condition,
 * so staff only tap +/- for short or damaged items. Strictly zero pesos shown.
 */
export function ReceivePoPanel({
  po,
  apiMode = "staff",
  onCancel,
  onReceived,
}: {
  po: StaffPurchaseOrderView;
  apiMode?: "staff" | "owner";
  onCancel?: () => void;
  onReceived: () => Promise<void> | void;
}) {
  const [counts, setCounts] = useState<Record<string, LineReceiveState>>({});
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(newKey());

  useEffect(() => {
    const initial: Record<string, LineReceiveState> = {};
    for (const line of po.lines) {
      initial[line.id] = {
        receivedQty: line.remainingQty,
        damagedQty: 0,
      };
    }
    setCounts(initial);
    keyRef.current = newKey();
  }, [po]);

  const totalGood = useMemo(
    () =>
      Object.values(counts).reduce((sum, c) => sum + Math.max(0, c.receivedQty), 0),
    [counts]
  );
  const totalDamaged = useMemo(
    () =>
      Object.values(counts).reduce((sum, c) => sum + Math.max(0, c.damagedQty), 0),
    [counts]
  );

  function bump(lineId: string, field: "receivedQty" | "damagedQty", delta: number) {
    haptic("tap");
    setCounts((prev) => {
      const cur = prev[lineId] ?? { receivedQty: 0, damagedQty: 0 };
      const nextVal = Math.max(0, Math.min(10_000, cur[field] + delta));
      return {
        ...prev,
        [lineId]: { ...cur, [field]: nextVal },
      };
    });
  }

  async function submit() {
    if (totalGood + totalDamaged < 1) {
      toast("Enter at least 1 received or damaged piece.", "error");
      return;
    }

    const items = po.lines
      .map((line) => {
        const entry = counts[line.id] ?? { receivedQty: 0, damagedQty: 0 };
        return {
          lineId: line.id,
          receivedQty: entry.receivedQty,
          damagedQty: entry.damagedQty,
        };
      })
      .filter((i) => i.receivedQty > 0 || i.damagedQty > 0);

    setSaving(true);
    try {
      const endpoint = apiMode === "owner" ? "/api/restock" : "/api/stock-in";
      const payload =
        apiMode === "owner"
          ? {
              action: "receivePo",
              purchaseOrderId: po.id,
              clientKey: keyRef.current,
              items,
            }
          : {
              mode: "RECEIVE_PO",
              purchaseOrderId: po.id,
              clientKey: keyRef.current,
              items,
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't save delivery.", "error");
        return;
      }
      haptic("success");
      pulseAmbient("success");
      toast(
        data.duplicate
          ? `${po.poNumber} already recorded`
          : `Received +${totalGood} good${totalDamaged ? `, ${totalDamaged} damaged` : ""} on ${po.poNumber}`
      );
      keyRef.current = newKey();
      await onReceived();
    } catch {
      toast("No connection. Tap confirm again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 px-1">
        <div>
          <p className="text-[16px] font-bold text-ink">{po.poNumber}</p>
          <p className="text-[13px] text-ink-2">
            {po.supplierName}
            {po.expectedAt
              ? ` · Expected ${new Date(po.expectedAt).toLocaleDateString("en-PH", {
                  month: "short",
                  day: "numeric",
                  timeZone: "Asia/Manila",
                })}`
              : ""}
          </p>
          {po.note && (
            <p className="mt-0.5 text-[12px] text-ink-3">{po.note}</p>
          )}
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-[14px] font-bold text-brand hover:underline"
          >
            Back
          </button>
        )}
      </div>

      <p className="px-1 text-[13px] text-ink-3">
        Everything left is prefilled as good stock. Adjust only if anything is short or damaged.
      </p>

      <Group>
        <ul className="divide-y divide-hairline">
          {po.lines.map((line) => {
            const state = counts[line.id] ?? {
              receivedQty: line.remainingQty,
              damagedQty: 0,
            };
            return (
              <li key={line.id} className="space-y-3 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <ItemThumb
                    src={line.imageUrl}
                    alt={line.garmentName}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold text-ink">
                      {line.garmentName}
                    </div>
                    <div className="text-[13px] text-ink-2">
                      {line.variantLabel}
                      {line.binLocation ? ` · Bin ${line.binLocation}` : ""}
                    </div>
                    <div className="text-[12px] text-ink-3 tabular-nums">
                      Ordered {line.orderedQty}
                      {line.receivedQty > 0
                        ? ` · ${line.receivedQty} already in`
                        : ""}
                      {line.remainingQty > 0
                        ? ` · ${line.remainingQty} remaining`
                        : " · Complete"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-[var(--radius-control)] bg-surface-subtle p-2">
                    <div className="mb-1 text-center text-[11px] font-semibold text-ink-2">
                      Good stock (+)
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        aria-label={`Decrease good count for ${line.garmentName}`}
                        onClick={() => bump(line.id, "receivedQty", -1)}
                        className="pressable flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-surface text-ink shadow-xs"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-8 text-center text-[18px] font-extrabold tabular-nums text-ink">
                        {state.receivedQty}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase good count for ${line.garmentName}`}
                        onClick={() => bump(line.id, "receivedQty", 1)}
                        className="pressable flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-surface text-ink shadow-xs"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[var(--radius-control)] bg-surface-subtle p-2">
                    <div className="mb-1 text-center text-[11px] font-semibold text-missing-ink">
                      Damaged (not shelved)
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        aria-label={`Decrease damaged count for ${line.garmentName}`}
                        onClick={() => bump(line.id, "damagedQty", -1)}
                        className="pressable flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-surface text-ink shadow-xs"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-8 text-center text-[18px] font-extrabold tabular-nums text-ink">
                        {state.damagedQty}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase damaged count for ${line.garmentName}`}
                        onClick={() => bump(line.id, "damagedQty", 1)}
                        className="pressable flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-surface text-ink shadow-xs"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Group>

      <Button
        full
        size="lg"
        onClick={submit}
        disabled={saving || totalGood + totalDamaged < 1}
      >
        <CheckCircle2 className="h-5 w-5" />
        {saving
          ? "Saving..."
          : `Confirm received (+${totalGood} pcs${totalDamaged ? `, ${totalDamaged} damaged` : ""})`}
      </Button>
    </div>
  );
}
