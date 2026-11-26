"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, PackageCheck, X } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { ReceivePoPanel } from "@/components/stock-in/ReceivePoPanel";
import type { PurchaseOrderDto, StaffPurchaseOrderView } from "./types";

type PoFilter = "open" | "received" | "all";

const STATUS_BADGE: Record<
  PurchaseOrderDto["status"],
  { label: string; cls: string }
> = {
  DRAFT: { label: "Draft", cls: "bg-surface-muted text-ink-2" },
  ORDERED: { label: "Ordered", cls: "bg-brand-soft text-brand" },
  PARTIAL: {
    label: "Partial",
    cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  RECEIVED: {
    label: "Received",
    cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  CANCELLED: { label: "Cancelled", cls: "bg-ink/10 text-ink-3" },
};

function toStaffShape(po: PurchaseOrderDto): StaffPurchaseOrderView {
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    expectedAt: po.expectedAt,
    supplierName: po.supplierName,
    note: po.note,
    lines: po.lines.map((l) => ({
      id: l.id,
      garmentVariantId: l.garmentVariantId,
      garmentId: l.garmentId,
      garmentName: l.garmentName,
      variantLabel: l.variantLabel,
      imageUrl: l.imageUrl,
      binLocation: l.binLocation,
      orderedQty: l.orderedQty,
      receivedQty: l.receivedQty,
      damagedQty: l.damagedQty,
      remainingQty: l.remainingQty,
    })),
  };
}

export function PurchaseOrdersPanel({
  purchaseOrders,
  onChanged,
  onOpenNewPo,
}: {
  purchaseOrders: PurchaseOrderDto[];
  onChanged: () => Promise<void> | void;
  onOpenNewPo: () => void;
}) {
  const { confirm, sheet: confirmSheet } = useConfirm();
  const [filter, setFilter] = useState<PoFilter>("open");
  const [receivingPo, setReceivingPo] = useState<PurchaseOrderDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const openOrders = useMemo(
    () =>
      purchaseOrders.filter(
        (po) =>
          po.status === "DRAFT" ||
          po.status === "ORDERED" ||
          po.status === "PARTIAL"
      ),
    [purchaseOrders]
  );

  const filtered = useMemo(() => {
    if (filter === "open") return openOrders;
    if (filter === "received") {
      return purchaseOrders.filter((po) => po.status === "RECEIVED");
    }
    return purchaseOrders;
  }, [purchaseOrders, openOrders, filter]);

  const pendingCostLines = useMemo(() => {
    const list: Array<{
      poNumber: string;
      line: PurchaseOrderDto["lines"][number];
    }> = [];
    for (const po of purchaseOrders) {
      for (const line of po.lines) {
        if (line.costUpdatePending && line.unitCostPhp !== null) {
          list.push({ poNumber: po.poNumber, line });
        }
      }
    }
    return list;
  }, [purchaseOrders]);

  async function decideCost(lineId: string, decision: "apply" | "dismiss") {
    setBusyId(lineId);
    try {
      const res = await fetch("/api/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decideCostUpdate", lineId, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't update cost.", "error");
        return;
      }
      toast(
        decision === "apply"
          ? `Updated item unit cost to ₱${data.unitCostPhp?.toFixed(2) ?? ""}`
          : "Kept existing item cost"
      );
      await onChanged();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(po: PurchaseOrderDto, status: "ORDERED" | "CANCELLED") {
    if (status === "CANCELLED") {
      const ok = await confirm({
        title: `Cancel ${po.poNumber}?`,
        message: "Anything already shelved stays in stock; remaining pieces will no longer be expected.",
        confirmLabel: "Cancel order",
        danger: true,
      });
      if (!ok) return;
    }
    setBusyId(po.id);
    try {
      const res = await fetch("/api/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updatePoStatus", id: po.id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't update order.", "error");
        return;
      }
      toast(
        status === "ORDERED"
          ? `${po.poNumber} marked as ordered`
          : `Cancelled ${po.poNumber}`
      );
      await onChanged();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {confirmSheet}

      {pendingCostLines.length > 0 && (
        <Group className="divide-y divide-hairline border border-amber-500/30 bg-amber-500/[0.06]">
          <div className="px-4 py-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-300 shrink-0" />
            <p className="text-[13px] font-bold text-ink">
              Supplier cost changed — confirm new item cost?
            </p>
          </div>
          {pendingCostLines.map(({ poNumber, line }) => (
            <div
              key={line.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-ink">
                  {line.garmentName} ({line.variantLabel})
                </div>
                <div className="text-[12px] text-ink-2">
                  {poNumber}: ₱{line.unitCostPhp?.toFixed(2)} (current item cost:{" "}
                  {line.garmentUnitCostPhp !== null
                    ? `₱${line.garmentUnitCostPhp.toFixed(2)}`
                    : "Shop default"}
                  )
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  disabled={busyId === line.id}
                  onClick={() => decideCost(line.id, "dismiss")}
                  className="!h-9 !px-3 !text-[12px]"
                >
                  <X className="h-3.5 w-3.5" />
                  Keep old
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={busyId === line.id}
                  onClick={() => decideCost(line.id, "apply")}
                  className="!h-9 !px-3 !text-[12px]"
                >
                  <Check className="h-3.5 w-3.5" />
                  Use ₱{line.unitCostPhp?.toFixed(2)}
                </Button>
              </div>
            </div>
          ))}
        </Group>
      )}

      <SegmentedControl
        label="Filter supplier orders"
        size="sm"
        shape="pill"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "open" as const, label: `Open (${openOrders.length})` },
          {
            id: "received" as const,
            label: `Received (${purchaseOrders.filter((p) => p.status === "RECEIVED").length})`,
          },
          { id: "all" as const, label: `All (${purchaseOrders.length})` },
        ]}
      />

      {!filtered.length ? (
        <Group className="p-6 text-center space-y-3">
          <p className="text-[16px] font-bold text-ink">
            {filter === "open" ? "No open supplier orders" : "No supplier orders here"}
          </p>
          <p className="text-[14px] text-ink-2">
            Create an order when you send a PO to your supplier so staff can tap to receive it when boxes arrive.
          </p>
          {filter === "open" && (
            <Button variant="primary" size="md" onClick={onOpenNewPo}>
              New supplier order
            </Button>
          )}
        </Group>
      ) : (
        <div className="space-y-3">
          {filtered.map((po) => {
            const badge = STATUS_BADGE[po.status];
            const totalOrdered = po.lines.reduce((s, l) => s + l.orderedQty, 0);
            const totalReceived = po.lines.reduce((s, l) => s + l.receivedQty, 0);
            const canReceive =
              po.status === "ORDERED" || po.status === "PARTIAL";

            return (
              <Group key={po.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-extrabold text-ink">
                        {po.poNumber}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      {po.isOverdue && (
                        <span className="rounded-full bg-missing-soft px-2 py-0.5 text-[11px] font-bold text-missing-ink">
                          Overdue {po.daysOverdue}d
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] font-medium text-ink-2">
                      {po.supplierName}
                      {po.expectedAt
                        ? ` · Expected ${new Date(po.expectedAt).toLocaleDateString(
                            "en-PH",
                            {
                              month: "short",
                              day: "numeric",
                              timeZone: "Asia/Manila",
                            }
                          )}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[14px] font-bold tabular-nums text-ink">
                      {totalReceived}/{totalOrdered} pcs
                    </div>
                    {po.totalCostPhp !== null && (
                      <div className="text-[12px] text-ink-3 tabular-nums">
                        ₱{po.totalCostPhp.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
                      </div>
                    )}
                  </div>
                </div>

                {po.note && (
                  <p className="text-[12px] text-ink-3">{po.note}</p>
                )}

                <ul className="divide-y divide-hairline rounded-[var(--radius-control)] bg-surface-subtle">
                  {po.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center gap-2.5 px-3 py-2"
                    >
                      <ItemThumb
                        src={line.imageUrl}
                        alt={line.garmentName}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">
                          {line.garmentName}
                        </div>
                        <div className="text-[12px] text-ink-3">
                          {line.variantLabel}
                          {line.unitCostPhp !== null
                            ? ` · ₱${line.unitCostPhp.toFixed(2)}/pc`
                            : ""}
                        </div>
                      </div>
                      <div className="text-right text-[13px] font-bold tabular-nums text-ink-2">
                        {line.receivedQty}/{line.orderedQty}
                        {line.damagedQty > 0 ? (
                          <span className="block text-[11px] font-semibold text-missing-ink">
                            {line.damagedQty} damaged
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>

                {(po.status === "DRAFT" || canReceive) && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    {po.status !== "RECEIVED" && (
                      <Button
                        variant="plain"
                        size="md"
                        disabled={busyId === po.id}
                        onClick={() => setStatus(po, "CANCELLED")}
                        className="!h-10 !px-3 !text-[13px] !text-missing-ink"
                      >
                        Cancel
                      </Button>
                    )}
                    {po.status === "DRAFT" && (
                      <Button
                        variant="primary"
                        size="md"
                        disabled={busyId === po.id}
                        onClick={() => setStatus(po, "ORDERED")}
                        className="!h-10 !px-4 !text-[13px]"
                      >
                        Mark ordered
                      </Button>
                    )}
                    {canReceive && (
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => setReceivingPo(po)}
                        className="!h-10 !px-4 !text-[13px]"
                      >
                        <PackageCheck className="h-4 w-4" />
                        Receive delivery
                      </Button>
                    )}
                  </div>
                )}
              </Group>
            );
          })}
        </div>
      )}

      <Sheet
        open={Boolean(receivingPo)}
        onClose={() => setReceivingPo(null)}
        title="Receive supplier delivery"
      >
        {receivingPo && (
          <ReceivePoPanel
            po={toStaffShape(receivingPo)}
            apiMode="owner"
            onReceived={async () => {
              setReceivingPo(null);
              await onChanged();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
