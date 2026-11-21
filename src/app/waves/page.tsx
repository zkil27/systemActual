"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WaveParcelSheet, type WaveParcelSelection } from "@/components/WaveParcelSheet";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { toast } from "@/components/ui/Toast";
import { formatPeso, manilaDateTime } from "@/lib/ui/format";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";
import type { ReadyBreakdown } from "@/lib/waves/build";
import { groupPickItems } from "@/lib/waves/pick-list";
import { matchParcelsForVariant, type WaveParcel, type WaveSummary } from "@/lib/waves/plan";
import { formatWaveScheduleSetting } from "@/lib/waves/schedule";

interface WaveRow {
  id: string;
  status: string;
  trigger: string;
  parcelCount: number;
  createdAt: string;
  summary: WaveSummary;
  progress: Partial<Record<string, number>>;
  failed: Array<{ id: string; orderSn: string; error: string | null }>;
  parcels?: WaveParcel[];
}

interface Schedule {
  auto: boolean;
  continuous: boolean;
  times: string[];
  nextAt: string | null;
}

const PRESET_TIMES = ["08:30", "10:30", "12:30", "14:30", "15:30", "17:30"];

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
  const [ready, setReady] = useState<ReadyBreakdown | null>(null);
  const [platformFilter, setPlatformFilter] = useState<"ALL" | "SHOPEE" | "TIKTOK">("ALL");
  const [courierFilter, setCourierFilter] = useState<string>("ALL");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [continuousMode, setContinuousMode] = useState(false);
  const [customTime, setCustomTime] = useState("");
  const [timesInitialized, setTimesInitialized] = useState(false);
  const [reprintSn, setReprintSn] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showFullNames, setShowFullNames] = useState(false);
  const [pickView, setPickView] = useState<"items" | "parcels">("items");
  const [parcelSelection, setParcelSelection] = useState<WaveParcelSelection | null>(null);
  const [busy, setBusy] = useState<"preview" | "print" | "start" | "ship" | "retry" | "schedule" | "reprint" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/waves");
    if (!res.ok) return;
    const data = await res.json();
    setWaves(data.waves);
    setCanShip(Boolean(data.canShip));
    setReady(data.readyBreakdown ?? null);
    setSchedule(data.schedule);
    if (!timesInitialized && data.schedule) {
      setSelectedTimes(data.schedule.times ?? []);
      setContinuousMode(Boolean(data.schedule.continuous));
      setTimesInitialized(true);
    }
  }, [timesInitialized]);

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

  function toggleTime(t: string) {
    setSelectedTimes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t].sort()));
  }

  function addCustomTime() {
    const trimmed = customTime.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
      toast("Enter time as HH:MM (e.g. 09:30 or 16:45)", "error");
      return;
    }
    setSelectedTimes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed].sort()));
    setCustomTime("");
  }

  async function saveSchedule(auto: boolean, nextTimes = selectedTimes, nextContinuous = continuousMode) {
    if (
      auto &&
      !schedule?.auto &&
      !window.confirm(
        nextContinuous
          ? "Turn on Continuous Auto-Ship? Every 15 minutes, Kyna Ops will arrange pickup and print labels for any ready order older than 1 hour. The warehouse PC must be on."
          : "Ship waves automatically at these times? Each one arranges pickup on the shops and prints labels, with no tap. The warehouse PC must be on."
      )
    ) {
      return;
    }
    await run("schedule", async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          waveTimes: formatWaveScheduleSetting(nextTimes, nextContinuous),
          wavesAutoEnabled: auto,
        }),
      });
      if (!res.ok) throw new Error("Couldn't save");
      setTimesInitialized(false);
      return auto ? "Automatic shipping on" : "Saved";
    });
  }

  const activeFilters = {
    ...(platformFilter !== "ALL" ? { platform: platformFilter } : {}),
    ...(courierFilter !== "ALL" ? { courier: courierFilter } : {}),
  };

  const filterLabel = [
    platformFilter === "SHOPEE" ? "Shopee" : platformFilter === "TIKTOK" ? "TikTok" : null,
    courierFilter !== "ALL" ? courierFilter : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function shipNowClick() {
    const scope = filterLabel ? `${filterLabel} parcels` : "everything that's ready";
    if (!window.confirm(`Ship ${scope} now? This arranges pickup on the shops and prints labels. It can't be undone.`)) return;
    run("ship", async () => {
      const data = await post({ action: "ship_now", ...activeFilters });
      return data.shipping ? `Shipping ${data.shipping} parcels` : "Nothing ready to ship";
    });
  }

  useEffect(() => {
    load();
  }, [load]);

  const running = waves?.some((w) => w.status === "RUNNING");
  useLiveRefresh({ enabled: !running, onRefresh: load });
  const pollProgress = useCallback(async () => {
    const res = await fetch("/api/waves?mode=progress");
    if (!res.ok) return;
    const data = await res.json();
    const updates = new Map<
      string,
      { status: string; progress: Partial<Record<string, number>>; failed: WaveRow["failed"] }
    >(
      (data.waves ?? []).map((w: { id: string; status: string; progress: Partial<Record<string, number>>; failed: WaveRow["failed"] }) => [
        w.id,
        w,
      ])
    );
    let finishedRunning = false;
    setWaves((prev) => {
      if (!prev) return prev;
      return prev.map((w) => {
        const u = updates.get(w.id);
        if (!u) return w;
        if (w.status === "RUNNING" && u.status !== "RUNNING") finishedRunning = true;
        return { ...w, status: u.status, progress: u.progress, failed: u.failed };
      });
    });
    if (finishedRunning) {
      void load();
    }
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      if (!document.hidden) void pollProgress();
    };
    const onVisibility = () => {
      if (!document.hidden) void pollProgress();
    };
    const t = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running, pollProgress]);

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
      const data = await post({ action: "preview", ...activeFilters, ...(limit ? { limit } : {}) });
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

  const allTimes = [...new Set([...PRESET_TIMES, ...selectedTimes])].sort();

  return (
    <AppShell title="Waves" width="wide">
      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-6">
          <Group className="space-y-3.5 p-4">
            {ready && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[16px] font-bold text-ink tabular-nums">
                  {ready.totalReady} ready to ship
                </span>
                {ready.coolingOff > 0 && (
                  <span className="text-[13px] text-ink-3 tabular-nums">{ready.coolingOff} waiting 1h</span>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by shop">
              {(
                [
                  { id: "ALL", label: ready ? `All (${ready.totalReady})` : "All shops" },
                  { id: "SHOPEE", label: ready ? `Shopee (${ready.byPlatform.SHOPEE})` : "Shopee" },
                  { id: "TIKTOK", label: ready ? `TikTok (${ready.byPlatform.TIKTOK})` : "TikTok" },
                ] as const
              ).map((opt) => {
                const active = platformFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPlatformFilter(opt.id)}
                    className={`h-9 rounded-full px-3 text-[13px] font-semibold transition-colors ${
                      active ? "bg-ink text-white" : "bg-slate-100 text-ink-2 hover:bg-slate-200/70"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {ready && ready.byCourier.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by courier">
                <button
                  type="button"
                  aria-pressed={courierFilter === "ALL"}
                  onClick={() => setCourierFilter("ALL")}
                  className={`h-9 rounded-full px-3 text-[13px] font-semibold transition-colors ${
                    courierFilter === "ALL" ? "bg-brand text-white" : "bg-slate-100 text-ink-2 hover:bg-slate-200/70"
                  }`}
                >
                  All couriers
                </button>
                {ready.byCourier.map((c) => {
                  const active = courierFilter === c.courier;
                  return (
                    <button
                      key={c.courier}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCourierFilter(c.courier)}
                      className={`h-9 rounded-full px-3 text-[13px] font-semibold tabular-nums transition-colors ${
                        active ? "bg-brand text-white" : "bg-slate-100 text-ink-2 hover:bg-slate-200/70"
                      }`}
                    >
                      {c.courier} ({c.count})
                    </button>
                  );
                })}
              </div>
            )}

            <p className="text-[14px] text-ink-3">
              Every order is checked live for cancellations before shipping. Preview first or print straight away.
            </p>
            <Button full size="lg" disabled={busy !== null} onClick={() => preview()}>
              {busy === "preview"
                ? "Checking orders…"
                : filterLabel
                  ? `Preview ${filterLabel}`
                  : "Preview wave"}
            </Button>
            <Button full variant="plain" disabled={busy !== null} onClick={() => preview(5)}>
              Preview a test wave (5 parcels)
            </Button>
            {canShip && (
              <Button full variant="secondary" disabled={busy !== null || Boolean(running)} onClick={shipNowClick}>
                {busy === "ship"
                  ? "Starting…"
                  : running
                    ? "A wave is shipping"
                    : filterLabel
                      ? `Ship & print ${filterLabel} now`
                      : "Print wave now"}
              </Button>
            )}
          </Group>

          <Group className="space-y-3.5 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[17px] font-bold text-ink">Auto-ship schedule</span>
              <span className={`text-[15px] font-semibold ${schedule?.auto ? "text-arrived" : "text-ink-3"}`}>
                {schedule?.auto ? (schedule.continuous ? "Continuous" : "Scheduled") : "Off"}
              </span>
            </div>
            {schedule?.auto && schedule.nextAt && (
              <p className="text-[14px] text-ink-3">Next check {manilaDateTime(schedule.nextAt)}</p>
            )}

            <button
              type="button"
              aria-pressed={continuousMode}
              onClick={() => setContinuousMode((c) => !c)}
              className={`flex min-h-11 w-full items-center justify-between rounded-[var(--radius-control)] px-3.5 py-2 text-left text-[14px] font-semibold transition-colors ${
                continuousMode
                  ? "bg-brand-soft text-brand shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
                  : "bg-slate-100 text-ink-2"
              }`}
            >
              <span>Continuous auto-ship (every 15 mins)</span>
              <span>{continuousMode ? "Selected" : "Off"}</span>
            </button>

            {!continuousMode && (
              <div className="space-y-2.5">
                <p className="text-[13px] text-ink-3">Tap wave times (Manila time):</p>
                <div className="flex flex-wrap gap-1.5">
                  {allTimes.map((t) => {
                    const active = selectedTimes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleTime(t)}
                        className={`h-9 rounded-full px-3 text-[13px] font-semibold tabular-nums transition-colors ${
                          active ? "bg-ink text-white" : "bg-slate-100 text-ink-2"
                        }`}
                      >
                        {clock(t)}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    placeholder="Add HH:MM (e.g. 19:00)"
                    className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] bg-slate-100 px-3 text-[14px] tabular-nums text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
                  />
                  <Button variant="plain" type="button" onClick={addCustomTime} className="h-10 px-3">
                    Add
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {schedule?.auto ? (
                <>
                  <Button variant="secondary" disabled={busy !== null} onClick={() => saveSchedule(true)}>
                    Save schedule
                  </Button>
                  <Button variant="plain" disabled={busy !== null} onClick={() => saveSchedule(false)}>
                    Turn off
                  </Button>
                </>
              ) : (
                <Button disabled={busy !== null || !canShip} onClick={() => saveSchedule(true)}>
                  Turn on auto-ship
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
        </div>

        <div>
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

              {s.groups.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
                  <h2 className="text-[17px] font-bold text-ink">Pick list</h2>
                  <div className="flex items-center gap-2">
                    <div
                      role="group"
                      aria-label="Pick list view"
                      className="inline-flex h-9 items-center rounded-full bg-slate-200/70 p-0.5"
                    >
                      {(
                        [
                          { id: "items", label: "By item" },
                          { id: "parcels", label: "Parcels" },
                        ] as const
                      ).map((opt) => {
                        const active = pickView === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setPickView(opt.id)}
                            className={`h-8 rounded-full px-3 text-[13px] font-semibold transition-colors ${
                              active
                                ? "bg-white text-ink shadow-xs"
                                : "text-ink-2 hover:text-ink"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      aria-pressed={showFullNames}
                      onClick={() => setShowFullNames((v) => !v)}
                      className={`h-9 rounded-full px-3 text-[13px] font-semibold transition-colors ${
                        showFullNames
                          ? "bg-ink text-white"
                          : "bg-slate-200/70 text-ink-2 hover:bg-slate-200"
                      }`}
                    >
                      {showFullNames ? "Short names" : "Full names"}
                    </button>
                  </div>
                </div>
              )}

              {s.groups.map((g) => {
                const garmentGroups = groupPickItems(g.items);
                const groupParcels = (latest.parcels ?? []).filter((p) => p.groupKey === g.key);
                const groupPieces = g.items.reduce((sum, it) => sum + it.qty, 0);
                const collapsed = Boolean(collapsedGroups[g.key]);
                return (
                  <Group key={g.key} className="overflow-hidden">
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setCollapsedGroups((prev) => ({ ...prev, [g.key]: !prev[g.key] }))
                      }
                      className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                    >
                      <span className="text-[16px] font-bold text-ink">{g.title}</span>
                      <span className="flex shrink-0 items-center gap-2 text-[14px] text-ink-3 tabular-nums">
                        <span>
                          {g.count} parcels · {groupPieces} pcs
                        </span>
                        {collapsed ? (
                          <ChevronRight className="h-4 w-4 text-ink-3" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-ink-3" />
                        )}
                      </span>
                    </button>
                    {!collapsed && pickView === "items" && (
                      <ul className="divide-y divide-hairline border-t border-hairline px-4">
                        {garmentGroups.map((pg) => {
                          const multi = pg.variants.length > 1;
                          return (
                            <li key={pg.key} className="py-3">
                              <div className="flex items-baseline justify-between gap-2">
                                <span
                                  title={pg.fullName}
                                  className={`min-w-0 text-[15px] font-bold text-ink ${
                                    showFullNames ? "break-words" : "truncate"
                                  }`}
                                >
                                  {showFullNames ? pg.fullName : pg.shortName}
                                </span>
                                {(multi || pg.totalQty > 1) && (
                                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-bold text-ink-2 tabular-nums">
                                    {pg.totalQty} pcs
                                  </span>
                                )}
                              </div>
                              <div
                                className={`mt-2 ${
                                  multi
                                    ? "grid grid-cols-1 gap-1.5 sm:grid-cols-2"
                                    : "space-y-1.5"
                                }`}
                              >
                                {pg.variants.map((v, idx) => {
                                  const matchingParcels = matchParcelsForVariant(
                                    latest.parcels ?? [],
                                    g.key,
                                    v.label
                                  );
                                  const garmentTitle = showFullNames ? pg.fullName : pg.shortName;
                                  return (
                                    <button
                                      key={`${v.label}-${idx}`}
                                      type="button"
                                      onClick={() =>
                                        setParcelSelection({
                                          title: garmentTitle,
                                          subtitle: `${v.qty} ${v.qty === 1 ? "pc" : "pcs"} · ${matchingParcels.length} ${
                                            matchingParcels.length === 1 ? "parcel" : "parcels"
                                          }`,
                                          variantLabel: v.label,
                                          parcels: matchingParcels,
                                        })
                                      }
                                      className="pressable flex w-full items-center gap-2 rounded-[var(--radius-control)] bg-surface-subtle px-2.5 py-1.5 text-left ring-1 ring-hairline/80 transition-colors hover:bg-slate-100/80 hover:ring-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                    >
                                      <span
                                        className={`inline-flex min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[14px] font-extrabold tabular-nums ${
                                          v.qty > 1
                                            ? "bg-ink text-white"
                                            : "bg-white text-ink ring-1 ring-hairline"
                                        }`}
                                      >
                                        {v.qty}×
                                      </span>
                                      <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink">
                                        {v.color ?? (showFullNames ? v.label : "Standard")}
                                      </span>
                                      {v.size && (
                                        <span className="shrink-0 whitespace-nowrap rounded-md bg-white px-2 py-0.5 text-[13px] font-semibold text-ink-2 ring-1 ring-hairline tabular-nums">
                                          {v.size}
                                        </span>
                                      )}
                                      {matchingParcels.length > 1 && (
                                        <span className="shrink-0 text-[12px] font-semibold text-ink-3 tabular-nums">
                                          {matchingParcels.length}p
                                        </span>
                                      )}
                                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-3/70" />
                                    </button>
                                  );
                                })}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {!collapsed && pickView === "parcels" && (
                      groupParcels.length === 0 ? (
                        <p className="border-t border-hairline px-4 py-4 text-[14px] text-ink-3">
                          Parcel details are not available for this wave.
                        </p>
                      ) : (
                        <ul className="divide-y divide-hairline border-t border-hairline">
                          {groupParcels.map((parcel) => {
                            const leadLine = parcel.lines[0];
                            const isMulti = parcel.totalPieces > 1 || parcel.lines.length > 1;
                            const itemsText = parcel.lines
                              .map((l) => {
                                const name = showFullNames ? l.name : l.shortName;
                                const variant = l.variationName ? ` — ${l.variationName}` : "";
                                return `${l.quantity}× ${name}${variant}`;
                              })
                              .join(" + ");
                            return (
                              <li key={parcel.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setParcelSelection({
                                      title: `Parcel #${parcel.position}`,
                                      parcels: [parcel],
                                      initialParcelId: parcel.id,
                                    })
                                  }
                                  className="pressable flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                                >
                                  <ItemThumb
                                    src={leadLine?.imageUrl ?? null}
                                    alt={leadLine?.shortName ?? parcel.orderSn}
                                    size="md"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <span className="inline-flex items-center rounded-md bg-ink px-1.5 py-0.5 text-[12px] font-bold text-white tabular-nums">
                                          #{parcel.position}
                                        </span>
                                        <span className="truncate text-[15px] font-bold text-ink tabular-nums">
                                          {parcel.orderSn}
                                        </span>
                                        {isMulti && (
                                          <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-bold text-brand tabular-nums">
                                            Multi · {parcel.totalPieces} pcs
                                          </span>
                                        )}
                                      </div>
                                      <span className="shrink-0 text-[13px] font-semibold text-ink-2 tabular-nums">
                                        {parcel.isCod ? "COD" : "Prepaid"} · {formatPeso(parcel.totalPhp)}
                                      </span>
                                    </div>
                                    <p className="mt-1 truncate text-[14px] text-ink-2" title={itemsText}>
                                      {itemsText}
                                    </p>
                                  </div>
                                  <ChevronRight className="h-5 w-5 shrink-0 text-hairline-strong" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )
                    )}
                  </Group>
                );
              })}
            </section>
          )}
        </div>
      </div>
      <WaveParcelSheet
        selection={parcelSelection}
        showFullNames={showFullNames}
        onClose={() => setParcelSelection(null)}
      />
    </AppShell>
  );
}
