"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, PackageX, Printer, Undo2 } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Sheet } from "@/components/ui/Sheet";
import type { StaffSafeOutboundPackage } from "@/lib/auth";
import { shortCourier } from "@/lib/ui/format";

export interface PickVariantTarget {
  checkKey: string;
  garmentName: string;
  imageUrl: string | null;
  color: string | null;
  size: string | null;
  qty: number;
  garmentVariantId: string | null;
  checked: boolean;
}

function stockHref(mode: "EMPTY_SHELF" | "DEFECTIVE", target: PickVariantTarget): string {
  if (target.garmentVariantId) {
    return `/stock-in?mode=${mode}&variantId=${encodeURIComponent(target.garmentVariantId)}`;
  }
  return `/stock-in?mode=${mode}&q=${encodeURIComponent(target.garmentName)}`;
}

/**
 * Row action sheet for a pick-list garment variant.
 * Keeps secondary/exception actions (0 left, damaged) 1 tap away without
 * putting red warning pills on every row of the pick list.
 */
export function PickVariantActionSheet({
  target,
  onClose,
  onToggleChecked,
}: {
  target: PickVariantTarget | null;
  onClose: () => void;
  onToggleChecked: (checkKey: string) => void;
}) {
  const [cached, setCached] = useState<PickVariantTarget | null>(target);

  useEffect(() => {
    if (target) setCached(target);
  }, [target]);

  const current = target ?? cached;
  const variantLine = [current?.color ?? "Standard", current?.size].filter(Boolean).join(" · ");

  return (
    <Sheet open={target !== null} onClose={onClose} title="Item options">
      {current && (
        <div className="space-y-5 pt-1">
          <div className="flex items-center gap-3.5">
            <ItemThumb src={current.imageUrl} alt={current.garmentName} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-bold leading-snug text-ink">{current.garmentName}</p>
              <p className="mt-0.5 text-[15px] text-ink-2 tabular-nums">
                <span className="font-bold text-ink">{current.qty}×</span>
                {" · "}
                {variantLine}
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            <Button
              full
              variant={current.checked ? "secondary" : "primary"}
              onClick={() => {
                onToggleChecked(current.checkKey);
                onClose();
              }}
            >
              {current.checked ? (
                <>
                  <Undo2 className="h-5 w-5" />
                  Mark as not picked
                </>
              ) : (
                <>
                  <Check className="h-5 w-5" strokeWidth={2.6} />
                  Mark as picked
                </>
              )}
            </Button>

            <ButtonLink full variant="danger" href={stockHref("EMPTY_SHELF", current)}>
              <PackageX className="h-5 w-5" />
              Shelf is empty (0 left)
            </ButtonLink>

            <ButtonLink full variant="secondary" href={stockHref("DEFECTIVE", current)}>
              <AlertTriangle className="h-5 w-5" />
              Report damaged piece
            </ButtonLink>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export interface MultiParcelTarget {
  checkKey: string;
  code6: string;
  parcel: StaffSafeOutboundPackage;
  checked: boolean;
}

/**
 * Action sheet for a multi-item parcel card so Reprint does not repeat
 * across every card in the list.
 */
export function MultiParcelActionSheet({
  target,
  reprintingSn,
  onClose,
  onToggleChecked,
  onReprintLabel,
}: {
  target: MultiParcelTarget | null;
  reprintingSn: string | null;
  onClose: () => void;
  onToggleChecked: (checkKey: string) => void;
  onReprintLabel: (orderSn: string) => Promise<void> | void;
}) {
  const [cached, setCached] = useState<MultiParcelTarget | null>(target);

  useEffect(() => {
    if (target) setCached(target);
  }, [target]);

  const current = target ?? cached;
  const reprinting = current ? reprintingSn === current.parcel.orderSn : false;

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title={current ? `Parcel ···${current.code6}` : "Parcel options"}
    >
      {current && (
        <div className="space-y-5 pt-1">
          <p className="text-[15px] text-ink-2 tabular-nums">
            {current.parcel.totalPieces} pieces · {shortCourier(current.parcel.courier)} · Order{" "}
            {current.parcel.orderSn}
          </p>

          <div className="space-y-2.5">
            <Button
              full
              variant={current.checked ? "secondary" : "primary"}
              onClick={() => {
                onToggleChecked(current.checkKey);
                onClose();
              }}
            >
              {current.checked ? (
                <>
                  <Undo2 className="h-5 w-5" />
                  Mark as not packed
                </>
              ) : (
                <>
                  <Check className="h-5 w-5" strokeWidth={2.6} />
                  Mark parcel packed
                </>
              )}
            </Button>

            {current.parcel.canReprint && (
              <Button
                full
                variant="secondary"
                disabled={reprinting}
                onClick={async () => {
                  await onReprintLabel(current.parcel.orderSn);
                  onClose();
                }}
              >
                <Printer className="h-5 w-5" />
                {reprinting ? "Sending to printer…" : "Reprint shipping label"}
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
