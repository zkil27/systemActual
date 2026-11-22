"use client";

import { useMemo, useState } from "react";
import { Check, CheckCircle2, MoreHorizontal, Printer, RefreshCw } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { ScrollChips } from "@/components/ui/ScrollChips";
import { StatusText } from "@/components/ui/StatusPill";
import type { StaffSafeOutboundPackage } from "@/lib/auth";
import type { StaffPickGroup } from "@/app/api/scan/wave/route";
import { manilaDateTime, manilaTime, shortCourier } from "@/lib/ui/format";
import type { StatusTone } from "@/lib/ui/parcel-status";
import {
  MultiParcelActionSheet,
  PickVariantActionSheet,
  type MultiParcelTarget,
  type PickVariantTarget,
} from "./PickActionSheets";

export interface StaffWaveData {
  id: string;
  status: string;
  createdAt: string;
  parcelCount: number;
  printedCount: number;
  notPrintedCount: number;
  singles: number;
  multis: number;
  courierTotals: Array<{ title: string; count: number }>;
  groups: StaffPickGroup[];
  multiParcels: StaffSafeOutboundPackage[];
}

function last6(trackingNumber: string | null, orderSn: string): string {
  const raw = (trackingNumber?.trim() || orderSn.trim()).toUpperCase();
  return raw.length > 6 ? raw.slice(-6) : raw;
}

function isSameManilaDay(iso: string): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(iso)) === fmt.format(new Date());
  } catch {
    return false;
  }
}

function waveStatusInfo(wave: StaffWaveData): { label: string; tone: StatusTone } {
  if (wave.status === "PREVIEW") {
    return { label: "Not printed yet", tone: "overdue" };
  }
  if (wave.status === "RUNNING") {
    return { label: `Printing ${wave.printedCount}/${wave.parcelCount}`, tone: "neutral" };
  }
  return { label: `Printed ${wave.printedCount}/${wave.parcelCount}`, tone: "arrived" };
}

/**
 * Turns "TikTok · J&T Express" into a short chip label ("J&T"),
 * preserving platform prefix only when two platforms share the same courier.
 */
function buildCourierChipLabels(groups: StaffPickGroup[]): Map<string, string> {
  const parsed = groups.map((g) => {
    const parts = g.title.split("·").map((s) => s.trim());
    const courierRaw = parts.length > 1 ? parts[parts.length - 1] : g.title;
    const short = shortCourier(courierRaw);
    const platform = parts.length > 1 ? parts[0] : "";
    return { key: g.key, short, platform };
  });

  const counts = new Map<string, number>();
  for (const p of parsed) {
    counts.set(p.short, (counts.get(p.short) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const p of parsed) {
    const collides = (counts.get(p.short) ?? 0) > 1;
    labels.set(p.key, collides && p.platform ? `${p.platform} · ${p.short}` : p.short);
  }
  return labels;
}

export function PickListSection({
  waveData,
  waveLoading,
  waveError,
  checkedPickKeys,
  reprintingSn,
  onToggleChecked,
  onRefresh,
  onOpenCheckSheet,
  onReprintLabel,
}: {
  waveData: StaffWaveData | null;
  waveLoading: boolean;
  waveError: string;
  checkedPickKeys: Record<string, boolean>;
  reprintingSn: string | null;
  onToggleChecked: (key: string) => void;
  onRefresh: () => void;
  onOpenCheckSheet: () => void;
  onReprintLabel: (orderSn: string) => Promise<void> | void;
}) {
  // "all" | "multis" | <courier group key>
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [hidePicked, setHidePicked] = useState(false);
  const [variantTarget, setVariantTarget] = useState<PickVariantTarget | null>(null);
  const [parcelTarget, setParcelTarget] = useState<MultiParcelTarget | null>(null);

  const resolvedFilter = useMemo(() => {
    if (!waveData) return "all";
    if (activeFilter === "all") return "all";
    if (activeFilter === "multis") {
      return waveData.multiParcels.length > 0 ? "multis" : "all";
    }
    return waveData.groups.some((g) => g.key === activeFilter) ? activeFilter : "all";
  }, [waveData, activeFilter]);

  const courierChipLabels = useMemo(
    () => (waveData ? buildCourierChipLabels(waveData.groups) : new Map<string, string>()),
    [waveData]
  );

  const visibleGroups = useMemo(() => {
    if (!waveData || resolvedFilter === "multis") return [];
    if (resolvedFilter === "all") return waveData.groups;
    return waveData.groups.filter((g) => g.key === resolvedFilter);
  }, [waveData, resolvedFilter]);

  // Progress counts for the active view
  const progress = useMemo(() => {
    if (!waveData) return { picked: 0, total: 0 };
    if (resolvedFilter === "multis") {
      const total = waveData.multiParcels.length;
      const picked = waveData.multiParcels.filter((p) =>
        Boolean(checkedPickKeys[`multi::${p.packageId}`])
      ).length;
      return { picked, total };
    }
    let total = 0;
    let picked = 0;
    for (const g of visibleGroups) {
      for (const pg of g.garments) {
        for (const v of pg.variants) {
          total += 1;
          if (checkedPickKeys[`${g.key}::${v.label}`]) picked += 1;
        }
      }
    }
    return { picked, total };
  }, [waveData, resolvedFilter, visibleGroups, checkedPickKeys]);

  const statusInfo = waveData ? waveStatusInfo(waveData) : null;
  const timeStamp = waveData
    ? isSameManilaDay(waveData.createdAt)
      ? manilaTime(waveData.createdAt)
      : manilaDateTime(waveData.createdAt)
    : "";

  const showFilterStrip =
    waveData !== null && (waveData.multiParcels.length > 0 || waveData.groups.length > 1);
  const progressPct = progress.total > 0 ? Math.round((progress.picked / progress.total) * 100) : 0;
  const allHiddenDone = hidePicked && progress.total > 0 && progress.picked === progress.total;

  return (
    <section className="space-y-5">
      {/* Calm wave header: Apple Large Title + full-width single-line status */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <h1 className="whitespace-nowrap text-[34px] font-extrabold leading-[1.1] tracking-[-0.025em] text-ink tabular-nums">
            {waveData
              ? `${waveData.parcelCount} ${waveData.parcelCount === 1 ? "parcel" : "parcels"}`
              : "Pick list"}
          </h1>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenCheckSheet}
              className="pressable flex h-10 items-center gap-1.5 rounded-full bg-white px-3 text-[15px] font-semibold text-ink shadow-[var(--shadow-card)] hover:bg-slate-50"
            >
              <Printer className="h-4 w-4 text-brand" />
              <span>Reprint</span>
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={waveLoading}
              aria-label="Refresh pick list"
              className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-2 shadow-[var(--shadow-card)] hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${waveLoading ? "anim-spin" : ""}`} />
            </button>
          </div>
        </div>

        {statusInfo && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[15px]">
            <StatusText label={statusInfo.label} tone={statusInfo.tone} />
            {timeStamp && (
              <span className="whitespace-nowrap text-ink-3 tabular-nums">· {timeStamp}</span>
            )}
          </div>
        )}
      </div>

      {/* Subtle progress bar + Hide picked toggle */}
      {waveData && progress.total > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[15px] font-semibold text-ink-2 tabular-nums">
              {progress.picked} of {progress.total}{" "}
              {resolvedFilter === "multis" ? "packed" : "picked"}
            </span>
            {progress.picked > 0 && (
              <button
                type="button"
                onClick={() => setHidePicked((h) => !h)}
                className="pressable -mr-1.5 rounded-full px-2 py-1 text-[15px] font-semibold text-brand hover:bg-brand-soft"
              >
                {hidePicked ? "Show picked" : "Hide picked"}
              </button>
            )}
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress.picked}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Picking progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80"
          >
            <div
              className="h-full rounded-full bg-arrived transition-[width] duration-300 ease-[var(--ease-ios)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Single unified Apple filter strip */}
      {showFilterStrip && waveData && (
        <ScrollChips role="tablist" label="Filters">
          <button
            type="button"
            role="tab"
            aria-selected={resolvedFilter === "all"}
            onClick={() => setActiveFilter("all")}
            className={`pressable h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold transition-colors ${
              resolvedFilter === "all"
                ? "bg-ink text-white"
                : "bg-white text-ink-2 shadow-[var(--shadow-card)] hover:text-ink"
            }`}
          >
            All items
          </button>

          {waveData.multiParcels.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={resolvedFilter === "multis"}
              onClick={() => setActiveFilter("multis")}
              className={`pressable h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold tabular-nums transition-colors ${
                resolvedFilter === "multis"
                  ? "bg-ink text-white"
                  : "bg-white text-ink-2 shadow-[var(--shadow-card)] hover:text-ink"
              }`}
            >
              Multi-item ({waveData.multiParcels.length})
            </button>
          )}

          {waveData.groups.length > 1 &&
            waveData.groups.map((g) => {
              const active = resolvedFilter === g.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveFilter(g.key)}
                  className={`pressable h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold tabular-nums transition-colors ${
                    active
                      ? "bg-ink text-white"
                      : "bg-white text-ink-2 shadow-[var(--shadow-card)] hover:text-ink"
                  }`}
                >
                  {courierChipLabels.get(g.key) ?? g.title} ({g.count})
                </button>
              );
            })}
        </ScrollChips>
      )}

      {waveError && (
        <p role="alert" className="px-1 text-[15px] font-semibold text-missing-ink">
          {waveError}
        </p>
      )}

      {/* Loading skeleton (initial load only) */}
      {waveLoading && !waveData && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading pick list">
          {[0, 1, 2].map((i) => (
            <Group key={i} className="p-4">
              <div className="flex items-center gap-3.5">
                <div className="h-14 w-14 animate-pulse rounded-[var(--radius-control)] bg-slate-200/80" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200/80" />
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
              <div className="mt-4 space-y-3 border-t border-hairline pt-3">
                <div className="h-5 w-2/3 animate-pulse rounded bg-slate-100" />
                <div className="h-5 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            </Group>
          ))}
        </div>
      )}

      {/* Empty wave state */}
      {!waveLoading && !waveData && !waveError && (
        <Group className="p-5">
          <p className="text-[16px] font-bold text-ink">No pick list yet</p>
          <p className="mt-1 text-[15px] text-ink-3">
            When a shipping wave is ready, garment photos, colors, and sizes will appear here.
          </p>
        </Group>
      )}

      {/* All items hidden because everything is picked */}
      {allHiddenDone && (
        <Group className="flex flex-col items-center px-5 py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-arrived" strokeWidth={1.8} />
          <p className="mt-3 text-[20px] font-extrabold tracking-[-0.01em] text-ink">
            All {resolvedFilter === "multis" ? "multi-item parcels packed" : "items picked"}
          </p>
          <p className="mt-1 text-[15px] text-ink-3">
            Great work. Tap below if you want to double-check the list.
          </p>
          <Button
            variant="secondary"
            onClick={() => setHidePicked(false)}
            className="mt-4"
          >
            Show picked items
          </Button>
        </Group>
      )}

      {/* View A: Garment pick list (1 clean Group card per garment, flat inset-hairline rows) */}
      {waveData && resolvedFilter !== "multis" && !allHiddenDone && (
        <div className="space-y-7">
          {visibleGroups.map((g) => {
            const visibleGarments = g.garments.filter((pg) => {
              if (!hidePicked) return true;
              return pg.variants.some((v) => !checkedPickKeys[`${g.key}::${v.label}`]);
            });
            if (visibleGarments.length === 0) return null;

            return (
              <div key={g.key} className="space-y-3.5">
                {resolvedFilter === "all" && (
                  <div className="flex items-baseline justify-between gap-3 px-1">
                    <h2 className="text-[15px] font-bold text-ink-2">{g.title}</h2>
                    <span className="text-[15px] font-medium text-ink-3 tabular-nums">
                      {g.count} {g.count === 1 ? "parcel" : "parcels"}
                    </span>
                  </div>
                )}

                <div className="space-y-4">
                  {visibleGarments.map((pg) => {
                    const allVariantsChecked =
                      pg.variants.length > 0 &&
                      pg.variants.every((v) => Boolean(checkedPickKeys[`${g.key}::${v.label}`]));

                    return (
                      <Group
                        key={pg.key}
                        className={allVariantsChecked ? "opacity-75 transition-opacity" : ""}
                      >
                        {/* Garment card header */}
                        <div className="flex items-center gap-3.5 px-4 py-3.5">
                          <ItemThumb src={pg.imageUrl} alt={pg.shortName} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[16px] font-bold leading-snug text-ink">
                              {pg.shortName}
                            </p>
                            <p className="mt-0.5 text-[15px] font-medium tabular-nums">
                              {allVariantsChecked ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-arrived">
                                  <Check className="h-4 w-4" strokeWidth={3} />
                                  All {pg.totalQty} {pg.totalQty === 1 ? "pc" : "pcs"} picked
                                </span>
                              ) : (
                                <span className="text-ink-3">
                                  {pg.totalQty} {pg.totalQty === 1 ? "pc" : "pcs"} total
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Flat inset-hairline variant rows */}
                        <ul className="divide-y divide-hairline border-t border-hairline">
                          {pg.variants.map((v, idx) => {
                            const checkKey = `${g.key}::${v.label}`;
                            const checked = Boolean(checkedPickKeys[checkKey]);
                            if (hidePicked && checked) return null;

                            return (
                              <li
                                key={`${checkKey}-${idx}`}
                                className={`flex items-center transition-colors ${
                                  checked ? "bg-arrived-soft/45" : "bg-white"
                                }`}
                              >
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={checked}
                                  onClick={() => onToggleChecked(checkKey)}
                                  className="pressable flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left hover:bg-black/[0.015] active:bg-black/[0.03]"
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                      checked
                                        ? "border-arrived bg-arrived text-white"
                                        : "border-hairline-strong bg-white"
                                    }`}
                                  >
                                    {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                  </span>

                                  <span className="flex w-10 shrink-0 justify-center">
                                    {v.qty > 1 ? (
                                      <span
                                        className={`inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-0.5 text-[15px] font-extrabold tabular-nums ${
                                          checked
                                            ? "bg-arrived/15 text-arrived"
                                            : "bg-brand text-white"
                                        }`}
                                      >
                                        {v.qty}×
                                      </span>
                                    ) : (
                                      <span
                                        className={`text-[16px] font-bold tabular-nums ${
                                          checked ? "text-arrived" : "text-ink-2"
                                        }`}
                                      >
                                        {v.qty}×
                                      </span>
                                    )}
                                  </span>

                                  <span className="min-w-0 flex-1">
                                    <span
                                      className={`block text-[16px] font-semibold leading-snug ${
                                        checked ? "text-ink-3 line-through" : "text-ink"
                                      }`}
                                    >
                                      {v.color ?? "Standard"}
                                    </span>
                                    {v.size && (
                                      <span
                                        className={`mt-0.5 block text-[15px] leading-snug ${
                                          checked ? "text-ink-3" : "text-ink-2"
                                        }`}
                                      >
                                        {v.size}
                                      </span>
                                    )}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  aria-label={`More options for ${pg.shortName} ${v.color ?? ""} ${v.size ?? ""}`.trim()}
                                  onClick={() =>
                                    setVariantTarget({
                                      checkKey,
                                      garmentName: pg.shortName,
                                      imageUrl: pg.imageUrl,
                                      color: v.color,
                                      size: v.size,
                                      qty: v.qty,
                                      garmentVariantId: v.garmentVariantId,
                                      checked,
                                    })
                                  }
                                  className="pressable flex h-12 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-black/[0.04] hover:text-ink"
                                >
                                  <MoreHorizontal className="h-5 w-5" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </Group>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View B: Multi-item parcel checklist */}
      {waveData && resolvedFilter === "multis" && !allHiddenDone && (
        <div className="space-y-4">
          <p className="px-1 text-[15px] text-ink-3">
            Match the last 6 digits on the waybill to double-check photos and sizes.
          </p>

          {waveData.multiParcels.map((p) => {
            const checkKey = `multi::${p.packageId}`;
            const checked = Boolean(checkedPickKeys[checkKey]);
            if (hidePicked && checked) return null;
            const code6 = last6(p.trackingNumber, p.orderSn);

            return (
              <Group
                key={p.packageId}
                className={checked ? "opacity-70 transition-opacity" : ""}
              >
                <div
                  className={`flex min-h-[56px] items-center border-b border-hairline ${
                    checked ? "bg-arrived-soft/45" : "bg-white"
                  }`}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => onToggleChecked(checkKey)}
                    className="pressable flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        checked
                          ? "border-arrived bg-arrived text-white"
                          : "border-hairline-strong bg-white"
                      }`}
                    >
                      {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <span
                      className={`text-[20px] font-extrabold tracking-[-0.01em] tabular-nums ${
                        checked ? "text-ink-3 line-through" : "text-ink"
                      }`}
                    >
                      ···{code6}
                    </span>
                    <span className="truncate text-[15px] font-medium text-ink-2 tabular-nums">
                      {p.totalPieces} pcs · {shortCourier(p.courier)}
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-label={`More options for parcel ${code6}`}
                    onClick={() =>
                      setParcelTarget({
                        checkKey,
                        code6,
                        parcel: p,
                        checked,
                      })
                    }
                    className="pressable flex h-12 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-black/[0.04] hover:text-ink"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                </div>

                <ul className="divide-y divide-hairline">
                  {p.lines.map((line) => (
                    <li key={line.id} className="flex items-center gap-3.5 px-4 py-3">
                      <ItemThumb src={line.imageUrl} alt={line.shortName} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-semibold leading-snug text-ink">
                          {line.quantity > 1 ? (
                            <span className="mr-1.5 inline-flex items-center rounded-lg bg-brand px-2 py-0.5 text-[15px] font-extrabold text-white tabular-nums">
                              {line.quantity}×
                            </span>
                          ) : (
                            <span className="mr-1.5 font-bold text-ink-2 tabular-nums">
                              {line.quantity}×
                            </span>
                          )}
                          {line.shortName}
                        </p>
                        {line.variationName && (
                          <p className="mt-0.5 text-[15px] text-ink-2">{line.variationName}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Group>
            );
          })}
        </div>
      )}

      <PickVariantActionSheet
        target={variantTarget}
        onClose={() => setVariantTarget(null)}
        onToggleChecked={onToggleChecked}
      />

      <MultiParcelActionSheet
        target={parcelTarget}
        reprintingSn={reprintingSn}
        onClose={() => setParcelTarget(null)}
        onToggleChecked={onToggleChecked}
        onReprintLabel={onReprintLabel}
      />
    </section>
  );
}
