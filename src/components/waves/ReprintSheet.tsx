"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";

export interface ReprintRangeTarget {
  waveId: string;
  parcelCount: number;
  groups: Array<{ key: string; title: string; count: number }>;
}

/** Reprint one label by order number, or (after a wave printed) a position range. */
export function ReprintSheet({
  open,
  onClose,
  busy,
  rangeTarget,
  onReprint,
  onReprintRange,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  /** Set when the selected wave has printed or queued labels. */
  rangeTarget: ReprintRangeTarget | null;
  onReprint: (orderSn: string) => Promise<boolean>;
  onReprintRange: (fromPos: number, toPos: number, groupKey: string | null) => Promise<boolean>;
}) {
  const [reprintSn, setReprintSn] = useState("");
  const [rangeFrom, setRangeFrom] = useState("1");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeGroup, setRangeGroup] = useState("");

  const inputClass =
    "rounded-[var(--radius-control)] bg-surface-muted text-[16px] text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none";

  return (
    <Sheet open={open} onClose={onClose} title="Reprint a label">
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onReprint(reprintSn)) setReprintSn("");
          }}
        >
          <input
            value={reprintSn}
            onChange={(e) => setReprintSn(e.target.value)}
            placeholder="Order number"
            autoCapitalize="characters"
            aria-label="Order number"
            className={`h-12 min-w-0 flex-1 px-4 ${inputClass}`}
          />
          <Button type="submit" variant="secondary" disabled={busy || reprintSn.trim().length < 3}>
            Reprint
          </Button>
        </form>

        {rangeTarget && (
          <form
            className="space-y-2.5 border-t border-hairline pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fromPos = Number(rangeFrom || 1);
              const toPos = Number(rangeTo || rangeTarget.parcelCount);
              if (!Number.isInteger(fromPos) || !Number.isInteger(toPos) || fromPos < 1 || toPos < fromPos) {
                toast("Enter a valid parcel range (e.g. 47 to 200)", "error");
                return;
              }
              void onReprintRange(fromPos, toPos, rangeGroup || null);
            }}
          >
            <p className="text-[13px] font-semibold text-ink-2">
              Printer jammed? Reprint a position range from the selected wave (#1–#{rangeTarget.parcelCount})
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={rangeTarget.parcelCount}
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                placeholder="From #"
                aria-label="From parcel number"
                className={`h-11 w-24 px-3 tabular-nums ${inputClass}`}
              />
              <span className="text-[14px] text-ink-3">to</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={rangeTarget.parcelCount}
                value={rangeTo || String(rangeTarget.parcelCount)}
                onChange={(e) => setRangeTo(e.target.value)}
                placeholder={String(rangeTarget.parcelCount)}
                aria-label="To parcel number"
                className={`h-11 w-24 px-3 tabular-nums ${inputClass}`}
              />
              <Button type="submit" variant="secondary" disabled={busy} className="h-11 flex-1 px-3">
                Reprint range
              </Button>
            </div>
            {rangeTarget.groups.length > 1 && (
              <select
                value={rangeGroup}
                onChange={(e) => setRangeGroup(e.target.value)}
                aria-label="Filter range by courier stack"
                className="h-11 w-full rounded-[var(--radius-control)] bg-surface-muted px-3 text-[16px] text-ink"
              >
                <option value="">All courier stacks</option>
                {rangeTarget.groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.title} ({g.count})
                  </option>
                ))}
              </select>
            )}
          </form>
        )}
      </div>
    </Sheet>
  );
}
