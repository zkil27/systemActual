"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, Delete, Lock, PackagePlus, ScanBarcode, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Sheet } from "@/components/ui/Sheet";
import type { StaffSafeParcel } from "@/lib/auth";
import { CONDITIONS, DEFAULT_CONDITION, findCondition, type ConditionTone } from "@/lib/ui/conditions";
import { shortCourier } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/motion";
import { categoryLabel } from "@/lib/ui/parcel-status";
import { PIN_LENGTH, applyPinKey, keyFromKeyboard } from "@/lib/ui/pin";

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

const TONE_SELECTED: Record<ConditionTone, string> = {
  good: "bg-arrived-soft shadow-[inset_0_0_0_2px_var(--color-arrived)]",
  neutral: "bg-slate-100 shadow-[inset_0_0_0_2px_var(--color-ink-2)]",
  warn: "bg-failed-soft shadow-[inset_0_0_0_2px_#d97706]",
  bad: "bg-missing-soft shadow-[inset_0_0_0_2px_var(--color-missing)]",
};

const TONE_DOT: Record<ConditionTone, string> = {
  good: "border-arrived bg-arrived",
  neutral: "border-ink-2 bg-ink-2",
  warn: "border-amber-600 bg-amber-600",
  bad: "border-missing bg-missing",
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

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

function CheckDraw() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <circle cx="12" cy="12" r="11" className="fill-white/20" />
      <path
        d="M7 12.5l3.2 3.2L17 9"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="anim-check-draw"
      />
    </svg>
  );
}

export default function ScanPage() {
  // Dev-only hints. Next swaps NODE_ENV for a literal, so production builds drop them entirely.
  const demo = process.env.NODE_ENV === "development";
  const [checkingSession, setCheckingSession] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [actorName, setActorName] = useState("");
  const [isOwnerActor, setIsOwnerActor] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [pendingMissing, setPendingMissing] = useState(0);
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);

  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [wrongCount, setWrongCount] = useState(0);
  const [unlocking, setUnlocking] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [matchedParcel, setMatchedParcel] = useState<StaffSafeParcel | null>(null);
  const [choices, setChoices] = useState<StaffSafeParcel[]>([]);
  const [lastScannedCode, setLastScannedCode] = useState("");

  const [selectedCondition, setSelectedCondition] = useState<string>(DEFAULT_CONDITION);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [savingScan, setSavingScan] = useState(false);
  const [saved, setSaved] = useState<{ id: number; text: string } | null>(null);

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

  // The success card leaves by itself; the scanner is usable the whole time.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 2600);
    return () => clearTimeout(t);
  }, [saved]);

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

  const openParcel = useCallback((parcel: StaffSafeParcel) => {
    setChoices([]);
    setMatchedParcel(parcel);
    setSelectedCondition(DEFAULT_CONDITION);
    setNotes("");
    setPhotos([]);
    setSaved(null);
    playBeep(parcel.alreadyScanned ? "warn" : "ok");
    haptic(12);
  }, []);

  const lookupBarcode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code) return;
      setLookupError("");
      setLookingUp(true);
      try {
        const res = await fetch(`/api/scan/lookup?code=${encodeURIComponent(code)}`);
        const data = await res.json();
        setChoices([]);
        if (!res.ok || !data.found) {
          playBeep("error");
          haptic([30, 40, 30]);
          setMatchedParcel(null);
          setLookupError(data.error || `No return found for ${code}. Try the last 6 digits.`);
          return;
        }
        await stopCamera();
        setLastScannedCode(code);
        if (Array.isArray(data.matches)) {
          // Several parcels share this code: staff pick the one in their hand.
          setMatchedParcel(null);
          setChoices(data.matches);
          playBeep("warn");
          haptic(12);
          return;
        }
        openParcel(data.parcel);
      } catch {
        setLookupError("No connection. Try again.");
      } finally {
        setLookingUp(false);
      }
    },
    [stopCamera, openParcel]
  );

  async function startCamera() {
    setCameraError("");
    setLookupError("");
    setMatchedParcel(null);
    setChoices([]);
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
        setCameraError("Camera didn't open. Type the tracking number instead.");
      }
    }, 100);
  }

  const handlePinSubmit = useCallback(
    async (nextPin: string) => {
      if (!selectedStaffId || nextPin.length !== PIN_LENGTH) return;
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
          setUnlockError(data.error || "Wrong PIN");
          setWrongCount((n) => n + 1);
          haptic([40, 50, 40]);
          return;
        }
        setPin("");
        haptic(12);
        await loadSession();
      } catch {
        setPin("");
        setUnlockError("No connection. Try again.");
      } finally {
        setUnlocking(false);
      }
    },
    [selectedStaffId, loadSession]
  );

  const pressKey = useCallback(
    (key: string) => {
      if (unlocking) return;
      setUnlockError("");
      const result = applyPinKey(pin, key);
      setPin(result.pin);
      if (result.submit) handlePinSubmit(result.pin);
    },
    [pin, unlocking, handlePinSubmit]
  );

  // Keyboard digits work on the shared warehouse PC too.
  useEffect(() => {
    if (unlocked || checkingSession) return;
    const onKey = (e: KeyboardEvent) => {
      const key = keyFromKeyboard(e.key);
      if (key) pressKey(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, checkingSession, pressKey]);

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

      const res = await fetch("/api/scan/confirm", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setLookupError(data.error || "Couldn't save. Try again.");
        return;
      }

      playBeep("ok");
      haptic(18);
      setSaved({
        id: Date.now(),
        text: [matchedParcel.itemSummary, matchedParcel.variationName].filter(Boolean).join(" · "),
      });
      setMatchedParcel(null);
      setManualCode("");
      setNotes("");
      setPhotos([]);
      setTodayCount((n) => n + 1);
      // Counts refresh in the background; the scanner is ready right away.
      loadSession();
    } catch {
      setLookupError("No connection. Try again.");
    } finally {
      setSavingScan(false);
    }
  }

  async function handleLockStaff() {
    await stopCamera();
    await fetch("/api/auth/logout", { method: "POST" });
    setUnlocked(false);
    setMatchedParcel(null);
    setSaved(null);
    await loadSession();
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ground p-6">
        <div className="h-72 w-full max-w-sm animate-pulse rounded-[var(--radius-sheet)] bg-slate-200/60" />
      </div>
    );
  }

  // ── Locked: name, then PIN ────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="safe-top flex min-h-dvh flex-col bg-ground px-6">
        <div className="anim-page-in mx-auto flex w-full max-w-sm flex-1 flex-col py-6">
          <div className="flex h-12 items-center justify-between">
            <span />
            <Link href="/login" className="text-[16px] font-semibold text-brand">
              Owner
            </Link>
          </div>
          <h1 className="mt-2 text-[34px] font-extrabold leading-tight tracking-[-0.025em] text-ink">
            Who&apos;s scanning?
          </h1>

          <div role="radiogroup" aria-label="Staff name" className="mt-6 grid grid-cols-3 gap-2">
            {staffList.map((s) => {
              const active = selectedStaffId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSelectedStaffId(s.id);
                    setPin("");
                    setUnlockError("");
                  }}
                  className={`pressable h-12 truncate rounded-[var(--radius-control)] px-2 text-[16px] font-semibold ${
                    active ? "bg-ink text-white" : "bg-white text-ink shadow-[var(--shadow-card)]"
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>

          <div className="mt-10 flex flex-col items-center">
            <div
              key={wrongCount}
              role="status"
              aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}
              className={`flex gap-5 ${wrongCount > 0 ? "anim-shake" : ""}`}
            >
              {Array.from({ length: PIN_LENGTH }, (_, i) =>
                i < pin.length ? (
                  <span key={`f${i}`} className="anim-pop h-3.5 w-3.5 rounded-full bg-ink" />
                ) : (
                  <span key={`e${i}`} className="h-3.5 w-3.5 rounded-full border-2 border-hairline-strong" />
                )
              )}
            </div>
            <p
              aria-live="assertive"
              className={`mt-4 h-5 text-[15px] font-semibold text-missing-ink transition-opacity duration-150 ${
                unlockError ? "opacity-100" : "opacity-0"
              }`}
            >
              {unlockError || " "}
            </p>
          </div>

          <div className="mx-auto mt-4 grid w-full max-w-[288px] grid-cols-3 gap-y-4">
            {KEYS.map((k) =>
              k === "clear" ? (
                <button
                  key={k}
                  type="button"
                  onClick={() => pressKey("clear")}
                  className="pressable mx-auto h-[72px] w-[72px] rounded-full text-[16px] font-semibold text-ink-2 active:bg-black/[0.05]"
                >
                  Clear
                </button>
              ) : k === "back" ? (
                <button
                  key={k}
                  type="button"
                  aria-label="Delete last digit"
                  onClick={() => pressKey("back")}
                  className="pressable mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full text-ink-2 active:bg-black/[0.05]"
                >
                  <Delete className="h-6 w-6" />
                </button>
              ) : (
                <button
                  key={k}
                  type="button"
                  disabled={unlocking}
                  onClick={() => pressKey(k)}
                  className="pressable tabular-nums mx-auto h-[72px] w-[72px] rounded-full bg-white text-[28px] font-semibold text-ink shadow-[var(--shadow-card)] active:bg-slate-100"
                >
                  {k}
                </button>
              )
            )}
          </div>

          {demo && (
            <p className="mt-6 text-center text-[13px] text-ink-3">
              Dev PINs: Ana 1111 · Joy 2222 · Mark 3333 · Lisa 4444
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Unlocked: scan → check → confirm ─────────────────────────────
  const condition = findCondition(selectedCondition);

  return (
    <div className="min-h-dvh bg-ground pb-12">
      <header className="safe-top sticky top-0 z-30 border-b border-hairline bg-white/85 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-3 px-5">
          <button
            type="button"
            onClick={() => setRecentOpen(true)}
            className="pressable -ml-2 flex min-w-0 flex-col items-start rounded-[10px] px-2 py-1 text-left hover:bg-black/[0.03]"
          >
            <span className="truncate text-[17px] font-bold leading-tight text-ink">{actorName}</span>
            <span className="tabular-nums text-[13px] font-medium text-ink-3">{todayCount} scanned today ›</span>
          </button>
          <div className="flex items-center gap-1">
            {isOwnerActor && (
              <Link href="/" className="pressable rounded-full px-3 py-2 text-[15px] font-semibold text-brand">
                Dashboard
              </Link>
            )}
            <Link
              href="/stock-in"
              aria-label="Add new stock from a supplier"
              title="New stock"
              className="pressable flex h-11 items-center gap-1 rounded-full px-3 text-[15px] font-bold text-brand hover:bg-brand-soft"
            >
              <PackagePlus className="h-5 w-5" />
              <span>New stock</span>
            </Link>
            <button
              type="button"
              onClick={handleLockStaff}
              aria-label="Lock scanner"
              title="Lock scanner"
              className="pressable flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.04]"
            >
              <Lock className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="anim-page-in mx-auto max-w-md space-y-5 px-5 pt-5">
        {saved && (
          <div
            key={saved.id}
            role="status"
            className="anim-rise-in flex items-center gap-3 rounded-[var(--radius-card)] bg-arrived px-4 py-3.5 text-white shadow-[0_8px_24px_-10px_rgb(4_120_87/0.6)]"
          >
            <CheckDraw />
            <span className="min-w-0">
              <span className="block text-[17px] font-bold leading-tight">Saved</span>
              <span className="block truncate text-[15px] text-white/85">{saved.text}</span>
            </span>
          </div>
        )}

        {!matchedParcel && (
          <section className="space-y-4">
            {cameraOpen ? (
              <div className="anim-fade-in relative overflow-hidden rounded-[var(--radius-sheet)] bg-slate-950">
                <div id="kyna-barcode-reader" className="min-h-64 w-full" />
                <button
                  type="button"
                  onClick={stopCamera}
                  aria-label="Close camera"
                  className="pressable absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startCamera}
                className="pressable flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-sheet)] bg-brand text-white shadow-[0_12px_30px_-12px_rgb(15_118_110/0.7)] hover:bg-brand-hover"
              >
                <ScanBarcode className="h-12 w-12" strokeWidth={1.6} />
                <span className="text-[20px] font-bold">Scan waybill</span>
              </button>
            )}

            {cameraError && (
              <p className="anim-fade-in px-1 text-[15px] font-semibold text-amber-800">{cameraError}</p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookupBarcode(manualCode);
              }}
              className="flex gap-2"
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Tracking number</span>
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  enterKeyHint="search"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Or type tracking number"
                  className="h-12 w-full rounded-[var(--radius-control)] bg-white px-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
                />
              </label>
              <Button
                type="submit"
                variant="secondary"
                disabled={lookingUp || manualCode.trim().length < 4}
                className="shrink-0 bg-ink text-white hover:bg-ink/90 disabled:bg-slate-200"
              >
                {lookingUp ? "…" : "Find"}
              </Button>
            </form>

            {lookupError && (
              <p role="alert" className="anim-fade-in px-1 text-[15px] font-semibold text-missing-ink">
                {lookupError}
              </p>
            )}

            {choices.length > 0 && (
              <div className="anim-rise-in space-y-2" role="group" aria-label="Pick the parcel in your hand">
                <p className="px-1 text-[15px] font-semibold text-ink-2">
                  {choices.length} parcels match {lastScannedCode}. Tap the one in your hand.
                </p>
                <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)]">
                  {choices.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openParcel(c)}
                        className="pressable flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                      >
                        <ItemThumb src={c.itemImageUrl} alt={c.itemSummary} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[16px] font-semibold text-ink">
                            {c.quantity}× {c.itemSummary}
                          </span>
                          <span className="block truncate text-[14px] text-ink-3">
                            {[categoryLabel(c.category), c.variationName, shortCourier(c.courier)]
                              .filter(Boolean)
                              .join(" · ")}
                            {c.alreadyScanned ? " · already scanned" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pendingMissing > 0 && (
              <p className="px-1 text-[15px] text-ink-3">
                <span className="tabular-nums font-semibold text-missing-ink">{pendingMissing}</span> sent back,
                still to scan
              </p>
            )}
          </section>
        )}

        {matchedParcel && (
          <section className="anim-rise-in space-y-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-semibold text-ink-2">
                {categoryLabel(matchedParcel.category)} · {shortCourier(matchedParcel.courier)}
              </span>
              <button
                type="button"
                onClick={() => setMatchedParcel(null)}
                aria-label="Cancel this scan"
                className="pressable -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-black/[0.04]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200/70">
                  <X className="h-4 w-4" strokeWidth={2.6} />
                </span>
              </button>
            </div>

            {matchedParcel.alreadyScanned && (
              <p className="flex items-center gap-2 text-[15px] font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Scanned before. Saving logs a re-check.
              </p>
            )}

            {/* What should be inside */}
            <div className="flex items-center gap-4">
              <ItemThumb src={matchedParcel.itemImageUrl} alt={matchedParcel.itemSummary} size="xl" />
              <div className="min-w-0 flex-1">
                <p className="text-[20px] font-bold leading-snug text-ink">
                  <span className="tabular-nums">{matchedParcel.quantity}× </span>
                  {matchedParcel.itemSummary}
                </p>
                {matchedParcel.variationName && (
                  <p className="mt-2 inline-block rounded-lg bg-ink px-2.5 py-1 text-[15px] font-bold text-white">
                    {matchedParcel.variationName}
                  </p>
                )}
              </div>
            </div>

            <div role="radiogroup" aria-label="Condition" className="space-y-2">
              {CONDITIONS.map((c) => {
                const active = selectedCondition === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedCondition(c.id)}
                    className={`pressable flex min-h-14 w-full items-center gap-3.5 rounded-[var(--radius-control)] px-4 text-left ${
                      active ? TONE_SELECTED[c.tone] : "bg-white shadow-[var(--shadow-card)]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
                        active ? TONE_DOT[c.tone] : "border-hairline-strong bg-white"
                      }`}
                    >
                      {active && <span className="anim-pop h-2 w-2 rounded-full bg-white" />}
                    </span>
                    <span className="flex-1 text-[17px] font-semibold text-ink">{c.label}</span>
                    {c.needsPhoto && (
                      <Camera className="h-5 w-5 text-ink-3" aria-label="Photo needed" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2">
              <label
                className={`pressable flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] text-[16px] font-bold ${
                  photos.length > 0
                    ? "bg-arrived-soft text-arrived"
                    : condition?.needsPhoto
                      ? "bg-ink text-white"
                      : "bg-slate-200/70 text-ink"
                }`}
              >
                <Camera className="h-5 w-5" />
                {photos.length > 0
                  ? `${photos.length} photo${photos.length > 1 ? "s" : ""} added`
                  : condition?.needsPhoto
                    ? "Take a photo"
                    : "Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 3))}
                />
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Note (optional)"
                aria-label="Note"
                className="h-12 w-full rounded-[var(--radius-control)] bg-white px-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
              />
            </div>

            {lookupError && (
              <p role="alert" className="px-1 text-[15px] font-semibold text-missing-ink">
                {lookupError}
              </p>
            )}

            <Button size="lg" full onClick={handleConfirmScan} disabled={savingScan}>
              {savingScan ? "Saving…" : "Confirm arrived"}
            </Button>
          </section>
        )}
      </main>

      <Sheet open={recentOpen} onClose={() => setRecentOpen(false)} title="Your scans today">
        {recentScans.length === 0 ? (
          <p className="py-6 text-[16px] text-ink-3">Nothing scanned yet</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {recentScans.map((s) => {
              const good = !findCondition(s.condition)?.needsPhoto;
              return (
                <li key={s.id} className="flex items-center gap-3.5 py-3">
                  <ItemThumb src={s.parcel.itemImageUrl} alt={s.parcel.itemSummary} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold text-ink">{s.parcel.itemSummary}</span>
                    <span className="tabular-nums block truncate text-[14px] text-ink-3">{s.scannedBarcode}</span>
                  </span>
                  <span className={`text-[15px] font-semibold ${good ? "text-arrived" : "text-missing"}`}>
                    {good ? "Good" : "Issue"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
