"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Package2 } from "lucide-react";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Sheet } from "@/components/ui/Sheet";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatPeso, manilaDateTime } from "@/lib/ui/format";
import type { StatusTone } from "@/lib/ui/parcel-status";
import { parsePickItemLabel, type WaveParcel, type WaveParcelLine } from "@/lib/waves/plan";

export interface WaveParcelSelection {
  title: string;
  subtitle?: string;
  variantLabel?: string;
  parcels: WaveParcel[];
  initialParcelId?: string;
}

const WAVE_ITEM_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  READY: { label: "Ready to ship", tone: "neutral" },
  SHIPPING_ARRANGED: { label: "Shipping arranged", tone: "neutral" },
  TRACKING_ASSIGNED: { label: "Making label", tone: "neutral" },
  LABEL_READY: { label: "Label queued", tone: "arrived" },
  PRINTED: { label: "Printed", tone: "arrived" },
  SKIPPED_CANCELLED: { label: "Cancelled", tone: "overdue" },
  FAILED: { label: "Needs attention", tone: "missing" },
};

function lineMatchesVariant(line: WaveParcelLine, variantLabel?: string): boolean {
  if (!variantLabel) return false;
  if (line.label === variantLabel) return true;
  const a = parsePickItemLabel(line.label);
  const b = parsePickItemLabel(variantLabel);
  return (
    a.shortGarmentName.toLowerCase() === b.shortGarmentName.toLowerCase() &&
    (a.variation ?? "").toLowerCase() === (b.variation ?? "").toLowerCase()
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="shrink-0 text-[15px] text-ink-3">{label}</dt>
      <dd className="min-w-0 break-all text-right text-[15px] font-semibold text-ink tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function SingleParcelView({
  parcel,
  selection,
  showFullNames,
  onBack,
}: {
  parcel: WaveParcel;
  selection: WaveParcelSelection;
  showFullNames: boolean;
  onBack?: () => void;
}) {
  const statusInfo = WAVE_ITEM_STATUS[parcel.status] ?? { label: parcel.status, tone: "neutral" as const };
  const isMulti = parcel.totalPieces > 1 || parcel.lines.length > 1;
  const shopPlatform = parcel.platform === "SHOPEE" ? "Shopee" : "TikTok Shop";

  return (
    <div className="anim-fade-in space-y-5 pt-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="pressable inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-slate-200/70"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to {selection.parcels.length} parcels
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 items-center rounded-full bg-ink px-2.5 text-[13px] font-bold text-white tabular-nums">
            Parcel #{parcel.position} of {parcel.totalInWave}
          </span>
          <StatusPill label={statusInfo.label} tone={statusInfo.tone} />
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-bold ${
              parcel.isCod ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {parcel.isCod ? "COD" : "Prepaid"}
          </span>
          <span className="text-[16px] font-extrabold text-ink tabular-nums">
            {formatPeso(parcel.totalPhp)}
          </span>
        </div>
      </div>

      {isMulti && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] bg-brand-soft px-3.5 py-2.5 text-[14px] font-semibold text-brand ring-1 ring-brand/25">
          <Package2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Multi-item parcel · {parcel.totalPieces} pieces across {parcel.lines.length}{" "}
            {parcel.lines.length === 1 ? "item" : "items"} — pack together
          </span>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-ink-3">
          Items in parcel ({parcel.totalPieces} {parcel.totalPieces === 1 ? "pc" : "pcs"})
        </h3>
        <ul className="divide-y divide-hairline border-t border-hairline">
          {parcel.lines.map((line) => {
            const highlighted =
              parcel.lines.length > 1 && lineMatchesVariant(line, selection.variantLabel);
            const displayName = showFullNames ? line.name : line.shortName;
            return (
              <li
                key={line.id}
                className={`flex items-start gap-3.5 py-3.5 ${
                  highlighted ? "-mx-2 rounded-[var(--radius-control)] bg-brand-soft/60 px-2" : ""
                }`}
              >
                <ItemThumb src={line.imageUrl} alt={displayName} size="lg" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[16px] font-bold leading-snug text-ink" title={line.name}>
                      <span className="mr-1.5 inline-flex min-w-7 items-center justify-center rounded-md bg-ink px-1.5 py-0.5 text-[13px] font-extrabold text-white tabular-nums">
                        {line.quantity}×
                      </span>
                      {displayName}
                    </p>
                  </div>
                  {(line.color || line.size || line.variationName) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {line.color && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[13px] font-semibold text-ink">
                          {line.color}
                        </span>
                      )}
                      {line.size && (
                        <span className="rounded-md bg-white px-2 py-0.5 text-[13px] font-semibold text-ink-2 ring-1 ring-hairline tabular-nums">
                          {line.size}
                        </span>
                      )}
                      {!line.color && !line.size && line.variationName && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[13px] font-semibold text-ink">
                          {line.variationName}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-[14px] text-ink-3 tabular-nums">
                    {formatPeso(line.unitPricePhp)} each
                    {line.quantity > 1 && (
                      <span> · {formatPeso(line.unitPricePhp * line.quantity)} line total</span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {parcel.error && (
        <div className="rounded-[var(--radius-control)] bg-missing-soft px-3.5 py-2.5 text-[14px] font-semibold text-missing-ink">
          {parcel.error}
        </div>
      )}

      <div>
        <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-ink-3">
          Order details
        </h3>
        <dl className="divide-y divide-hairline border-t border-hairline">
          <DetailRow label="Order #" value={parcel.orderSn} />
          <DetailRow label="Shop" value={`${shopPlatform} (${parcel.shopName})`} />
          <DetailRow label="Courier" value={parcel.courier} />
          <DetailRow
            label="Tracking #"
            value={
              parcel.trackingNumber || (
                <span className="font-normal text-ink-3">Assigned when shipped</span>
              )
            }
          />
          <DetailRow
            label="Wave position"
            value={`#${parcel.position} of ${parcel.totalInWave} in print order`}
          />
          <DetailRow
            label="Order total"
            value={`${formatPeso(parcel.totalPhp)} · ${
              parcel.isCod ? "Cash on delivery (COD)" : "Prepaid"
            }`}
          />
          <DetailRow label="Ordered" value={manilaDateTime(parcel.createdAt)} />
        </dl>
      </div>
    </div>
  );
}

function MultiParcelListView({
  selection,
  showFullNames,
  onSelectParcel,
}: {
  selection: WaveParcelSelection;
  showFullNames: boolean;
  onSelectParcel: (parcelId: string) => void;
}) {
  return (
    <div className="anim-fade-in space-y-3 pt-1">
      {selection.subtitle && (
        <p className="text-[14px] text-ink-3 tabular-nums">
          {selection.subtitle} · tap a parcel to see full details
        </p>
      )}
      <ul className="divide-y divide-hairline border-t border-hairline">
        {selection.parcels.map((parcel) => {
          const matchingLine =
            parcel.lines.find((l) => lineMatchesVariant(l, selection.variantLabel)) ?? parcel.lines[0];
          const otherLines = parcel.lines.filter((l) => l.id !== matchingLine?.id);
          const isMulti = parcel.totalPieces > 1 || parcel.lines.length > 1;

          return (
            <li key={parcel.id}>
              <button
                type="button"
                onClick={() => onSelectParcel(parcel.id)}
                className="pressable flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
              >
                <ItemThumb
                  src={matchingLine?.imageUrl ?? null}
                  alt={matchingLine ? (showFullNames ? matchingLine.name : matchingLine.shortName) : parcel.orderSn}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-md bg-ink px-1.5 py-0.5 text-[12px] font-bold text-white tabular-nums">
                      #{parcel.position}
                    </span>
                    <span className="truncate text-[15px] font-bold text-ink tabular-nums">
                      {parcel.orderSn}
                    </span>
                    {matchingLine && (
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-bold text-ink tabular-nums">
                        {matchingLine.quantity}×
                      </span>
                    )}
                    {isMulti && (
                      <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-bold text-brand tabular-nums">
                        Multi · {parcel.totalPieces} pcs total
                      </span>
                    )}
                  </div>

                  {otherLines.length > 0 && (
                    <p className="mt-1 truncate text-[13px] text-ink-2">
                      Also includes:{" "}
                      {otherLines
                        .map((l) => {
                          const name = showFullNames ? l.name : l.shortName;
                          const variant = l.variationName ? ` (${l.variationName})` : "";
                          return `${l.quantity}× ${name}${variant}`;
                        })
                        .join(", ")}
                    </p>
                  )}

                  <p className="mt-1 text-[13px] text-ink-3 tabular-nums">
                    <span className="font-semibold text-ink-2">
                      {parcel.isCod ? "COD" : "Prepaid"} · {formatPeso(parcel.totalPhp)}
                    </span>
                    {" · "}
                    {manilaDateTime(parcel.createdAt)}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-hairline-strong" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Sheet showing either a single wave parcel's full items & order details,
 * or the list of parcels containing a selected pick-list variant.
 */
export function WaveParcelSheet({
  selection,
  showFullNames = false,
  onClose,
}: {
  selection: WaveParcelSelection | null;
  showFullNames?: boolean;
  onClose: () => void;
}) {
  // Keep last selection while the sheet animates out.
  const [cached, setCached] = useState<WaveParcelSelection | null>(selection);
  const [activeParcelId, setActiveParcelId] = useState<string | null>(null);

  useEffect(() => {
    if (!selection) return;
    setCached(selection);
    if (selection.initialParcelId) {
      setActiveParcelId(selection.initialParcelId);
    } else if (selection.parcels.length === 1) {
      setActiveParcelId(selection.parcels[0].id);
    } else {
      setActiveParcelId(null);
    }
  }, [selection]);

  const current = selection ?? cached;
  const activeParcel =
    current && activeParcelId ? current.parcels.find((p) => p.id === activeParcelId) ?? null : null;

  const sheetTitle = activeParcel
    ? `Parcel #${activeParcel.position}`
    : current?.title || "Parcels";

  return (
    <Sheet open={selection !== null} onClose={onClose} title={sheetTitle}>
      {!current || current.parcels.length === 0 ? (
        <p className="py-6 text-center text-[15px] text-ink-3">
          Parcel details are not available for this wave. Try running a new preview.
        </p>
      ) : activeParcel ? (
        <SingleParcelView
          parcel={activeParcel}
          selection={current}
          showFullNames={showFullNames}
          onBack={
            current.parcels.length > 1 && !current.initialParcelId
              ? () => setActiveParcelId(null)
              : undefined
          }
        />
      ) : (
        <MultiParcelListView
          selection={current}
          showFullNames={showFullNames}
          onSelectParcel={(id) => setActiveParcelId(id)}
        />
      )}
    </Sheet>
  );
}
