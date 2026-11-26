"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Printer, Truck, Wrench, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WaveParcelSheet, type WaveParcelSelection } from "@/components/WaveParcelSheet";
import { AutoShipSheet, type WaveSchedule } from "@/components/waves/AutoShipSheet";
import { HandoverSheet } from "@/components/waves/HandoverSheet";
import { ReprintSheet } from "@/components/waves/ReprintSheet";
import { FilterPickerSheet, WaveToolsMenu, type ToolSheet } from "@/components/waves/WaveSheets";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { ScrollChips } from "@/components/ui/ScrollChips";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { formatPeso, manilaDateTime, manilaTime } from "@/lib/ui/format";
import { prefersReducedMotion } from "@/lib/ui/motion";
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

type FilterSheet = "shop" | "courier" | "pieces";

const PIECE_LABELS: Record<WavePieceMode, string> = { all: "Any pieces", singles: "1 piece", multis: "2+ pieces" };

/** One filter chip: shows the current choice, filled when it isn't the default. */
function FilterChip({
  active,
  onClick,
  children,
  caret = true,
  pressed,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  caret?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-haspopup={caret ? "dialog" : undefined}
      onClick={onClick}
      className={`pressable relative inline-flex h-9 shrink-0 items-center gap-1 rounded-full pl-3.5 text-[14px] font-semibold tabular-nums after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] ${
        caret ? "pr-2.5" : "pr-3.5"
      } ${
        active ? "bg-ink text-ink-inverse" : "bg-surface text-ink-2 ring-1 ring-inset ring-hairline-strong hover:text-ink"
      }`}
    >
      {children}
      {caret && <ChevronDown className={`h-4 w-4 ${active ? "text-ink-inverse/70" : "text-ink-3"}`} />}
    </button>
  );
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
  const [schedule, setSchedule] = useState<WaveSchedule | null>(null);
  const [toolSheet, setToolSheet] = useState<ToolSheet | "menu" | null>(null);
  const [filterSheet, setFilterSheet] = useState<FilterSheet | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  /** Wave whose pick-list groups were already given their default fold. */
  const seededCollapseFor = useRef<string | null>(null);
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
    }
    if (handoverRes?.ok) {
      const hData = await handoverRes.json();
      setHandover(hData.couriers ?? []);
    }
  }, []);

  /** Runs an action with toast + reload. Resolves true when it succeeded. */
  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<string | void>, nextWaveId?: string | null) {
    setBusy(kind);
    try {
      const msg = await fn();
      if (msg) toast(msg);
      await load(nextWaveId);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveSchedule(auto: boolean, nextTimes: string[], nextContinuous: boolean) {
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
      return false;
    }
    return run("schedule", async () => {
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
      // Phones stack the result under the controls; bring it into view.
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }));
      }
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

  const header = ready ? readyHeader(ready, platformFilter) : null;
  const filtersActive = platformFilter !== "ALL" || courierFilter !== "ALL" || pieceMode !== "all" || includeNewOrders;
  const scheduleStatus = !schedule?.auto
    ? "Off"
    : schedule.continuous
      ? "Every 15 min"
      : schedule.nextAt
        ? `Next ${manilaTime(schedule.nextAt)}`
        : "Scheduled";
  const handoverWaiting = handover.reduce((n, h) => n + h.awaitingPickupCount, 0);
  const previewShippable =
    latest?.status === "PREVIEW" &&
    (s?.total ?? 0) > 0 &&
    canShip &&
    Date.now() - new Date(latest.createdAt).getTime() < PREVIEW_MAX_AGE_MS;

  // Several courier stacks: start folded so the headers fit on one screen.
  useEffect(() => {
    if (!latest || !s || seededCollapseFor.current === latest.id) return;
    seededCollapseFor.current = latest.id;
    if (s.groups.length > 2) {
      setCollapsedGroups(Object.fromEntries(s.groups.map((g) => [g.key, true])));
    }
  }, [latest, s]);

  function resetFilters() {
    setPlatformFilter("ALL");
    setCourierFilter("ALL");
    setPieceMode("all");
    setIncludeNewOrders(false);
  }

  function printSlip(courier: string) {
    void run("handover", async () => {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courier, mode: "print" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't print slip");
      return `${courier} handover slip queued`;
    });
  }

  return (
    <AppShell
      title="Waves"
      width="wide"
      onRefresh={load}
      headerRight={
        <button
          type="button"
          onClick={() => setToolSheet("menu")}
          aria-label="Ship tools"
          title="Ship tools"
          className="pressable relative hidden h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-ink/[0.05] lg:flex"
        >
          <Wrench className="h-[21px] w-[21px]" />
          {handoverWaiting > 0 && (
            <span aria-hidden="true" className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-brand-solid ring-2 ring-ground" />
          )}
        </button>
      }
    >
      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-4">
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

            {schedule?.auto && (
              <button
                type="button"
                onClick={() => setToolSheet("schedule")}
                className="pressable mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-arrived-soft px-3 text-[13px] font-semibold text-arrived tabular-nums"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-arrived" />
                Auto-ship on · {scheduleStatus}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}

            <ScrollChips label="Wave filters" className="-mx-4 mt-4" rowClassName="gap-1.5 px-4 py-1">
              <FilterChip active={platformFilter !== "ALL"} onClick={() => setFilterSheet("shop")}>
                {platformFilter === "ALL" ? "All shops" : platformFilter === "SHOPEE" ? "Shopee" : "TikTok"}
              </FilterChip>
              {ready && ready.byCourier.length > 0 && (
                <FilterChip active={courierFilter !== "ALL"} onClick={() => setFilterSheet("courier")}>
                  {courierFilter === "ALL" ? "All couriers" : courierFilter}
                </FilterChip>
              )}
              <FilterChip active={pieceMode !== "all"} onClick={() => setFilterSheet("pieces")}>
                {PIECE_LABELS[pieceMode]}
              </FilterChip>
              <FilterChip
                active={includeNewOrders}
                caret={false}
                pressed={includeNewOrders}
                onClick={() => setIncludeNewOrders((v) => !v)}
              >
                {includeNewOrders ? "✓ " : "+ "}
                {header && header.waiting > 0 ? `${header.waiting} under 1h` : "Under 1h"}
              </FilterChip>
              {filtersActive && (
                <button
                  type="button"
                  onClick={resetFilters}
                  aria-label="Reset filters"
                  className="pressable inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[14px] font-semibold text-ink-3 hover:text-ink"
                >
                  <X className="h-4 w-4" />
                  Reset
                </button>
              )}
            </ScrollChips>
            {includeNewOrders && (
              <p className="mt-1.5 text-[13px] text-ink-3">
                Includes orders still inside the buyer&apos;s 1-hour cancel window.
              </p>
            )}

            <div className="mt-4 space-y-1.5">
              <Button full size="lg" disabled={busy !== null} onClick={() => preview()}>
                {busy === "preview"
                  ? "Checking orders…"
                  : filterLabel
                    ? `Preview ${filterLabel}`
                    : "Preview wave"}
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
              <p className="flex flex-wrap items-center justify-center gap-x-1 pt-1 text-center text-[13px] text-ink-3">
                <span>Orders are re-checked for cancellation before shipping.</span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => preview(5)}
                  className="pressable inline-flex min-h-9 items-center px-1 font-semibold text-brand disabled:text-ink-3"
                >
                  Test with 5
                </button>
              </p>
            </div>
          </Group>

          <div className="grid grid-cols-3 gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setToolSheet("schedule")}
              className="pressable flex min-h-12 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] bg-surface px-2 py-2.5 text-center shadow-[var(--shadow-card)] active:bg-surface-muted"
            >
              <span className="relative flex items-center justify-center text-ink-2">
                <Clock className="h-[18px] w-[18px]" />
                {schedule?.auto && (
                  <span aria-hidden="true" className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-arrived" />
                )}
              </span>
              <span className="text-[12px] font-semibold text-ink">Auto-ship</span>
            </button>
            <button
              type="button"
              onClick={() => setToolSheet("reprint")}
              className="pressable flex min-h-12 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] bg-surface px-2 py-2.5 text-center shadow-[var(--shadow-card)] active:bg-surface-muted"
            >
              <Printer className="h-[18px] w-[18px] text-ink-2" />
              <span className="text-[12px] font-semibold text-ink">Reprint</span>
            </button>
            <button
              type="button"
              onClick={() => setToolSheet("handover")}
              className="pressable relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] bg-surface px-2 py-2.5 text-center shadow-[var(--shadow-card)] active:bg-surface-muted"
            >
              <span className="relative flex items-center justify-center text-ink-2">
                <Truck className="h-[18px] w-[18px]" />
                {handoverWaiting > 0 && (
                  <span className="tabular-nums absolute -right-3.5 -top-1.5 min-w-[16px] rounded-full bg-brand-solid px-1 py-0.5 text-[10px] font-bold leading-none text-on-brand">
                    {handoverWaiting}
                  </span>
                )}
              </span>
              <span className="text-[12px] font-semibold text-ink">Handover</span>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {waves && waves.length > 1 && (
            <ScrollChips role="tablist" label="Recent waves" rowClassName="gap-1.5 px-5 py-0.5">
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
                    className={`pressable h-11 shrink-0 rounded-full px-3.5 text-[13px] font-semibold tabular-nums ${
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
            <section ref={resultRef} className="scroll-mt-16 space-y-4">
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
                                      className="group pressable flex w-full items-center gap-2 rounded-[var(--radius-control)] bg-surface-subtle px-2.5 py-1.5 text-left ring-1 ring-hairline/80 hover:bg-surface-muted hover:ring-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
                                  className="group pressable-row flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
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
      {previewShippable && latest && s && (
        <>
          {/* Room so the last pick-list row isn't hidden behind the bar. */}
          <div aria-hidden="true" className="h-20 lg:hidden" />
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(12px,env(safe-area-inset-bottom))+72px)] z-20 px-3 lg:hidden">
            <div className="anim-fade-in pointer-events-auto mx-auto flex max-w-md gap-2 rounded-[22px] bg-surface/90 p-2 shadow-[var(--shadow-tab-bar)] backdrop-blur-xl backdrop-saturate-150">
              <Button className="h-12 flex-1" disabled={busy !== null} onClick={() => start(latest)}>
                {busy === "start" ? "Starting…" : `Ship ${s.total} parcels`}
              </Button>
              <Button
                variant="secondary"
                className="h-12 px-4"
                disabled={busy !== null}
                onClick={() => printPickList(latest.id)}
              >
                {busy === "print" ? "Sending…" : "Pick list"}
              </Button>
            </div>
          </div>
        </>
      )}
      <WaveToolsMenu
        open={toolSheet === "menu"}
        onClose={() => setToolSheet(null)}
        onPick={setToolSheet}
        scheduleStatus={scheduleStatus}
        handoverWaiting={handoverWaiting}
      />
      <AutoShipSheet
        open={toolSheet === "schedule"}
        onClose={() => setToolSheet(null)}
        schedule={schedule}
        canShip={canShip}
        busy={busy !== null}
        onSave={saveSchedule}
      />
      <ReprintSheet
        open={toolSheet === "reprint"}
        onClose={() => setToolSheet(null)}
        busy={busy !== null}
        rangeTarget={
          hasPrintedOrQueued && latest && s
            ? { waveId: latest.id, parcelCount: latest.parcelCount, groups: s.groups }
            : null
        }
        onReprint={(orderSn) =>
          run("reprint", async () => {
            const data = await post({ action: "reprint", orderSn });
            return `Reprinting ${data.orderSn}`;
          })
        }
        onReprintRange={(fromPos, toPos, groupKey) =>
          run("reprint", async () => {
            if (!latest) return;
            const data = await post({
              action: "reprint_range",
              waveId: latest.id,
              fromPos,
              toPos,
              ...(groupKey ? { groupKey } : {}),
            });
            return `Reprinting ${data.queuedParcels} parcels`;
          })
        }
      />
      <HandoverSheet
        open={toolSheet === "handover"}
        onClose={() => setToolSheet(null)}
        handover={handover}
        busy={busy !== null}
        onPrintSlip={printSlip}
      />
      <FilterPickerSheet
        open={filterSheet === "shop"}
        onClose={() => setFilterSheet(null)}
        title="Shop"
        value={platformFilter}
        onChange={setPlatformFilter}
        options={[
          { id: "ALL", label: "All shops", count: ready?.totalReady ?? null },
          { id: "SHOPEE", label: "Shopee", count: ready?.byPlatform.SHOPEE ?? null },
          { id: "TIKTOK", label: "TikTok", count: ready?.byPlatform.TIKTOK ?? null },
        ]}
      />
      <FilterPickerSheet
        open={filterSheet === "courier"}
        onClose={() => setFilterSheet(null)}
        title="Courier"
        value={courierFilter}
        onChange={setCourierFilter}
        options={[
          { id: "ALL", label: "All couriers", count: null },
          ...(ready?.byCourier ?? []).map((c) => ({ id: c.courier, label: c.courier, count: c.count })),
        ]}
      />
      <FilterPickerSheet
        open={filterSheet === "pieces"}
        onClose={() => setFilterSheet(null)}
        title="Pieces per parcel"
        value={pieceMode}
        onChange={setPieceMode}
        options={[
          { id: "all", label: "Any" },
          { id: "singles", label: "1 piece" },
          { id: "multis", label: "2 or more" },
        ]}
      />
      <WaveParcelSheet
        selection={parcelSelection}
        showFullNames={showFullNames}
        canExclude={latest?.status === "PREVIEW"}
        actionBusy={busy !== null}
        onReprintParcel={async (orderSn) => {
          await run("reprint", async () => {
            const data = await post({ action: "reprint", orderSn });
            return `Reprinting ${data.orderSn}`;
          });
        }}
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
