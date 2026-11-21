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
  progress: Partial<Record<string, number>>;
  failed: Array<{ id: string; orderSn: string; error: string | null }>;
}

interface Schedule {
  auto: boolean;
  times: string[];
  nextAt: string | null;
}

/** "08:30" → "8:30 AM" */
function clock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const PROGRESS: Array<[string, string]> = [
  ["READY", "waiting to ship"],
  ["SHIPPING_ARRANGED", "shipped, waiting for waybill"],
  ["TRACKING_ASSIGNED", "making label"],
  ["LABEL_READY", "label queued"],
  ["PRINTED", "printed"],
  ["SKIPPED_CANCELLED", "cancelled, left out"],
  ["FAILED", "need attention"],
];

const PREVIEW_MAX_AGE_MS = 30 * 60_000;

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
  const [canShip, setCanShip] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [timesText, setTimesText] = useState("");
  const [reprintSn, setReprintSn] = useState("");
  const [busy, setBusy] = useState<"preview" | "print" | "start" | "ship" | "retry" | "schedule" | "reprint" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/waves");
    if (!res.ok) return;
    const data = await res.json();
    setWaves(data.waves);
    setCanShip(Boolean(data.canShip));
    setSchedule(data.schedule);
    setTimesText((prev) => prev || (data.schedule?.times ?? []).join(", "));
  }, []);

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<string | void>) {
    setBusy(kind);
    try {
      const msg = await fn();
      if (msg) toast(msg);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function saveSchedule(auto: boolean) {
    if (
      auto &&
      !window.confirm(
        "Ship waves by themselves at these times? Each one arranges pickup on the shops and prints labels, with no tap. The warehouse PC must be on."
      )
    ) {
      return;
    }
    await run("schedule", async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_settings", waveTimes: timesText, wavesAutoEnabled: auto }),
      });
      if (!res.ok) throw new Error("Couldn't save");
      setTimesText("");
      return auto ? "Automatic waves on" : "Saved";
    });
  }

  function shipNowClick() {
    if (!window.confirm("Ship everything that's ready now? This arranges pickup on the shops and prints labels. It can't be undone.")) return;
    run("ship", async () => {
      const data = await post({ action: "ship_now" });
      return data.shipping ? `Shipping ${data.shipping} parcels` : "Nothing ready to ship";
    });
  }

  useEffect(() => {
    load();
  }, [load]);

  const running = waves?.some((w) => w.status === "RUNNING");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  async function start(wave: WaveRow) {
    if (
      !window.confirm(
        `Ship ${wave.parcelCount} parcels now? Kyna Ops will arrange pickup on the shops and print the labels. This can't be undone. Each order is checked for cancellation again just before it ships.`
      )
    ) {
      return;
    }
    setBusy("start");
    try {
      const data = await post({ action: "start", waveId: wave.id });
      toast(`Shipping ${data.shipping} parcels`);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

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

  async function preview(limit?: number) {
    setBusy("preview");
    try {
      const data = await post({ action: "preview", ...(limit ? { limit } : {}) });
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
          <Button full size="lg" disabled={busy !== null} onClick={() => preview()}>
            {busy === "preview" ? "Checking orders…" : "Preview wave"}
          </Button>
          <Button full variant="plain" disabled={busy !== null} onClick={() => preview(5)}>
            Preview a test wave (5 parcels)
          </Button>
          {canShip && (
            <Button full variant="secondary" disabled={busy !== null || Boolean(running)} onClick={shipNowClick}>
              {busy === "ship" ? "Starting…" : running ? "A wave is shipping" : "Print wave now"}
            </Button>
          )}
        </Group>

        <Group className="space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[17px] font-bold text-ink">Wave times</span>
            <span className={`text-[15px] font-semibold ${schedule?.auto ? "text-arrived" : "text-ink-3"}`}>
              {schedule?.auto ? "Automatic" : "Off"}
            </span>
          </div>
          {schedule?.auto && schedule.nextAt && (
            <p className="text-[14px] text-ink-3">Next wave {manilaDateTime(schedule.nextAt)}</p>
          )}
          <label className="block">
            <span className="sr-only">Wave times, Manila time</span>
            <input
              value={timesText}
              onChange={(e) => setTimesText(e.target.value)}
              placeholder="08:30, 12:30, 15:30"
              className="h-12 w-full rounded-[var(--radius-control)] bg-slate-100 px-4 text-[16px] tabular-nums text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
            />
          </label>
          {schedule && schedule.times.length > 0 && (
            <p className="text-[13px] text-ink-3">{schedule.times.map(clock).join(" · ")} (Manila time, 24-hour HH:MM)</p>
          )}
          <div className="flex flex-wrap gap-2">
            {schedule?.auto ? (
              <>
                <Button variant="secondary" disabled={busy !== null} onClick={() => saveSchedule(true)}>
                  Save times
                </Button>
                <Button variant="plain" disabled={busy !== null} onClick={() => saveSchedule(false)}>
                  Turn off
                </Button>
              </>
            ) : (
              <Button disabled={busy !== null || !canShip} onClick={() => saveSchedule(true)}>
                Ship waves automatically
              </Button>
            )}
          </div>
        </Group>

        <Group className="space-y-3 p-4">
          <span className="block text-[17px] font-bold text-ink">Reprint a label</span>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run("reprint", async () => {
                const data = await post({ action: "reprint", orderSn: reprintSn });
                setReprintSn("");
                return `Reprinting ${data.orderSn}`;
              });
            }}
          >
            <input
              value={reprintSn}
              onChange={(e) => setReprintSn(e.target.value)}
              placeholder="Order number"
              autoCapitalize="characters"
              className="h-12 min-w-0 flex-1 rounded-[var(--radius-control)] bg-slate-100 px-4 text-[16px] text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
            />
            <Button type="submit" variant="secondary" disabled={busy !== null || reprintSn.trim().length < 3}>
              Reprint
            </Button>
          </form>
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
                  {{ PREVIEW: "Preview", RUNNING: "Shipping", DONE: "Done", CANCELLED: "Stopped" }[latest.status] ?? latest.status} ·{" "}
                  {manilaDateTime(latest.createdAt)}
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
              {latest.status !== "PREVIEW" && (
                <ul className="mt-4 space-y-1 border-t border-hairline pt-3 text-[15px] tabular-nums">
                  {PROGRESS.filter(([k]) => latest.progress[k]).map(([k, label]) => (
                    <li key={k} className={k === "FAILED" ? "font-semibold text-missing-ink" : "text-ink-2"}>
                      {latest.progress[k]} {label}
                    </li>
                  ))}
                </ul>
              )}
              {latest.failed.length > 0 && (
                <div className="mt-3 space-y-2">
                  <ul className="divide-y divide-hairline">
                    {latest.failed.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0 text-[14px]">
                          <span className="block font-semibold text-ink">{f.orderSn}</span>
                          <span className="block text-ink-3">{f.error}</span>
                        </span>
                        <Button
                          variant="secondary"
                          className="h-10 shrink-0 px-3"
                          disabled={busy !== null}
                          onClick={() =>
                            run("retry", async () => {
                              await post({ action: "retry_item", itemId: f.id });
                              return "Trying again";
                            })
                          }
                        >
                          Retry
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {latest.failed.length > 1 && (
                    <Button
                      full
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        run("retry", async () => {
                          const data = await post({ action: "retry_failed", waveId: latest.id });
                          return `Trying ${data.retried} again`;
                        })
                      }
                    >
                      Retry all
                    </Button>
                  )}
                </div>
              )}
              {latest.status === "PREVIEW" && s.total > 0 && (
                <div className="mt-4 space-y-2">
                  {canShip && Date.now() - new Date(latest.createdAt).getTime() < PREVIEW_MAX_AGE_MS ? (
                    <Button full size="lg" disabled={busy !== null} onClick={() => start(latest)}>
                      {busy === "start" ? "Starting…" : `Ship ${s.total} parcels`}
                    </Button>
                  ) : (
                    <p className="text-[14px] text-ink-3">
                      {canShip
                        ? "Preview again to ship (previews expire after 30 minutes)."
                        : "To ship from here, turn on \"Update … from Kyna Ops\" for a shop in Settings."}
                    </p>
                  )}
                  <Button full variant="secondary" disabled={busy !== null} onClick={() => printPickList(latest.id)}>
                    {busy === "print" ? "Sending…" : "Print pick list only"}
                  </Button>
                </div>
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
