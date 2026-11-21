"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, Group } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { manilaDateTime } from "@/lib/ui/format";
import type { WaveSummary } from "@/lib/waves/plan";

interface WaveRow {
  id: string;
  status: string;
  trigger: string;
  parcelCount: number;
  createdAt: string;
  summary: WaveSummary;
}

const SKIP_LABELS: Array<[keyof WaveSummary["skipped"], string]> = [
  ["tooNew", "less than 1 hour old"],
  ["cancelled", "cancelled or cancel requested"],
  ["notRechecked", "couldn't be re-checked, try again"],
  ["split", "split into several parcels, pack by hand"],
  ["alreadyInWave", "already in another wave"],
  ["notReady", "already arranged"],
];

/** Preview what a wave would ship and print its pick list. Nothing is shipped from here yet. */
export default function WavesPage() {
  const [waves, setWaves] = useState<WaveRow[] | null>(null);
  const [busy, setBusy] = useState<"preview" | "print" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/waves");
    if (res.ok) setWaves((await res.json()).waves);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/waves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data;
  }

  async function preview() {
    setBusy("preview");
    try {
      const data = await post({ action: "preview" });
      toast(`${data.summary.total} parcels ready`);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function printPickList(waveId: string) {
    setBusy("print");
    try {
      await post({ action: "print_pick_list", waveId });
      toast("Pick list sent to the printer");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const latest = waves?.[0];
  const s = latest?.summary;
  const skips = s ? SKIP_LABELS.filter(([k]) => s.skipped[k] > 0) : [];

  return (
    <AppShell title="Waves">
      <div className="space-y-6">
        <Group className="space-y-3 p-4">
          <p className="text-[15px] text-ink-2">
            See what a wave would ship right now, grouped by courier and item. Every order is checked live for
            cancellations. Nothing is shipped or changed on the shops.
          </p>
          <Button full size="lg" disabled={busy !== null} onClick={preview}>
            {busy === "preview" ? "Checking orders…" : "Preview wave"}
          </Button>
        </Group>

        {waves === null ? (
          <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-slate-200/60" aria-busy="true" />
        ) : !latest || !s ? (
          <p className="px-1 text-[16px] text-ink-3">No waves yet.</p>
        ) : (
          <section className="space-y-4">
            <Group className="p-5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-bold text-ink">
                  {latest.status === "PREVIEW" ? "Preview" : latest.status} · {manilaDateTime(latest.createdAt)}
                </span>
              </span>
              <span className="mt-3 block text-[40px] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
                {s.total}
              </span>
              <span className="mt-2 block text-[15px] text-ink-2 tabular-nums">
                parcels · {s.singles} single piece · {s.multis} multi
              </span>
              {skips.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-hairline pt-3 text-[14px] text-ink-3 tabular-nums">
                  {skips.map(([k, label]) => (
                    <li key={k} className={k === "notRechecked" ? "font-semibold text-amber-800" : undefined}>
                      {s.skipped[k]} left out: {label}
                    </li>
                  ))}
                </ul>
              )}
              {s.total > 0 && (
                <Button
                  full
                  variant="secondary"
                  className="mt-4"
                  disabled={busy !== null}
                  onClick={() => printPickList(latest.id)}
                >
                  {busy === "print" ? "Sending…" : "Print pick list"}
                </Button>
              )}
            </Group>

            {s.groups.map((g) => (
              <Group key={g.key}>
                <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
                  <span className="text-[16px] font-bold text-ink">{g.title}</span>
                  <span className="text-[15px] text-ink-3 tabular-nums">{g.count} parcels</span>
                </div>
                <ul className="divide-y divide-hairline px-4 pb-2 pt-2">
                  {g.items.map((it) => (
                    <li key={it.label} className="flex items-baseline gap-3 py-2">
                      <span className="w-10 shrink-0 text-right text-[16px] font-bold tabular-nums text-ink">{it.qty}×</span>
                      <span className="min-w-0 text-[15px] text-ink">{it.label}</span>
                    </li>
                  ))}
                </ul>
              </Group>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
