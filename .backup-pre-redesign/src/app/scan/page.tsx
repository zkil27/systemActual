"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Delete,
  LogOut,
  Package,
  QrCode,
  Search,
  X,
} from "lucide-react";
import type { StaffSafeParcel } from "@/lib/auth";

interface StaffOption {
  id: string;
  name: string;
}

interface RecentScanItem {
  id: string;
  scannedBarcode: string;
  condition: string;
  scannedAt: string;
  photoCount: number;
  parcel: {
    id: string;
    orderSn: string;
    courier: string;
    category: string;
    itemSummary: string;
    variationName: string | null;
    itemImageUrl: string | null;
  };
}

const CONDITIONS = [
  {
    id: "GOOD_RESTOCKABLE",
    label: "Good — Ready to Restock",
    sub: "Right item, clean, can sell again",
    tone: "emerald",
  },
  {
    id: "DAMAGED_PACKAGING",
    label: "Torn Pouch Only",
    sub: "Pouch damaged, clothes inside are clean",
    tone: "slate",
  },
  {
    id: "DAMAGED_ITEM",
    label: "Damaged / Stained Item",
    sub: "Take photo proof for dispute",
    tone: "amber",
  },
  {
    id: "WRONG_OR_SWAPPED_ITEM",
    label: "Wrong / Swapped Item",
    sub: "Different clothes or scam return — take photo",
    tone: "red",
  },
  {
    id: "MISSING_PIECE",
    label: "Missing Piece",
    sub: "Quantity inside is incomplete — take photo",
    tone: "red",
  },
] as const;

function playBeep(kind: "ok" | "warn" | "error") {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = kind === "ok" ? 880 : kind === "warn" ? 520 : 280;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + (kind === "ok" ? 0.12 : 0.24));
  } catch {
    // Ignore audio errors on restricted browsers
  }
}

export default function ScanPage() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [actorName, setActorName] = useState("");
  const [isOwnerActor, setIsOwnerActor] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [pendingMissing, setPendingMissing] = useState(0);
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>([]);

  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [matchedParcel, setMatchedParcel] = useState<StaffSafeParcel | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState("");

  const [selectedCondition, setSelectedCondition] = useState<string>("GOOD_RESTOCKABLE");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [savingScan, setSavingScan] = useState(false);
  const [savedBanner, setSavedBanner] = useState("");

  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/scan/session");
      const data = await res.json();
      if (data.unlocked) {
        setUnlocked(true);
        setActorName(data.actor?.name || "Staff");
        setIsOwnerActor(data.actor?.actorType === "owner");
        setTodayCount(data.todayCount ?? 0);
        setPendingMissing(data.pendingMissingCount ?? 0);
        setRecentScans(data.recentScans ?? []);
      } else {
        setUnlocked(false);
        const sRes = await fetch("/api/auth/staff-login");
        const sData = await sRes.json();
        const list: StaffOption[] = sData.staff ?? [];
        setStaffList(list);
        if (list.length > 0) setSelectedStaffId((prev) => prev || list[0].id);
      }
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Already stopped
      }
      scannerRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const lookupBarcode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code) return;
      setLookupError("");
      setSavedBanner("");
      setLookingUp(true);
      try {
        const res = await fetch(`/api/scan/lookup?code=${encodeURIComponent(code)}`);
        const data = await res.json();
        if (!res.ok || !data.found) {
          playBeep("error");
          setMatchedParcel(null);
          setLookupError(
            `No return parcel found for "${code}". Try typing the last 6 digits of the tracking number.`
          );
          return;
        }
        await stopCamera();
        setMatchedParcel(data.parcel);
        setLastScannedCode(code);
        setSelectedCondition("GOOD_RESTOCKABLE");
        setNotes("");
        setPhotos([]);
        playBeep(data.parcel.alreadyScanned ? "warn" : "ok");
      } catch {
        setLookupError("Network error while looking up barcode.");
      } finally {
        setLookingUp(false);
      }
    },
    [stopCamera]
  );

  async function startCamera() {
    setCameraError("");
    setLookupError("");
    setMatchedParcel(null);
    setCameraOpen(true);

    setTimeout(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const qr = new Html5Qrcode("kyna-barcode-reader");
        scannerRef.current = qr;
        await qr.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (decodedText) => {
            lookupBarcode(decodedText);
          },
          () => {}
        );
      } catch {
        setCameraOpen(false);
        setCameraError(
          "Camera could not open (permission or non-HTTPS). You can type the tracking number below instead."
        );
      }
    }, 100);
  }

  async function handlePinSubmit(nextPin: string) {
    if (!selectedStaffId || nextPin.length !== 4) return;
    setUnlockError("");
    setUnlocking(true);
    try {
      const res = await fetch("/api/auth/staff-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: selectedStaffId, pin: nextPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPin("");
        setUnlockError(data.error || "Wrong PIN. Try again.");
        return;
      }
      setPin("");
      await loadSession();
    } finally {
      setUnlocking(false);
    }
  }

  function pressDigit(digit: string) {
    if (unlocking || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      handlePinSubmit(next);
    }
  }

  async function handleConfirmScan() {
    if (!matchedParcel) return;
    setSavingScan(true);
    try {
      const formData = new FormData();
      formData.append("parcelId", matchedParcel.id);
      formData.append("scannedBarcode", lastScannedCode);
      formData.append("condition", selectedCondition);
      if (notes.trim()) formData.append("notes", notes.trim());
      for (const file of photos) {
        formData.append("photos", file);
      }

      const res = await fetch("/api/scan/confirm", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setLookupError(data.error || "Could not save scan.");
        return;
      }

      playBeep("ok");
      setSavedBanner(
        `Saved: ${matchedParcel.itemSummary}${
          matchedParcel.variationName ? ` (${matchedParcel.variationName})` : ""
        }`
      );
      setMatchedParcel(null);
      setManualCode("");
      setNotes("");
      setPhotos([]);
      await loadSession();
    } finally {
      setSavingScan(false);
    }
  }

  async function handleLockStaff() {
    await stopCamera();
    await fetch("/api/auth/logout", { method: "POST" });
    setUnlocked(false);
    setMatchedParcel(null);
    await loadSession();
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f4f7f8] p-4">
        <div className="h-64 w-full max-w-sm animate-pulse rounded-2xl bg-slate-200" />
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="flex min-h-dvh flex-col justify-center bg-[#f4f7f8] px-4 py-6">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0f766e] text-white">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-slate-900">Return Scanner</h1>
                <p className="text-xs font-medium text-slate-600">Kyna Ops Warehouse</p>
              </div>
            </div>
            <Link href="/login" className="text-xs font-bold text-[#0f766e] hover:underline">
              Owner Login
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-800">1. Tap your name</p>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {staffList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedStaffId(s.id);
                    setPin("");
                    setUnlockError("");
                  }}
                  className={`h-12 rounded-xl text-sm font-bold transition-colors ${
                    selectedStaffId === s.id
                      ? "bg-[#0f766e] text-white"
                      : "border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>

            <p className="mt-5 text-sm font-bold text-slate-800">2. Enter your 4-digit PIN</p>
            <div className="mt-3 flex justify-center gap-3">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className={`flex h-12 w-12 items-center justify-center rounded-xl border-2 text-xl font-extrabold ${
                    pin.length > idx
                      ? "border-[#0f766e] bg-teal-50 text-[#0f766e]"
                      : "border-slate-200 bg-slate-50 text-slate-300"
                  }`}
                >
                  {pin.length > idx ? "•" : ""}
                </div>
              ))}
            </div>

            {unlockError && (
              <p className="mt-3 text-center text-sm font-bold text-red-700">{unlockError}</p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={unlocking}
                  onClick={() => pressDigit(d)}
                  className="tabular-nums h-14 rounded-xl border border-slate-200 bg-white text-xl font-extrabold text-slate-900 active:bg-slate-100"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPin("")}
                className="h-14 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 active:bg-slate-100"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={unlocking}
                onClick={() => pressDigit("0")}
                className="tabular-nums h-14 rounded-xl border border-slate-200 bg-white text-xl font-extrabold text-slate-900 active:bg-slate-100"
              >
                0
              </button>
              <button
                type="button"
                aria-label="Backspace"
                onClick={() => setPin((p) => p.slice(0, -1))}
                className="flex h-14 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-100"
              >
                <Delete className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-slate-500">
              Demo PINs: Ana 1111 • Joy 2222 • Mark 3333 • Lisa 4444
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#f4f7f8] pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f766e] text-white">
              <QrCode className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-extrabold text-slate-900">Return Scanner</p>
              <p className="text-[11px] font-semibold text-slate-500">
                Staff: {actorName} • Scanned today: {todayCount}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOwnerActor && (
              <Link
                href="/"
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
              >
                Dashboard
              </Link>
            )}
            <button
              type="button"
              onClick={handleLockStaff}
              aria-label="Switch staff"
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              Lock
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-slate-500">Your Scans Today</p>
            <p className="tabular-nums text-2xl font-extrabold text-emerald-700">
              {todayCount}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-500">Still Waiting to Scan</p>
            <p className="tabular-nums text-2xl font-extrabold text-red-600">
              {pendingMissing}
            </p>
          </div>
        </div>

        {savedBanner && (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm font-bold text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <span className="leading-snug">{savedBanner}</span>
          </div>
        )}

        {!matchedParcel && (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            {!cameraOpen ? (
              <button
                type="button"
                onClick={startCamera}
                className="flex h-16 w-full items-center justify-center gap-2.5 rounded-xl bg-[#0f766e] text-base font-extrabold text-white shadow-sm transition-colors hover:bg-[#115e59] active:scale-[0.99]"
              >
                <Camera className="h-6 w-6" />
                <span>Open Phone Camera Scanner</span>
              </button>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800">
                    Point camera at the waybill barcode
                  </p>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700"
                  >
                    <X className="h-4 w-4" />
                    Stop
                  </button>
                </div>
                <div
                  id="kyna-barcode-reader"
                  className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900"
                />
              </div>
            )}

            {cameraError && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                {cameraError}
              </p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookupBarcode(manualCode);
              }}
              className="flex gap-2 pt-1"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Or type tracking / last 6 digits..."
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#0f766e] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={lookingUp || manualCode.trim().length < 4}
                className="h-12 shrink-0 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {lookingUp ? "..." : "Find"}
              </button>
            </form>

            {lookupError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"
              >
                {lookupError}
              </div>
            )}
          </section>
        )}

        {matchedParcel && (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                    matchedParcel.category === "FAILED_DELIVERY"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {matchedParcel.category === "FAILED_DELIVERY"
                    ? "Failed Delivery"
                    : "Buyer Return"}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  {matchedParcel.courier}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMatchedParcel(null)}
                aria-label="Cancel scan"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {matchedParcel.alreadyScanned && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>Already scanned before. Saving will log a re-check.</span>
              </div>
            )}

            <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-3">
              {matchedParcel.itemImageUrl ? (
                <img
                  src={matchedParcel.itemImageUrl}
                  alt={matchedParcel.itemSummary}
                  className="h-24 w-24 shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-500">
                  <Package className="h-10 w-10" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Expected Inside Parcel
                </p>
                <p className="mt-0.5 text-lg font-extrabold leading-snug text-slate-900">
                  {matchedParcel.quantity}× {matchedParcel.itemSummary}
                </p>
                {matchedParcel.variationName && (
                  <p className="mt-1 inline-block rounded-lg bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">
                    {matchedParcel.variationName}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-extrabold text-slate-900">
                Check the item inside and tap condition:
              </p>
              {CONDITIONS.map((c) => {
                const active = selectedCondition === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCondition(c.id)}
                    className={`flex w-full items-center justify-between rounded-xl border-2 px-3.5 py-3 text-left transition-colors ${
                      active
                        ? c.tone === "emerald"
                          ? "border-emerald-600 bg-emerald-50"
                          : c.tone === "red"
                          ? "border-red-600 bg-red-50"
                          : c.tone === "amber"
                          ? "border-amber-500 bg-amber-50"
                          : "border-slate-700 bg-slate-100"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">{c.label}</p>
                      <p className="text-xs font-medium text-slate-600">{c.sub}</p>
                    </div>
                    <span
                      className={`h-5 w-5 shrink-0 rounded-full border-2 ${
                        active ? "border-slate-900 bg-slate-900" : "border-slate-300"
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="space-y-2.5">
              <label className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-400 bg-slate-50 text-sm font-bold text-slate-800 hover:bg-slate-100">
                <Camera className="h-5 w-5 text-[#0f766e]" />
                <span>
                  {photos.length > 0
                    ? `${photos.length} Photo(s) Attached — Tap to Replace`
                    : "Take / Attach Proof Photo (Optional)"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []).slice(0, 3);
                    setPhotos(files);
                  }}
                />
              </label>

              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Short note (e.g. wrong color, stained)..."
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0f766e] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleConfirmScan}
              disabled={savingScan}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#0f766e] text-base font-extrabold text-white shadow-sm transition-colors hover:bg-[#115e59] disabled:opacity-60"
            >
              <CheckCircle2 className="h-5 w-5" />
              {savingScan ? "Saving..." : "Confirm Parcel Arrived"}
            </button>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-extrabold text-slate-900">Your Recent Scans Today</h2>
          </div>
          {recentScans.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs font-medium text-slate-500">
              No parcels scanned by you yet today.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentScans.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  {s.parcel.itemImageUrl ? (
                    <img
                      src={s.parcel.itemImageUrl}
                      alt={s.parcel.itemSummary}
                      className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Package className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {s.parcel.itemSummary}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {s.scannedBarcode} • {s.parcel.courier.replace(" Express", "")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                      s.condition === "GOOD_RESTOCKABLE"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {s.condition === "GOOD_RESTOCKABLE" ? "Good" : "Issue"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
