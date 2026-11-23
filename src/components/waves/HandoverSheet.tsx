"use client";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import type { CourierHandoverSummary } from "@/lib/print/handover";

/** Today's per-courier handover counts, with a slip to print or open as PDF. */
export function HandoverSheet({
  open,
  onClose,
  handover,
  busy,
  onPrintSlip,
}: {
  open: boolean;
  onClose: () => void;
  handover: CourierHandoverSummary[];
  busy: boolean;
  onPrintSlip: (courier: string) => void;
}) {
  async function openPdf(courier: string) {
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courier, mode: "pdf" }),
    });
    if (!res.ok) return toast("Couldn't open slip", "error");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <Sheet open={open} onClose={onClose} title="Courier handover today">
      {handover.length === 0 ? (
        <p className="py-2 text-[15px] text-ink-3">No labels printed today yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {handover.map((h) => (
            <li key={h.courier} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-[15px] font-bold text-ink">{h.courier}</span>
                <span className="block text-[13px] text-ink-3 tabular-nums">
                  {h.totalPrinted} printed · {h.handedOverCount} picked up · {h.awaitingPickupCount} waiting
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="secondary"
                  disabled={busy}
                  className="h-11 px-3 text-[14px]"
                  onClick={() => onPrintSlip(h.courier)}
                >
                  Print slip
                </Button>
                <button
                  type="button"
                  onClick={() => void openPdf(h.courier)}
                  className="pressable inline-flex h-11 items-center rounded-[var(--radius-control)] bg-surface-muted px-3 text-[13px] font-semibold text-ink hover:bg-surface-track"
                >
                  PDF
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
