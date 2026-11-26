"use client";

import { useState } from "react";
import { RotateCw } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import type { PriceChangeHistoryDto } from "@/lib/listings/service";
import { manilaDateTime } from "@/lib/ui/format";

const STATUS_BADGE: Record<
  PriceChangeHistoryDto["status"],
  { label: string; cls: string }
> = {
  PENDING: { label: "Waiting approval", cls: "bg-brand-soft text-brand" },
  PUSHED: {
    label: "Pushed",
    cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  PARTIAL: {
    label: "Partial",
    cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  FAILED: { label: "Failed", cls: "bg-missing-soft text-missing-ink" },
  REJECTED: { label: "Rejected", cls: "bg-ink/10 text-ink-3" },
};

export function PriceHistoryPanel({
  history,
  onChanged,
}: {
  history: PriceChangeHistoryDto[];
  onChanged: () => Promise<void> | void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function retry(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retryPrice", priceChangeId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't retry price push.", "error");
        return;
      }
      toast("Retried price push");
      await onChanged();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (!history.length) {
    return (
      <Group className="p-6 text-center space-y-1.5">
        <p className="text-[16px] font-bold text-ink">No price changes yet</p>
        <p className="text-[14px] text-ink-2">
          Approved price updates and each shop&apos;s push status appear here.
        </p>
      </Group>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((row) => {
        const badge = STATUS_BADGE[row.status];
        const canRetry = row.status === "PARTIAL" || row.status === "FAILED";
        return (
          <Group key={row.id} className="p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-extrabold text-ink">
                    {row.garmentName}
                    {row.variantLabel ? ` (${row.variantLabel})` : ""}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <p className="text-[13px] font-semibold tabular-nums text-ink-2">
                  {row.oldPricePhp !== null ? `₱${row.oldPricePhp.toFixed(2)}` : "Unset"} →{" "}
                  <span className="text-ink">₱{row.newPricePhp.toFixed(2)}</span>
                </p>
                <p className="text-[12px] text-ink-3">
                  By {row.createdBy}
                  {row.decidedBy ? ` · Decided by ${row.decidedBy}` : ""} ·{" "}
                  {manilaDateTime(row.pushedAt ?? row.createdAt)}
                </p>
              </div>
              {canRetry && (
                <Button
                  variant="secondary"
                  size="md"
                  disabled={busyId === row.id}
                  onClick={() => retry(row.id)}
                  className="!h-9 !px-3 !text-[12px] shrink-0"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              )}
            </div>

            {row.results.length > 0 && (
              <ul className="space-y-1 rounded-[var(--radius-control)] bg-surface-subtle px-3 py-2 text-[12px]">
                {row.results.map((r, i) => (
                  <li
                    key={`${r.listingVariantId}-${i}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="font-semibold text-ink-2">
                      {r.shopName} ({r.platform === "SHOPEE" ? "Shopee" : "TikTok"})
                    </span>
                    <span
                      className={
                        r.status === "OK"
                          ? "font-bold text-emerald-700 dark:text-emerald-300"
                          : r.status === "SKIPPED"
                            ? "font-bold text-amber-700 dark:text-amber-300"
                            : "font-bold text-missing-ink"
                      }
                    >
                      {r.status}
                      {r.error ? ` — ${r.error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        );
      })}
    </div>
  );
}
