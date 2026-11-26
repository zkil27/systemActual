"use client";

import { PlusCircle } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import type { ReorderSuggestion } from "./types";

const URGENCY_BADGE: Record<
  ReorderSuggestion["urgency"],
  { label: string; cls: string }
> = {
  out: {
    label: "Out",
    cls: "bg-missing-soft text-missing-ink",
  },
  urgent: {
    label: "Urgent",
    cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  low: {
    label: "Low",
    cls: "bg-surface-muted text-ink-2",
  },
};

export function ReorderSoonPanel({
  suggestions,
  onOrder,
}: {
  suggestions: ReorderSuggestion[];
  onOrder: (suggestion: ReorderSuggestion) => void;
}) {
  if (!suggestions.length) {
    return (
      <Group className="p-6 text-center space-y-1.5">
        <p className="text-[16px] font-bold text-ink">All stocked up</p>
        <p className="text-[14px] text-ink-2">
          Nothing is below its reorder point once open supplier orders are counted.
        </p>
      </Group>
    );
  }

  return (
    <Group>
      <ul className="divide-y divide-hairline">
        {suggestions.map((item) => {
          const badge = URGENCY_BADGE[item.urgency];
          return (
            <li
              key={item.variantId}
              className="flex items-center gap-3 px-4 py-3.5"
            >
              <ItemThumb src={item.imageUrl} alt={item.garmentName} size="md" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-bold text-ink">
                    {item.garmentName}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="text-[13px] text-ink-2">
                  {item.variantLabel}
                  {item.binLocation ? ` · Bin ${item.binLocation}` : ""}
                  {item.soldLast7Days > 0
                    ? ` · ${item.soldLast7Days} sold (7d)`
                    : ""}
                </div>
                <div className="text-[12px] text-ink-3">
                  {item.reason}
                  {item.onOrderQty > 0 && item.available > 0
                    ? ` · ${item.onOrderQty} already on order`
                    : ""}
                  {item.lastSupplier ? ` · ${item.lastSupplier.name}` : ""}
                </div>
              </div>
              <Button
                variant="secondary"
                size="md"
                onClick={() => onOrder(item)}
                className="shrink-0 !h-10 !px-3.5 !text-[13px]"
              >
                <PlusCircle className="h-4 w-4 text-brand" />
                Order {item.suggestedQty}
              </Button>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}
