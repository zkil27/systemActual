import type { StatusTone } from "@/lib/ui/parcel-status";

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  missing: { pill: "bg-missing-soft text-missing-ink", dot: "bg-missing" },
  issue: { pill: "bg-failed-soft text-failed-ink", dot: "bg-failed" },
  overdue: { pill: "bg-failed-soft text-failed-ink", dot: "bg-failed" },
  arrived: { pill: "bg-arrived-soft text-arrived", dot: "bg-arrived" },
  neutral: { pill: "bg-surface-muted text-ink-2", dot: "bg-ink-3/60" },
};

const TEXT: Record<StatusTone, string> = {
  missing: "text-missing",
  issue: "text-failed",
  overdue: "text-failed",
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
