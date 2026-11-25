"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import type { StaffSafeParcelLine } from "@/lib/auth";
import { haptic } from "@/lib/ui/motion";
import {
  PROBLEMS,
  clearMark,
  countChoices,
  markProblem,
  marksSummary,
  setMarkCount,
  type ItemMarks,
  type ItemProblem,
} from "@/lib/ui/item-check-ui";

const PROBLEM_STYLE: Record<ItemProblem, { pill: string; button: string }> = {
  MISSING: { pill: "bg-missing-soft text-missing-ink", button: "bg-missing-solid text-white" },
  WRONG: { pill: "bg-missing-soft text-missing-ink", button: "bg-missing-solid text-white" },
  DAMAGED: { pill: "bg-failed-soft text-failed-ink", button: "bg-amber-600 text-white" },
};

const PROBLEM_WORD: Record<ItemProblem, string> = { MISSING: "Missing", WRONG: "Wrong item", DAMAGED: "Damaged" };

/**
 * Item-by-item return check for parcels with more than one piece. Every item
 * starts as Received; staff tap only the one that's wrong. No typing, no
 * item barcodes, no prices.
 */
export function ReturnItemCheck({
  lines,
  marks,
  onMarksChange,
  packagingTorn,
  onPackagingTornChange,
}: {
  lines: StaffSafeParcelLine[];
  marks: ItemMarks;
  onMarksChange: (next: ItemMarks) => void;
  packagingTorn: boolean;
  onPackagingTornChange: (next: boolean) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  function pick(line: StaffSafeParcelLine, problem: ItemProblem | null) {
    haptic(10);
    if (!problem) {
      onMarksChange(clearMark(marks, line.lineKey));
      setOpenKey(null);
      return;
    }
    onMarksChange(markProblem(marks, line, problem));
    // One piece: nothing more to ask. More pieces: stay open for "How many?".
    if (line.quantity === 1) setOpenKey(null);
  }

  return (
    <div className="space-y-3">
      <p className="px-1 text-[15px] font-semibold text-ink-2">Tap an item only if something is wrong.</p>
      <Group>
        <ul className="divide-y divide-hairline">
          {lines.map((line) => {
            const mark = marks[line.lineKey];
            const open = openKey === line.lineKey;
            return (
              <li key={line.lineKey}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : line.lineKey)}
                  className="pressable flex w-full items-center gap-3.5 px-4 py-3 text-left hover:bg-surface-subtle"
                >
                  <ItemThumb src={line.imageUrl} alt={line.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[17px] font-bold leading-snug text-ink">
                      <span className="tabular-nums">{line.quantity}× </span>
                      {line.name}
                    </p>
                    {line.variationName && (
                      <p className="mt-1 inline-block rounded-lg bg-surface-track/80 px-2 py-0.5 text-[15px] font-bold text-ink">
                        {line.variationName}
                      </p>
                    )}
                  </div>
                  {mark ? (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[14px] font-bold ${PROBLEM_STYLE[mark.problem].pill}`}>
                      {PROBLEM_WORD[mark.problem]}
                      {line.quantity > 1 && <span className="tabular-nums"> {mark.count === line.quantity ? "all" : mark.count}</span>}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-arrived-soft px-2.5 py-1 text-[14px] font-bold text-arrived">
                      <Check className="h-4 w-4" strokeWidth={3} />
                      OK
                    </span>
                  )}
                </button>

                {open && (
                  <div className="anim-fade-in space-y-3 bg-surface-subtle px-4 pb-4 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => pick(line, null)}
                        className={`pressable h-12 rounded-[var(--radius-control)] text-[16px] font-bold ${
                          !mark ? "bg-arrived-solid text-white" : "bg-surface text-ink ring-1 ring-hairline"
                        }`}
                      >
                        Received
                      </button>
                      {PROBLEMS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => pick(line, p.id)}
                          className={`pressable h-12 rounded-[var(--radius-control)] text-[16px] font-bold ${
                            mark?.problem === p.id ? PROBLEM_STYLE[p.id].button : "bg-surface text-ink ring-1 ring-hairline"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    {mark && line.quantity > 1 && (
                      <div>
                        <p className="mb-2 text-[15px] font-semibold text-ink-2">How many?</p>
                        <div className="flex gap-2">
                          {countChoices(line.quantity).map((c) => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={() => {
                                haptic(10);
                                onMarksChange(setMarkCount(marks, line, c.count));
                                setOpenKey(null);
                              }}
                              className={`pressable h-12 min-w-14 flex-1 rounded-[var(--radius-control)] text-[17px] font-bold tabular-nums ${
                                mark.count === c.count ? "bg-ink text-ink-inverse" : "bg-surface text-ink ring-1 ring-hairline"
                              }`}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Group>

      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-[15px] font-bold tabular-nums text-ink">{marksSummary(lines, marks)}</span>
        <button
          type="button"
          aria-pressed={packagingTorn}
          onClick={() => onPackagingTornChange(!packagingTorn)}
          className={`pressable h-10 rounded-full px-4 text-[15px] font-semibold ${
            packagingTorn ? "bg-ink text-ink-inverse" : "bg-surface-muted text-ink-2"
          }`}
        >
          Pouch torn
        </button>
      </div>
    </div>
  );
}
