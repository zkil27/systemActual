"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { ReturnItemCheck } from "@/components/scan/ReturnItemCheck";
import { formatPeso } from "@/lib/ui/format";
import { toSubmission, type ItemMarks, type ItemProblem } from "@/lib/ui/item-check-ui";

/** One saved line of the latest scan's item check (owner view, with price). */
export interface ItemCheckRow {
  lineKey: string;
  name: string;
  variationName: string | null;
  imageUrl: string | null;
  expectedQty: number;
  goodQty: number;
  damagedQty: number;
  wrongQty: number;
  missingQty: number;
  unitPricePhp: number | null;
  priceSource: string | null;
  /** False when the item isn't linked to a stock item, so the app couldn't put it back on the shelf. */
  stockLinked: boolean;
}

function chips(r: ItemCheckRow): Array<{ text: string; className: string }> {
  const out: Array<{ text: string; className: string }> = [];
  if (r.goodQty) out.push({ text: `${r.goodQty} good`, className: "bg-arrived-soft text-arrived" });
  if (r.damagedQty) out.push({ text: `${r.damagedQty} damaged`, className: "bg-failed-soft text-failed-ink" });
  if (r.wrongQty) out.push({ text: `${r.wrongQty} wrong item`, className: "bg-missing-soft text-missing-ink" });
  if (r.missingQty) out.push({ text: `${r.missingQty} missing`, className: "bg-missing-soft text-missing-ink" });
  return out;
}

/** Turns saved lines back into marks for the fix screen (one problem per line; the worst one). */
export function marksFromRows(rows: ItemCheckRow[]): ItemMarks {
  const marks: ItemMarks = {};
  for (const r of rows) {
    const pick: Array<[ItemProblem, number]> = [
      ["WRONG", r.wrongQty],
      ["MISSING", r.missingQty],
      ["DAMAGED", r.damagedQty],
    ];
    const found = pick.find(([, n]) => n > 0);
    if (found) marks[r.lineKey] = { problem: found[0], count: found[1] };
  }
  return marks;
}

/**
 * Owner's view of an item-by-item return check: what was expected, what came
 * back, and the money side by side (refund vs value of what came back).
 */
export function ReturnCheckCard({
  rows,
  category,
  refundPhp,
  receivedValuePhp,
  packagingTorn,
  saving,
  onFix,
}: {
  rows: ItemCheckRow[];
  category: "FAILED_DELIVERY" | "RETURN_REFUND";
  refundPhp: number;
  receivedValuePhp: number | null;
  packagingTorn: boolean;
  saving: boolean;
  onFix: (body: { checks: ReturnType<typeof toSubmission>; packagingTorn: boolean }) => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [marks, setMarks] = useState<ItemMarks>({});
  const [torn, setTorn] = useState(packagingTorn);
  const lines = useMemo(
    () =>
      rows.map((r) => ({
        lineKey: r.lineKey,
        name: r.name,
        variationName: r.variationName,
        imageUrl: r.imageUrl,
        quantity: r.expectedQty,
      })),
    [rows]
  );
  const expected = rows.reduce((n, r) => n + r.expectedQty, 0);
  const back = rows.reduce((n, r) => n + r.goodQty + r.damagedQty, 0);
  const estimate = rows.some((r) => r.priceSource === "PRO_RATA");
  const cameBack = receivedValuePhp ?? 0;
  const short = Math.max(0, refundPhp - cameBack);
  const notLinked = rows.filter((r) => !r.stockLinked && r.goodQty > 0);

  return (
    <section aria-label="Return check" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-bold text-ink">Return check</h3>
        <span className="text-[15px] font-semibold tabular-nums text-ink-2">
          {back} of {expected} back
        </span>
      </div>

      <ul className="divide-y divide-hairline rounded-[var(--radius-card)] bg-surface-subtle px-3">
        {rows.map((r) => (
          <li key={r.lineKey} className="flex items-center gap-3 py-2.5">
            <ItemThumb src={r.imageUrl} alt={r.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-ink">
                <span className="tabular-nums">{r.expectedQty}× </span>
                {r.name}
                {r.variationName && <span className="font-normal text-ink-2"> · {r.variationName}</span>}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {chips(r).map((c) => (
                  <span key={c.text} className={`rounded-full px-2 py-0.5 text-[13px] font-bold tabular-nums ${c.className}`}>
                    {c.text}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-[15px] tabular-nums text-ink-2">
        {category === "FAILED_DELIVERY" ? "Order value" : "Refund"} {formatPeso(refundPhp)} · Came back{" "}
        {formatPeso(cameBack)}
        {short > 0 && <span className="font-bold text-missing-ink"> · Short {formatPeso(short)}</span>}
        {estimate && <span className="text-ink-3"> (estimate)</span>}
      </p>
      {packagingTorn && <p className="text-[14px] text-ink-3">Pouch was torn.</p>}
      {notLinked.length > 0 && (
        <p className="flex items-start gap-2 text-[14px] font-semibold text-failed-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {notLinked.map((r) => r.name).join(", ")}: not linked to a stock item. Count it on the shelf by hand.
        </p>
      )}

      {fixing ? (
        <div className="space-y-3">
          <ReturnItemCheck
            lines={lines}
            marks={marks}
            onMarksChange={setMarks}
            packagingTorn={torn}
            onPackagingTornChange={setTorn}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => setFixing(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                onFix({ checks: toSubmission(lines, marks), packagingTorn: torn });
                setFixing(false);
              }}
            >
              {saving ? "Saving…" : "Save items"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="plain"
          full
          disabled={saving}
          onClick={() => {
            setMarks(marksFromRows(rows));
            setTorn(packagingTorn);
            setFixing(true);
          }}
        >
          Fix items
        </Button>
      )}
    </section>
  );
}
