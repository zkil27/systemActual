import { ChevronRight } from "lucide-react";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { StatusText } from "@/components/ui/StatusPill";
import { categoryLabel, getParcelStatus } from "@/lib/ui/parcel-status";

export interface ParcelRowData {
  id: string;
  category: string;
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  itemImageUrl: string | null;
  physicallyReceivedAt: string | null;
  physicalCondition: string | null;
  isMissingDiscrepancy: boolean;
  isOverdueRts?: boolean;
  expectsPhysicalReturn?: boolean;
  digitalStatus?: string;
}

/**
 * Photo, name, then one quiet line: status · category · size/colour.
 * The separator starts at the text, iOS-style, so photos read as a column.
 */
export function ParcelRow({
  parcel,
  first,
  onOpen,
}: {
  parcel: ParcelRowData;
  first: boolean;
  onOpen: (id: string) => void;
}) {
  const status = getParcelStatus(parcel);
  return (
    <button
      type="button"
      onClick={() => onOpen(parcel.id)}
      className="flex w-full items-center gap-3.5 pl-4 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
    >
      <ItemThumb src={parcel.itemImageUrl} alt={parcel.itemSummary} />
      <span
        className={`flex min-h-[76px] min-w-0 flex-1 items-center gap-2 py-3 pr-3 ${
          first ? "" : "border-t border-hairline"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold text-ink">
            {parcel.quantity > 1 && <span className="tabular-nums">{parcel.quantity}× </span>}
            {parcel.itemSummary}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[15px] text-ink-3">
            <StatusText label={status.label} tone={status.tone} />
            <span className="truncate">
              · {[categoryLabel(parcel.category), parcel.variationName].filter(Boolean).join(" · ")}
            </span>
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-hairline-strong" />
      </span>
    </button>
  );
}
