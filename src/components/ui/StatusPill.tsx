import type { StatusTone } from "@/lib/ui/parcel-status";

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  missing: { pill: "bg-missing-soft text-missing-ink", dot: "bg-missing" },
  issue: { pill: "bg-failed-soft text-amber-900", dot: "bg-amber-500" },
  overdue: { pill: "bg-failed-soft text-amber-900", dot: "bg-amber-500" },
  arrived: { pill: "bg-arrived-soft text-arrived", dot: "bg-emerald-500" },
  neutral: { pill: "bg-slate-100 text-ink-2", dot: "bg-slate-400" },
};

const TEXT: Record<StatusTone, string> = {
  missing: "text-missing",
  issue: "text-amber-700",
  overdue: "text-amber-700",
  arrived: "text-arrived",
  neutral: "text-ink-3",
};

/** Inline status for list rows: leaves the full row width to the item name. */
export function StatusText({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 font-semibold ${TEXT[tone]}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONES[tone].dot}`} />
      {label}
    </span>
  );
}

/** Colour plus a dot plus the word, so status never relies on colour alone. */
export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const t = TONES[tone];
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-bold ${t.pill}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label}
    </span>
  );
}
