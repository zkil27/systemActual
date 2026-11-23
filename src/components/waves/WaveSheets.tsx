"use client";

import { Check, ChevronRight, Clock, Printer, Truck } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";

export interface PickerOption<T extends string> {
  id: T;
  label: string;
  count?: number | null;
}

/** One-tap list for a single wave filter. Picking closes the sheet. */
export function FilterPickerSheet<T extends string>({
  open,
  onClose,
  title,
  options,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: Array<PickerOption<T>>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ul className="-mx-2 space-y-0.5" role="radiogroup" aria-label={title}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <li key={o.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onChange(o.id);
                  onClose();
                }}
                className={`pressable-row flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-[16px] font-semibold ${
                  active ? "bg-brand-soft text-brand" : "text-ink hover:bg-surface-subtle active:bg-surface-muted"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count != null && (
                  <span className={`tabular-nums text-[15px] ${active ? "text-brand" : "text-ink-3"}`}>{o.count}</span>
                )}
                <Check className={`h-5 w-5 shrink-0 ${active ? "" : "invisible"}`} strokeWidth={2.4} />
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

export type ToolSheet = "schedule" | "reprint" | "handover";

/** Entry point for the occasional Ship tools, opened from the header. */
export function WaveToolsMenu({
  open,
  onClose,
  onPick,
  scheduleStatus,
  handoverWaiting,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (tool: ToolSheet) => void;
  scheduleStatus: string;
  handoverWaiting: number | null;
}) {
  const rows: Array<{ id: ToolSheet; label: string; detail: string | null; Icon: typeof Clock }> = [
    { id: "schedule", label: "Auto-ship schedule", detail: scheduleStatus, Icon: Clock },
    { id: "reprint", label: "Reprint a label", detail: null, Icon: Printer },
    {
      id: "handover",
      label: "Courier handover",
      detail: handoverWaiting ? `${handoverWaiting} waiting` : null,
      Icon: Truck,
    },
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Ship tools">
      <ul className="-mx-2 space-y-0.5">
        {rows.map(({ id, label, detail, Icon }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onPick(id)}
              className="pressable-row flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-2">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1 text-[16px] font-semibold text-ink">{label}</span>
              {detail && <span className="shrink-0 text-[14px] text-ink-3 tabular-nums">{detail}</span>}
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-3/70" />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
