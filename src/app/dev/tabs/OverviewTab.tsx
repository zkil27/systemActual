"use client";

import { Button } from "@/components/ui/Button";
import type { DevCard } from "@/lib/dev/overview";
import type { TabId } from "../DevClient";
import { Dot, fmtAgo, Notes, TabState, useDevData } from "../ui";

const CARD_TAB: Record<string, TabId> = {
  db: "database",
  errors: "errors",
  tick: "jobs",
  events: "jobs",
  throttle: "jobs",
  backup: "controls",
  migrations: "controls",
  maintenance: "controls",
};

export function OverviewTab({ onOpen }: { onOpen: (tab: TabId) => void }) {
  const { data, error, loading, reload } = useDevData<{
    cards: DevCard[];
    notes: Record<string, string>;
    checkedAt: string;
  }>("/api/dev/overview");

  if (!data) return <TabState loading={loading} error={error} onRetry={reload} />;
  const order = { bad: 0, warn: 1, ok: 2 } as const;
  const cards = [...data.cards].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(CARD_TAB[c.id] ?? (c.id.startsWith("token:") ? "jobs" : "overview"))}
            className="pressable flex flex-col gap-1 rounded-[var(--radius-card)] bg-surface p-4 text-left shadow-[var(--shadow-card)] hover:bg-surface-subtle"
          >
            <span className="flex items-center gap-2 text-[14px] font-semibold text-ink-2">
              <Dot level={c.level} />
              {c.label}
            </span>
            <span className="text-[24px] font-extrabold tabular-nums tracking-tight text-ink">{c.value}</span>
            <span className="text-[13px] text-ink-3">{c.detail}</span>
          </button>
        ))}
      </div>
      <Notes notes={data.notes} />
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-[13px] text-ink-3">Checked {fmtAgo(data.checkedAt)}</span>
        <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
          {loading ? "Checking…" : "Refresh"}
        </Button>
      </div>
    </div>
  );
}
