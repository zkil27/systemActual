"use client";

import { useId, useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { StatusText } from "@/components/ui/StatusPill";
import { toast } from "@/components/ui/Toast";
import type { StatusTone } from "@/lib/ui/parcel-status";
import type { OrderPanel } from "@/lib/chats/types";

function toneFor(label: string): StatusTone {
  const l = label.toLowerCase();
  if (l.includes("cancel")) return "missing";
  if (l.includes("return")) return "issue";
  if (l === "delivered" || l === "completed") return "arrived";
  return "neutral";
}

/** The older copy command still works where the Clipboard API is missing (plain http on the shop Wi-Fi). */
function legacyCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  el.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  el.remove();
  return ok;
}

async function copyText(text: string, done: string) {
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) ok = legacyCopy(text);
  if (ok) toast(done);
  else toast("Couldn't copy. Press and hold the number to copy it.", "error");
}

/** The buyer's order beside the chat. Collapsed it's one row, so the messages keep the room. */
export function OrderCard({ order, defaultOpen = false }: { order: OrderPanel; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="pressable-row flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-card)] px-3 py-2 text-left hover:bg-surface-subtle"
      >
        <ItemThumb src={order.photoUrl} alt={order.itemName} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">{order.itemName}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <StatusText label={order.statusLabel} tone={toneFor(order.statusLabel)} />
            {(order.variation || order.moreItems > 0) && (
              <span className="truncate text-ink-3">
                · {[order.variation, order.moreItems > 0 ? `+${order.moreItems} more` : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-ink-3 transition-transform duration-200 ease-[var(--ease-ios)] ${open ? "rotate-180" : ""}`}
        />
        <span className="sr-only">{open ? "Hide order details" : "Show order details"}</span>
      </button>

      {open && (
        <dl id={panelId} className="anim-fade-in divide-y divide-hairline border-t border-hairline text-[15px]">
          <Row label="Order" value={order.orderSn} onCopy={() => copyText(order.orderSn, "Order number copied")} />
          <Row label="Courier" value={order.carrier ?? "Not picked yet"} />
          <Row
            label="Tracking"
            value={order.trackingNumber ?? "No tracking number yet"}
            muted={!order.trackingNumber}
            onCopy={
              order.trackingNumber
                ? () => copyText(order.trackingNumber as string, "Tracking number copied")
                : undefined
            }
          />
        </dl>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  onCopy,
}: {
  label: string;
  value: string;
  muted?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 pl-4 pr-1">
      <dt className="w-20 shrink-0 text-ink-3">{label}</dt>
      <dd className={`tabular-nums min-w-0 flex-1 select-all break-all font-semibold ${muted ? "text-ink-3" : "text-ink"}`}>
        {value}
      </dd>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()} number`}
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand hover:bg-brand-soft"
        >
          <Copy className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  );
}
