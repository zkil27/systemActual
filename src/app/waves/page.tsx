"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WaveParcelSheet, type WaveParcelSelection } from "@/components/WaveParcelSheet";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { ScrollChips } from "@/components/ui/ScrollChips";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { formatPeso, manilaDateTime, manilaTime } from "@/lib/ui/format";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";
import type { CourierHandoverSummary } from "@/lib/print/handover";
import type { ReadyBreakdown } from "@/lib/waves/build";
import { groupPickItems } from "@/lib/waves/pick-list";
import { addHeld, HELD_LABELS } from "@/lib/waves/ready";
import { matchParcelsForVariant, type WaveParcel, type WavePieceMode, type WaveSummary } from "@/lib/waves/plan";
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

/**
 * Header for the ready box. On the TikTok filter the headline is TikTok's own
 * live "to ship" count (matches Seller Center); the line under it shows how
 * that splits into ready / waiting / held, so any difference is explained.
 */
function readyHeader(ready: ReadyBreakdown, filter: "ALL" | "SHOPEE" | "TIKTOK") {
  const scope = filter === "ALL" ? null : filter;
  const readyNow = scope ? ready.byPlatform[scope] : ready.totalReady;
  const waiting = scope ? ready.coolingOffByPlatform[scope] : ready.coolingOff;
  const held = scope ? ready.held[scope] : addHeld(ready.held.SHOPEE, ready.held.TIKTOK);
  const heldParts = HELD_LABELS.filter(([k]) => held[k] > 0).map(([k, label]) => `${held[k]} ${label}`);
  const liveTikTok = ready.live?.TIKTOK ?? null;
  const gap = ready.unexplained?.TIKTOK ?? null;

  if (filter === "TIKTOK" && liveTikTok !== null) {
    return {
      count: liveTikTok,
      label: "to ship on TikTok",
      waiting,
      details: [
        `${readyNow} ready now`,
        ...heldParts,
        ...(gap && gap > 0 ? [`${gap} still syncing`] : []),
        ...(gap && gap < 0 ? [`${-gap} being re-checked`] : []),
      ],
    };
  }
  return {
    count: readyNow,
    label: "ready to ship",
    waiting,
    details: [...heldParts, ...(filter === "ALL" && liveTikTok !== null ? [`Seller Center shows ${liveTikTok} on TikTok`] : [])],
  };
}

/** Small label over a filter group. A form label, not a heading. */
function FilterLabel({ children }: { children: React.ReactNode }) {
  return <legend className="mb-1.5 text-[13px] font-semibold text-ink-3">{children}</legend>;
}

/** Preview what a wave would ship and print its pick list. Nothing is shipped from here yet. */
export default function WavesPage() {
  const { confirm, sheet: confirmSheet } = useConfirm();
  const [waves, setWaves] = useState<WaveRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);
  const selectedWaveIdRef = useRef<string | null>(null);
  selectedWaveIdRef.current = selectedWaveId;
  const [handover, setHandover] = useState<CourierHandoverSummary[]>([]);
  const [canShip, setCanShip] = useState(false);
  const [ready, setReady] = useState<ReadyBreakdown | null>(null);
  const [platformFilter, setPlatformFilter] = useState<"ALL" | "SHOPEE" | "TIKTOK">("ALL");
  const [courierFilter, setCourierFilter] = useState<string>("ALL");
  const [pieceMode, setPieceMode] = useState<WavePieceMode>("all");
  const [includeNewOrders, setIncludeNewOrders] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [continuousMode, setContinuousMode] = useState(false);
  const [customTime, setCustomTime] = useState("");
  const [timesInitialized, setTimesInitialized] = useState(false);
  const [reprintSn, setReprintSn] = useState("");
  const [rangeFrom, setRangeFrom] = useState("1");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeGroup, setRangeGroup] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showFullNames, setShowFullNames] = useState(false);
  const [pickView, setPickView] = useState<"items" | "parcels">("items");
  const [parcelSelection, setParcelSelection] = useState<WaveParcelSelection | null>(null);
  const [busy, setBusy] = useState<"preview" | "print" | "start" | "ship" | "retry" | "cancel" | "schedule" | "reprint" | "handover" | null>(null);

  const load = useCallback(async (waveIdOverride?: string | null) => {
    const targetWaveId = waveIdOverride !== undefined ? waveIdOverride : selectedWaveIdRef.current;
    const qs = targetWaveId ? `?waveId=${encodeURIComponent(targetWaveId)}` : "";
    let res: Response;
    let handoverRes: Response | null = null;
    try {
      [res, handoverRes] = await Promise.all([
        fetch(`/api/waves${qs}`, { cache: "no-store" }),
        fetch("/api/handover", { cache: "no-store" }).catch(() => null as unknown as Response),
      ]);
    } catch {
      setLoadError(true);
      return;
    }
    setLoadError(!res.ok);
    if (res.ok) {
      const data = await res.json();
      setWaves(data.waves);
      if (data.selectedWaveId && (waveIdOverride === undefined || waveIdOverride === data.selectedWaveId)) {
        selectedWaveIdRef.current = data.selectedWaveId;
        setSelectedWaveId(data.selectedWaveId);
      }
      setCanShip(Boolean(data.canShip));
      setReady(data.readyBreakdown ?? null);
      setSchedule(data.schedule);
      if (!timesInitialized && data.schedule) {
        setSelectedTimes(data.schedule.times ?? []);
        setContinuousMode(Boolean(data.schedule.continuous));
        setTimesInitialized(true);
      }
    }
    if (handoverRes?.ok) {
      const hData = await handoverRes.json();
      setHandover(hData.couriers ?? []);
    }
  }, [timesInitialized]);

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<string | void>, nextWaveId?: string | null) {
    setBusy(kind);
    try {
      const msg = await fn();
      if (msg) toast(msg);
      await load(nextWaveId);
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
      !(await confirm({
        title: nextContinuous ? "Turn on Continuous Auto-Ship?" : "Ship waves automatically?",
        message: nextContinuous
          ? "Every 15 minutes, Kyna Ops will arrange pickup and print labels for any ready order older than 1 hour. The warehouse PC must be on."
          : "Each wave time arranges pickup on the shops and prints labels, with no tap. The warehouse PC must be on.",
        confirmLabel: "Turn on",
      }))
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
    ...(pieceMode !== "all" ? { pieceMode } : {}),
    ...(includeNewOrders ? { includeNewOrders: true } : {}),
  };

  const filterLabel = [
    platformFilter === "SHOPEE" ? "Shopee" : platformFilter === "TIKTOK" ? "TikTok" : null,
    courierFilter !== "ALL" ? courierFilter : null,
    pieceMode === "singles" ? "1-piece" : pieceMode === "multis" ? "Multi-item" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function shipNowClick() {
    const scope = filterLabel ? `${filterLabel} parcels` : "everything that's ready";
    const ok = await confirm({
      title: `Ship ${scope} now?`,
      message: "This arranges pickup on the shops and prints labels. It can't be undone.",
      confirmLabel: "Ship now",
    });
    if (!ok) return;
    run("ship", async () => {
      const data = await post({ action: "ship_now", ...activeFilters });
      return data.shipping ? `Shipping ${data.shipping} parcels` : "Nothing ready to ship";
    }, null);
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
      !(await confirm({
        title: `Ship ${wave.parcelCount} parcels now?`,
        message:
          "Kyna Ops will arrange pickup on the shops and print the labels. This can't be undone. Each order is checked for cancellation again just before it ships.",
        confirmLabel: "Ship",
      }))
    ) {
      return;
    }
    setBusy("start");
    try {
      const data = await post({ action: "start", waveId: wave.id });
      toast(`Shipping ${data.shipping} parcels`);
      await load(wave.id);
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
      if (data.waveId) setSelectedWaveId(data.waveId);
      await load(data.waveId ?? null);
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

  const latest = (selectedWaveId ? waves?.find((w) => w.id === selectedWaveId) : undefined) ?? waves?.[0];
  const s = latest?.summary;
  const skips = s ? SKIP_LABELS.filter(([k]) => s.skipped[k] > 0) : [];
  const hasPrintedOrQueued =
    Boolean(latest) &&
    ((latest?.progress?.PRINTED ?? 0) > 0 || (latest?.progress?.LABEL_READY ?? 0) > 0);

  const allTimes = [...new Set([...PRESET_TIMES, ...selectedTimes])].sort();
  const header = ready ? readyHeader(ready, platformFilter) : null;

  return (
    <AppShell title="Waves" width="wide" onRefresh={load}>
      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-6">
          <Group className="p-4">
            {ready && header && (
              <div>
                <p className="flex items-baseline gap-2">
                  <AnimatedNumber
                    value={header.count}
                    className="text-[34px] font-extrabold leading-none tracking-[-0.02em] text-ink"
                  />
                  <span className="text-[17px] font-semibold text-ink">{header.label}</span>
                </p>
                {header.details.length > 0 && (
                  <p className="mt-1.5 text-[14px] leading-snug text-ink-3 tabular-nums">{header.details.join(" · ")}</p>
                )}
              </div>
            )}

            <div className="mt-5 space-y-4">
              <fieldset>
                <FilterLabel>Shop</FilterLabel>
                <SegmentedControl
                  label="Shop"
                  size="sm"
                  options={[
                    { id: "ALL", label: ready ? `All ${ready.totalReady}` : "All" },
                    { id: "SHOPEE", label: ready ? `Shopee ${ready.byPlatform.SHOPEE}` : "Shopee" },
                    { id: "TIKTOK", label: ready ? `TikTok ${ready.byPlatform.TIKTOK}` : "TikTok" },
                  ]}
                  value={platformFilter}
                  onChange={setPlatformFilter}
                />
              </fieldset>

              {ready && ready.byCourier.length > 0 && (
                <fieldset>
                  <FilterLabel>Courier</FilterLabel>
                  <ScrollChips label="Courier" className="-mx-4" rowClassName="gap-1.5 px-4 py-1">
                    {[{ courier: "ALL", count: null as number | null }, ...ready.byCourier].map((c) => {
                      const active = courierFilter === c.courier;
                      return (
                        <button
                          key={c.courier}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setCourierFilter(c.courier)}
                          className={`pressable relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] ${
                            active
                              ? "bg-ink text-ink-inverse"
                              : "bg-surface text-ink-2 ring-1 ring-inset ring-hairline-strong hover:text-ink"
                          }`}
                        >
                          {c.courier === "ALL" ? "All couriers" : c.courier}
                          {c.count !== null && (
                            <span className={`tabular-nums ${active ? "text-ink-inverse/70" : "text-ink-3"}`}>{c.count}</span>
                          )}
                        </button>
                      );
                    })}
                  </ScrollChips>
                </fieldset>
              )}

              <fieldset>
                <FilterLabel>Pieces per parcel</FilterLabel>
                <SegmentedControl
                  label="Pieces per parcel"
                  size="sm"
                  options={[
                    { id: "all", label: "Any" },
                    { id: "singles", label: "1 piece" },
                    { id: "multis", label: "2 or more" },
                  ]}
                  value={pieceMode}
                  onChange={setPieceMode}
                />
              </fieldset>

              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 border-t border-hairline pt-3.5">
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink">Include orders under 1h old</span>
                  <span className="block text-[13px] text-ink-3 tabular-nums">
                    {header && header.waiting > 0
                      ? `${header.waiting} still inside the buyer's cancel window`
                      : "None waiting right now"}
                  </span>
                </span>
                <Switch
                  checked={includeNewOrders}
                  onChange={setIncludeNewOrders}
                  label="Include orders under 1h old"
                />
              </label>
            </div>

            <div className="mt-5 space-y-1.5">
              <Button full size="lg" disabled={busy !== null} onClick={() => preview()}>
                {busy === "preview"
                  ? "Checking orders…"
                  : filterLabel
                    ? `Preview ${filterLabel}`
                    : "Preview wave"}
              </Button>
              <Button full variant="plain" disabled={busy !== null} onClick={() => preview(5)}>
                Try a test wave of 5
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
              <p className="pt-1 text-center text-[13px] text-ink-3">
                Each order is re-checked for cancellation right before it ships.
              </p>
            </div>
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
              className={`pressable flex min-h-11 w-full items-center justify-between rounded-[var(--radius-control)] px-3.5 py-2 text-left text-[14px] font-semibold ${
                continuousMode
                  ? "bg-brand-soft text-brand shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
                  : "bg-surface-muted text-ink-2"
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
                        className={`pressable h-9 rounded-full px-3 text-[13px] font-semibold tabular-nums ${
                          active ? "bg-ink text-ink-inverse" : "bg-surface-muted text-ink-2 hover:bg-surface-track"
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
                    className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] bg-surface-muted px-3 text-[16px] tabular-nums text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
                  />
                  <Button variant="plain" type="button" onClick={addCustomTime} className="h-11 px-3">
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
                className="h-12 min-w-0 flex-1 rounded-[var(--radius-control)] bg-surface-muted px-4 text-[16px] text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
              />
              <Button type="submit" variant="secondary" disabled={busy !== null || reprintSn.trim().length < 3}>
                Reprint
              </Button>
            </form>

            {hasPrintedOrQueued && latest && s && (
              <form
                className="space-y-2.5 border-t border-hairline pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fromPos = Number(rangeFrom || 1);
                  const toPos = Number(rangeTo || latest.parcelCount);
                  if (!Number.isInteger(fromPos) || !Number.isInteger(toPos) || fromPos < 1 || toPos < fromPos) {
                    toast("Enter a valid parcel range (e.g. 47 to 200)", "error");
                    return;
                  }
                  run("reprint", async () => {
                    const data = await post({
                      action: "reprint_range",
                      waveId: latest.id,
                      fromPos,
                      toPos,
                      ...(rangeGroup ? { groupKey: rangeGroup } : {}),
                    });
                    return `Reprinting ${data.queuedParcels} parcels`;
                  });
                }}
              >
                <p className="text-[13px] font-semibold text-ink-2">
                  Printer jammed? Reprint a position range (#1–#{latest.parcelCount})
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={latest.parcelCount}
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    placeholder="From #"
                    aria-label="From parcel number"
                    className="h-11 w-24 rounded-[var(--radius-control)] bg-surface-muted px-3 text-[16px] tabular-nums text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
                  />
                  <span className="text-[14px] text-ink-3">to</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={latest.parcelCount}
                    value={rangeTo || String(latest.parcelCount)}
                    onChange={(e) => setRangeTo(e.target.value)}
                    placeholder={String(latest.parcelCount)}
                    aria-label="To parcel number"
                    className="h-11 w-24 rounded-[var(--radius-control)] bg-surface-muted px-3 text-[16px] tabular-nums text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
                  />
                  <Button type="submit" variant="secondary" disabled={busy !== null} className="h-11 flex-1">
                    Reprint range
                  </Button>
                </div>
                {s.groups.length > 1 && (
                  <select
                    value={rangeGroup}
                    onChange={(e) => setRangeGroup(e.target.value)}
                    aria-label="Filter range by courier stack"
                    className="h-11 w-full rounded-[var(--radius-control)] bg-surface-muted px-3 text-[16px] text-ink"
                  >
                    <option value="">All courier stacks</option>
                    {s.groups.map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.title} ({g.count})
                      </option>
                    ))}
                  </select>
                )}
              </form>
            )}
          </Group>

          {handover.length > 0 && (
            <Group className="space-y-3 p-4">
              <span className="block text-[17px] font-bold text-ink">Courier handover today</span>
              <ul className="divide-y divide-hairline">
                {handover.map((h) => (
                  <li key={h.courier} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold text-ink">{h.courier}</span>
                      <span className="block text-[13px] text-ink-3 tabular-nums">
                        {h.totalPrinted} printed · {h.handedOverCount} picked up · {h.awaitingPickupCount} waiting
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        className="h-11 px-3 text-[14px]"
                        onClick={() =>
                          run("handover", async () => {
                            const res = await fetch("/api/handover", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ courier: h.courier, mode: "print" }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data.error || "Couldn't print slip");
                            return `${h.courier} handover slip queued`;
                          })
                        }
                      >
                        Print slip
                      </Button>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await fetch("/api/handover", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ courier: h.courier, mode: "pdf" }),
                          });
                          if (!res.ok) return toast("Couldn't open slip", "error");
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                        className="pressable inline-flex h-11 items-center rounded-[var(--radius-control)] bg-surface-muted px-3 text-[13px] font-semibold text-ink hover:bg-surface-track"
                      >
                        PDF
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Group>
          )}
        </div>

        <div className="space-y-4">
          {waves && waves.length > 1 && (
            <ScrollChips role="tablist" label="Recent waves" rowClassName="gap-1.5 py-0.5">
              {waves.map((w) => {
                const active = w.id === latest?.id;
                const failCount = w.failed.length;
                const statusWord =
                  w.status === "RUNNING"
                    ? "Shipping"
                    : w.status === "PREVIEW"
                      ? "Preview"
                      : w.status === "CANCELLED"
                        ? "Stopped"
                        : failCount > 0
                          ? `Done (${failCount} failed)`
                          : "Done";
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      selectedWaveIdRef.current = w.id;
                      setSelectedWaveId(w.id);
                      void load(w.id);
                    }}
                    className={`pressable h-11 shrink-0 rounded-full px-3.5 text-[13px] font-semibold tabular-nums transition-colors ${
                      active
                        ? "bg-ink text-ink-inverse"
                        : w.status === "RUNNING"
                          ? "bg-brand-soft text-brand ring-1 ring-brand/35"
                          : "bg-surface text-ink-2 shadow-[var(--shadow-card)] hover:text-ink"
                    }`}
                  >
                    {statusWord} · {w.parcelCount} · {manilaTime(w.createdAt)}
                  </button>
                );
              })}
            </ScrollChips>
          )}
          {waves === null && loadError ? (
            <div className="space-y-3 py-10 text-center">
              <p className="text-[16px] text-ink-2">Couldn&apos;t load waves.</p>
              <button
                type="button"
                onClick={() => void load()}
                className="pressable inline-flex h-12 items-center rounded-[var(--radius-control)] bg-surface-muted px-5 text-[16px] font-bold text-ink hover:bg-surface-track"
              >
                Try again
              </button>
            </div>
          ) : waves === null ? (
            <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface-track/60" aria-busy="true" />
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
                <AnimatedNumber
                  value={s.total}
                  className="mt-3 block text-[40px] font-extrabold leading-none tracking-[-0.03em] text-ink"
                />
                <span className="mt-2 block text-[15px] text-ink-2 tabular-nums">
                  parcels · {s.singles} single piece · {s.multis} multi
                </span>
                {skips.length > 0 && (
                  <ul className="mt-4 space-y-1 border-t border-hairline pt-3 text-[14px] text-ink-3 tabular-nums">
                    {skips.map(([k, label]) => (
                      <li key={k} className={k === "notRechecked" ? "font-semibold text-failed-ink" : undefined}>
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
                            className="h-11 shrink-0 px-3"
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
                {latest.status === "RUNNING" && (
                  <div className="mt-4 space-y-2">
                    <Button full variant="secondary" disabled={busy !== null} onClick={() => printPickList(latest.id)}>
                      {busy === "print" ? "Sending…" : "Reprint pick list"}
                    </Button>
                    <Button
                      full
                      variant="danger"
                      disabled={busy !== null}
                      onClick={async () => {
                        if (
                          !(await confirm({
                            title: "Stop this wave?",
                            message:
                              "Parcels not yet shipped can go in the next wave; already-shipped parcels can still be retried.",
                            confirmLabel: "Stop wave",
                            danger: true,
                          }))
                        ) {
                          return;
                        }
                        void run("cancel", async () => {
                          await post({ action: "cancel_wave", waveId: latest.id });
                          return "Wave stopped";
                        });
                      }}
                    >
                      {busy === "cancel" ? "Stopping…" : "Stop wave"}
                    </Button>
                  </div>
                )}
                {(latest.status === "DONE" || latest.status === "CANCELLED") && (
                  <div className="mt-4">
                    <Button full variant="secondary" disabled={busy !== null} onClick={() => printPickList(latest.id)}>
                      {busy === "print" ? "Sending…" : "Reprint pick list"}
                    </Button>
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
                    <Button
                      full
                      variant="plain"
                      disabled={busy !== null}
                      onClick={() =>
                        run("cancel", async () => {
                          await post({ action: "cancel_wave", waveId: latest.id });
                          return "Preview discarded";
                        })
                      }
                    >
                      Discard preview
                    </Button>
                  </div>
                )}
              </Group>

              {s.groups.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
                  <h2 className="text-[17px] font-bold text-ink">Pick list</h2>
                  <div className="flex items-center gap-2">
                    <SegmentedControl
                      label="Pick list view"
                      size="sm"
                      shape="pill"
                      options={[
                        { id: "items", label: "By item" },
                        { id: "parcels", label: "Parcels" },
                      ] as const}
                      value={pickView}
                      onChange={setPickView}
                      className="min-w-[164px]"
                    />
                    <button
                      type="button"
                      aria-pressed={showFullNames}
                      onClick={() => setShowFullNames((v) => !v)}
                      className={`pressable h-9 rounded-full px-3 text-[13px] font-semibold ${
                        showFullNames
                          ? "bg-ink text-ink-inverse"
                          : "bg-surface-track/80 text-ink-2 hover:bg-surface-track"
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
                      className="pressable-row flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
                    >
                      <span className="text-[16px] font-bold text-ink">{g.title}</span>
                      <span className="flex shrink-0 items-center gap-2 text-[14px] text-ink-3 tabular-nums">
                        <span>
                          {g.count} parcels · {groupPieces} pcs
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-ink-3 transition-transform duration-200 ease-[var(--ease-ios)] ${
                            collapsed ? "-rotate-90" : "rotate-0"
                          }`}
                        />
                      </span>
                    </button>
                    {!collapsed && pickView === "items" && (
                      <ul className="anim-disclosure-in divide-y divide-hairline border-t border-hairline px-4">
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
                                  <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[12px] font-bold text-ink-2 tabular-nums">
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
                                      className="group pressable flex w-full items-center gap-2 rounded-[var(--radius-control)] bg-surface-subtle px-2.5 py-1.5 text-left ring-1 ring-hairline/80 transition-colors hover:bg-surface-muted hover:ring-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                    >
                                      <span
                                        className={`inline-flex min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[14px] font-extrabold tabular-nums ${
                                          v.qty > 1
                                            ? "bg-ink text-ink-inverse"
                                            : "bg-surface text-ink ring-1 ring-hairline"
                                        }`}
                                      >
                                        {v.qty}×
                                      </span>
                                      <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink">
                                        {v.color ?? (showFullNames ? v.label : "Standard")}
                                      </span>
                                      {v.size && (
                                        <span className="shrink-0 whitespace-nowrap rounded-md bg-surface px-2 py-0.5 text-[13px] font-semibold text-ink-2 ring-1 ring-hairline tabular-nums">
                                          {v.size}
                                        </span>
                                      )}
                                      {matchingParcels.length > 1 && (
                                        <span className="shrink-0 text-[12px] font-semibold text-ink-3 tabular-nums">
                                          {matchingParcels.length}p
                                        </span>
                                      )}
                                      <ChevronRight className="chevron-nudge h-4 w-4 shrink-0 text-ink-3/70" />
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
                        <p className="anim-disclosure-in border-t border-hairline px-4 py-4 text-[14px] text-ink-3">
                          Parcel details are not available for this wave.
                        </p>
                      ) : (
                        <ul className="anim-disclosure-in divide-y divide-hairline border-t border-hairline">
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
                                  className="group pressable flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-subtle active:bg-surface-muted"
                                >
                                  <ItemThumb
                                    src={leadLine?.imageUrl ?? null}
                                    alt={leadLine?.shortName ?? parcel.orderSn}
                                    size="md"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <span className="inline-flex items-center rounded-md bg-ink px-1.5 py-0.5 text-[12px] font-bold text-ink-inverse tabular-nums">
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
                                  <ChevronRight className="chevron-nudge h-5 w-5 shrink-0 text-hairline-strong" />
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
        canExclude={latest?.status === "PREVIEW"}
        actionBusy={busy !== null}
        onReprintParcel={(orderSn) =>
          run("reprint", async () => {
            const data = await post({ action: "reprint", orderSn });
            return `Reprinting ${data.orderSn}`;
          })
        }
        onExcludeParcel={async (waveItemId) => {
          if (!latest) return;
          await run("cancel", async () => {
            await post({ action: "exclude_parcel", waveId: latest.id, waveItemId });
            setParcelSelection(null);
            return "Parcel left out of wave";
          });
        }}
        onClose={() => setParcelSelection(null)}
      />
      {confirmSheet}
    </AppShell>
  );
}
