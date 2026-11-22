"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Delete,
  Lock,
  OctagonAlert,
  Printer,
  ScanBarcode,
  Search,
  X,
} from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PullIndicator } from "@/components/ui/PullToRefresh";
import { Sheet } from "@/components/ui/Sheet";
import { Toaster, toast } from "@/components/ui/Toast";
import type { StaffSafeOutboundPackage, StaffSafeParcel } from "@/lib/auth";
import { CONDITIONS, DEFAULT_CONDITION, findCondition, type ConditionTone } from "@/lib/ui/conditions";
import { compressImageFile } from "@/lib/ui/compress-image";
import { shortCourier } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/motion";
import { categoryLabel } from "@/lib/ui/parcel-status";
import { PIN_LENGTH, applyPinKey, keyFromKeyboard } from "@/lib/ui/pin";
import { usePullToRefresh } from "@/lib/ui/use-pull-to-refresh";
import { PickListSection, type StaffWaveData } from "./PickListSection";

export interface StaffOption {
  id: string;
  name: string;
}

export interface RecentScanItem {
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
    quantity?: number;
    itemImageUrl: string | null;
  };
}

export interface ScanInitialState {
  unlocked: boolean;
  actorName: string;
  isOwnerActor: boolean;
  todayCount: number;
  cancelledToPullCount: number;
  unpickedOverdueCount: number;
  pendingMissing: number;
  recentScans: RecentScanItem[];
  staffList: StaffOption[];
}

type PackerTab = "pick" | "returns";

const PACKER_TABS: readonly { id: PackerTab; label: string }[] = [
  { id: "pick", label: "Pick list" },
  { id: "returns", label: "Returns" },
];

const TONE_SELECTED_ROW: Record<ConditionTone, string> = {
  good: "bg-arrived-soft/75",
  neutral: "bg-surface-muted",
  warn: "bg-failed-soft/75",
  bad: "bg-missing-soft/80",
};

const TONE_DOT: Record<ConditionTone, string> = {
  good: "border-arrived-solid bg-arrived-solid",
  neutral: "border-slate-600 bg-slate-600",
  warn: "border-amber-600 bg-amber-600",
  bad: "border-missing-solid bg-missing-solid",
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
}

const NATIVE_BARCODE_FORMATS = ["code_128", "code_39", "qr_code", "ean_13", "itf"];

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedAudioCtx && sharedAudioCtx.state !== "closed") return sharedAudioCtx;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  sharedAudioCtx = new AudioCtx();
  return sharedAudioCtx;
}

function playBeep(kind: "ok" | "warn" | "error") {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
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

function last6(trackingNumber: string | null, orderSn: string): string {
  const raw = (trackingNumber?.trim() || orderSn.trim()).toUpperCase();
  return raw.length > 6 ? raw.slice(-6) : raw;
}

function CheckDraw() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
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

export function ScanClient({ initial }: { initial: ScanInitialState }) {
  // Dev-only hints. Next swaps NODE_ENV for a literal, so production builds drop them entirely.
  const demo = process.env.NODE_ENV === "development";
  const [unlocked, setUnlocked] = useState(initial.unlocked);
  const [actorName, setActorName] = useState(initial.actorName);
  const [isOwnerActor, setIsOwnerActor] = useState(initial.isOwnerActor);
  const [todayCount, setTodayCount] = useState(initial.todayCount);
  const [cancelledToPullCount, setCancelledToPullCount] = useState(initial.cancelledToPullCount);
  const [unpickedOverdueCount, setUnpickedOverdueCount] = useState(initial.unpickedOverdueCount);
  const [pendingMissing, setPendingMissing] = useState(initial.pendingMissing);
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>(initial.recentScans);
  const [recentOpen, setRecentOpen] = useState(false);
  const [copiedList, setCopiedList] = useState(false);

  const [tab, setTab] = useState<PackerTab>("returns");
  const [scrolled, setScrolled] = useState(false);

  const [staffList, setStaffList] = useState<StaffOption[]>(initial.staffList);
  const [selectedStaffId, setSelectedStaffId] = useState(initial.staffList[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [wrongCount, setWrongCount] = useState(0);
  const [unlocking, setUnlocking] = useState(false);

  // Returns scanner state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [nativeCamera, setNativeCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lastScannedCode, setLastScannedCode] = useState("");
  const [matchedParcel, setMatchedParcel] = useState<StaffSafeParcel | null>(null);
  const [choices, setChoices] = useState<StaffSafeParcel[]>([]);
  const [selectedCondition, setSelectedCondition] = useState<string>(DEFAULT_CONDITION);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [savingScan, setSavingScan] = useState(false);
  const [saved, setSaved] = useState<{ id: number; text: string; restocked: boolean } | null>(null);

  // Wave Pick list & zero-friction alert sheets
  const [waveData, setWaveData] = useState<StaffWaveData | null>(null);
  const [cancelledToPull, setCancelledToPull] = useState<StaffSafeOutboundPackage[]>([]);
  const [unpickedParcels, setUnpickedParcels] = useState<StaffSafeOutboundPackage[]>([]);
  const [waveLoading, setWaveLoading] = useState(false);
  const [waveError, setWaveError] = useState("");
  const [checkedPickKeys, setCheckedPickKeys] = useState<Record<string, boolean>>({});
  const [pullSheetOpen, setPullSheetOpen] = useState(false);
  const [unpickedSheetOpen, setUnpickedSheetOpen] = useState(false);
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [reprintingSn, setReprintingSn] = useState<string | null>(null);

  // Optional Check / Reprint sheet (for torn/jammed labels or tricky multi-item lookup)
  const [checkSheetOpen, setCheckSheetOpen] = useState(false);
  const [checkQuery, setCheckQuery] = useState("");
  const [checkSearching, setCheckSearching] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkResults, setCheckResults] = useState<StaffSafeOutboundPackage[]>([]);

  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectBusyRef = useRef(false);
  const lookupInFlightRef = useRef(false);

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/scan/session");
    const data = await res.json();
    if (data.unlocked) {
      setUnlocked(true);
      setActorName(data.actor?.name || "Staff");
      setIsOwnerActor(data.actor?.actorType === "owner");
      setTodayCount(data.todayCount ?? 0);
      setCancelledToPullCount(data.cancelledToPullCount ?? 0);
      setUnpickedOverdueCount(data.unpickedOverdueCount ?? 0);
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
  }, []);

  const loadWave = useCallback(async () => {
    setWaveLoading(true);
    setWaveError("");
    try {
      const res = await fetch("/api/scan/wave");
      const data = await res.json();
      if (!res.ok) {
        setWaveError(data.error || "Couldn't load pick list.");
        return;
      }
      setWaveData(data.wave ?? null);
      const nextCancelled: StaffSafeOutboundPackage[] = data.cancelledToPull ?? [];
      const nextUnpicked: StaffSafeOutboundPackage[] = data.unpickedParcels ?? [];
      setCancelledToPull(nextCancelled);
      setUnpickedParcels(nextUnpicked);
      setCancelledToPullCount(nextCancelled.length);
      setUnpickedOverdueCount(nextUnpicked.length);
      if (data.wave?.id && typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(`kyna_pick_checked_${data.wave.id}`);
          setCheckedPickKeys(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
        } catch {
          setCheckedPickKeys({});
        }
      }
    } catch {
      setWaveError("No connection. Try again.");
    } finally {
      setWaveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (unlocked && (tab === "pick" || pullSheetOpen || unpickedSheetOpen)) {
      void loadWave();
    }
  }, [unlocked, tab, pullSheetOpen, unpickedSheetOpen, loadWave]);

  // Pull down to refresh the pick list and today's counts. Off while the camera runs.
  const pull = usePullToRefresh(
    unlocked ? () => Promise.all([loadSession(), loadWave()]) : undefined,
    !cameraOpen
  );

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 3200);
    return () => clearTimeout(t);
  }, [saved]);

  useEffect(() => {
    if (!unlocked) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [unlocked]);

  const stopCamera = useCallback(async () => {
    if (detectTimerRef.current) {
      clearInterval(detectTimerRef.current);
      detectTimerRef.current = null;
    }
    detectBusyRef.current = false;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
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

  const lookupReturnBarcode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || lookupInFlightRef.current) return;
      lookupInFlightRef.current = true;
      setLookupError("");
      setLookingUp(true);
      try {
        await stopCamera();
        const res = await fetch(
          `/api/scan/lookup?mode=return&code=${encodeURIComponent(code)}`
        );
        const data = await res.json();
        setChoices([]);
        if (!res.ok || !data.found) {
          playBeep("error");
          haptic([30, 40, 30]);
          setMatchedParcel(null);
          setLookupError(data.error || `No return found for ${code}. Try the last 6 digits.`);
          return;
        }
        setLastScannedCode(code);
        if (Array.isArray(data.matches)) {
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
        lookupInFlightRef.current = false;
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

    const hasNativeDetector = typeof window !== "undefined" && "BarcodeDetector" in window;
    setNativeCamera(hasNativeDetector);
    setCameraOpen(true);

    setTimeout(async () => {
      try {
        if (hasNativeDetector) {
          const DetectorCtor = (
            window as unknown as { BarcodeDetector: NativeBarcodeDetectorCtor }
          ).BarcodeDetector;
          const detector = new DetectorCtor({ formats: NATIVE_BARCODE_FORMATS });
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
          streamRef.current = stream;
          const video = videoRef.current;
          if (!video) {
            await stopCamera();
            return;
          }
          video.srcObject = stream;
          await video.play();

          detectTimerRef.current = setInterval(async () => {
            if (detectBusyRef.current || lookupInFlightRef.current) return;
            const el = videoRef.current;
            if (!el || el.readyState < 2) return;
            detectBusyRef.current = true;
            try {
              const barcodes = await detector.detect(el);
              const raw = barcodes.find((b) => b.rawValue)?.rawValue;
              if (raw) {
                void lookupReturnBarcode(raw);
              }
            } catch {
              // Ignore transient frame decode errors
            } finally {
              detectBusyRef.current = false;
            }
          }, 120);
          return;
        }

        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        const qr = new Html5Qrcode("kyna-barcode-reader", {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.ITF,
          ],
          verbose: false,
        });
        scannerRef.current = qr;
        await qr.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (decodedText) => {
            void lookupReturnBarcode(decodedText);
          },
          () => {}
        );
      } catch {
        await stopCamera();
        setCameraError("Camera didn't open. Type the tracking number instead.");
      }
    }, 80);
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

  useEffect(() => {
    if (unlocked) return;
    const onKey = (e: KeyboardEvent) => {
      const key = keyFromKeyboard(e.key);
      if (key) pressKey(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, pressKey]);

  async function handleMarkCancelledPulled(pkg: StaffSafeOutboundPackage) {
    setPullingId(pkg.packageId);
    try {
      const res = await fetch("/api/scan/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_cancelled_pulled", packageId: pkg.packageId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Couldn't mark pulled.", "error");
        return;
      }
      playBeep("ok");
      haptic(14);
      setCancelledToPull((prev) => prev.filter((p) => p.packageId !== pkg.packageId));
      if (typeof data.cancelledToPullCount === "number") {
        setCancelledToPullCount(data.cancelledToPullCount);
      } else {
        setCancelledToPullCount((n) => Math.max(0, n - 1));
      }
      toast(`Pulled cancelled parcel ···${last6(pkg.trackingNumber, pkg.orderSn)}`);
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setPullingId(null);
    }
  }

  async function handleReprintLabel(orderSn: string) {
    setReprintingSn(orderSn);
    try {
      const res = await fetch("/api/scan/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reprint_label", orderSn }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Couldn't queue reprint.", "error");
        return;
      }
      haptic(12);
      toast(`Sent ${data.orderSn} to printer`);
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setReprintingSn(null);
    }
  }

  async function handleCheckSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = checkQuery.trim();
    if (q.length < 3) return;
    setCheckSearching(true);
    setCheckError("");
    setCheckResults([]);
    try {
      const res = await fetch(
        `/api/scan/lookup?mode=outbound&autoPack=0&code=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      if (!res.ok || !data.found) {
        setCheckError(data.error || `No parcel found for "${q}".`);
        return;
      }
      if (Array.isArray(data.outboundMatches)) {
        setCheckResults(data.outboundMatches);
      } else if (data.outbound) {
        setCheckResults([data.outbound]);
      }
    } catch {
      setCheckError("No connection. Try again.");
    } finally {
      setCheckSearching(false);
    }
  }

  function togglePickChecked(key: string) {
    if (!waveData) return;
    haptic(8);
    setCheckedPickKeys((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next[key]) delete next[key];
      try {
        window.localStorage.setItem(`kyna_pick_checked_${waveData.id}`, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }

  async function handleConfirmScan() {
    if (!matchedParcel) return;
    setSavingScan(true);
    setLookupError("");
    try {
      const compressedPhotos = await Promise.all(photos.map(compressImageFile));
      const formData = new FormData();
      formData.append("parcelId", matchedParcel.id);
      formData.append("scannedBarcode", lastScannedCode);
      formData.append("condition", selectedCondition);
      if (notes.trim()) formData.append("notes", notes.trim());
      for (const file of compressedPhotos) {
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
        restocked: Boolean(data.restocked),
      });
      setMatchedParcel(null);
      setManualCode("");
      setNotes("");
      setPhotos([]);
      setTodayCount((n) => n + 1);
      if (typeof data.pendingMissingCount === "number") {
        setPendingMissing(data.pendingMissingCount);
      }
      if (data.recentScan) {
        setRecentScans((prev) => [data.recentScan as RecentScanItem, ...prev]);
      }
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

  function handleTabChange(next: PackerTab) {
    void stopCamera();
    setTab(next);
    setLookupError("");
    setCameraError("");
    setManualCode("");
    setMatchedParcel(null);
    setChoices([]);
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
                    active ? "bg-ink text-ink-inverse" : "bg-surface text-ink shadow-[var(--shadow-card)]"
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
                  className="pressable mx-auto h-[72px] w-[72px] rounded-full text-[16px] font-semibold text-ink-2 active:bg-ink/[0.06]"
                >
                  Clear
                </button>
              ) : k === "back" ? (
                <button
                  key={k}
                  type="button"
                  aria-label="Delete last digit"
                  onClick={() => pressKey("back")}
                  className="pressable mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full text-ink-2 active:bg-ink/[0.06]"
                >
                  <Delete className="h-6 w-6" />
                </button>
              ) : (
                <button
                  key={k}
                  type="button"
                  disabled={unlocking}
                  onClick={() => pressKey(k)}
                  className="pressable tabular-nums mx-auto h-[72px] w-[72px] rounded-full bg-surface text-[28px] font-semibold text-ink shadow-[var(--shadow-card)] active:bg-surface-muted"
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

  // ── Unlocked: Calm Apple-HIG Packer Station (Pick list & Returns) ──
  const condition = findCondition(selectedCondition);
  const needsPhotoMissing = Boolean(condition?.needsPhoto && photos.length === 0);

  function openCheckSheet() {
    setCheckQuery("");
    setCheckError("");
    setCheckResults([]);
    setCheckSheetOpen(true);
  }

  return (
    <div className="min-h-dvh bg-ground pb-14">
      <header
        className={`safe-top sticky top-0 z-30 transition-[background-color,border-color,backdrop-filter] duration-200 ${
          scrolled
            ? "border-b border-hairline bg-surface/80 backdrop-blur-xl backdrop-saturate-150"
            : "border-b border-transparent bg-ground"
        }`}
      >
        <div className="relative mx-auto flex h-12 max-w-md items-center justify-between gap-2 px-5">
          {isOwnerActor ? (
            <Link
              href="/"
              className="pressable -ml-2 flex h-11 items-center gap-0.5 whitespace-nowrap rounded-full px-2 text-[16px] font-semibold text-brand hover:bg-ink/[0.05]"
            >
              <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2.4} />
              <span>Dashboard</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setRecentOpen(true)}
              className="pressable -ml-2 flex h-11 min-w-0 items-center rounded-full px-2 text-left text-[16px] font-bold text-ink hover:bg-ink/[0.05]"
            >
              <span className="truncate">{actorName}</span>
            </button>
          )}

          <p
            aria-hidden={!scrolled}
            className={`pointer-events-none absolute left-28 right-28 truncate text-center text-[16px] font-bold text-ink transition-[opacity,translate] duration-200 ease-[var(--ease-ios)] ${
              scrolled ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            {tab === "pick" ? "Pick list" : "Returns"}
          </p>

          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/stock-in"
              aria-label="Shelf and stock updates"
              title="Shelf & stock"
              className="pressable flex h-11 items-center whitespace-nowrap rounded-full px-2.5 text-[16px] font-semibold text-brand hover:bg-ink/[0.05]"
            >
              Stock
            </Link>
            <button
              type="button"
              onClick={handleLockStaff}
              aria-label="Lock scanner"
              title="Lock scanner"
              className="pressable -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-ink/[0.05]"
            >
              <Lock className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <PullIndicator {...pull} sidebar={false} />

      <main className="anim-page-in mx-auto max-w-md space-y-5 px-5 pt-2">
        {/* Zero-friction automatic alert banners (only shown when action is needed) */}
        {cancelledToPullCount > 0 && (
          <button
            type="button"
            onClick={() => setPullSheetOpen(true)}
            className="group anim-rise-in pressable flex w-full items-center gap-3 rounded-[var(--radius-card)] bg-missing-solid px-4 py-3.5 text-left text-white shadow-[0_8px_24px_-10px_rgb(220_38_38/0.65)] dark:shadow-[var(--shadow-card)]"
          >
            <OctagonAlert className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-extrabold leading-tight">
                STOP — Pull {cancelledToPullCount} cancelled{" "}
                {cancelledToPullCount === 1 ? "label" : "labels"}
              </span>
              <span className="mt-0.5 block text-[14px] font-medium text-white/90">
                Cancelled after printing. Tap to check tracking &amp; photo
              </span>
            </span>
            <ChevronRight className="chevron-nudge h-5 w-5 shrink-0 text-white/80" />
          </button>
        )}

        {unpickedOverdueCount > 0 && (
          <button
            type="button"
            onClick={() => setUnpickedSheetOpen(true)}
            className="group anim-rise-in pressable flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-failed-soft px-4 py-3 text-left text-failed-ink"
          >
            <Clock className="h-5 w-5 shrink-0 text-failed" />
            <span className="min-w-0 flex-1 text-[14px] font-bold tabular-nums">
              {unpickedOverdueCount} printed {unpickedOverdueCount === 1 ? "parcel" : "parcels"} not picked up yet (3h+)
            </span>
            <ChevronRight className="chevron-nudge h-5 w-5 shrink-0 text-failed-ink" />
          </button>
        )}

        <SegmentedControl
          options={PACKER_TABS}
          value={tab}
          onChange={handleTabChange}
          label="Packer mode"
        />

        {saved && (
          <div
            key={saved.id}
            role="status"
            className={`anim-rise-in flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-3.5 text-white ${
              saved.restocked
                ? "bg-arrived-solid shadow-[0_8px_24px_-10px_rgb(4_120_87/0.6)] dark:shadow-[var(--shadow-card)]"
                : "bg-missing-solid shadow-[0_8px_24px_-10px_rgb(220_38_38/0.6)] dark:shadow-[var(--shadow-card)]"
            }`}
          >
            <CheckDraw />
            <span className="min-w-0">
              <span className="block text-[16px] font-bold leading-tight">
                {saved.restocked
                  ? "Saved · Put back on shelf"
                  : "Saved · Put in dispute bin"}
              </span>
              <span className="block truncate text-[14px] text-white/90">{saved.text}</span>
            </span>
          </div>
        )}

        <div key={tab} className="anim-fade-in">
          {/* ── TAB 1: PICK LIST + MULTI-ITEM CHECK ────────────────────────── */}
          {tab === "pick" && (
            <PickListSection
              waveData={waveData}
              waveLoading={waveLoading}
              waveError={waveError}
              checkedPickKeys={checkedPickKeys}
              reprintingSn={reprintingSn}
              onToggleChecked={togglePickChecked}
              onRefresh={() => void loadWave()}
              onOpenCheckSheet={openCheckSheet}
              onReprintLabel={handleReprintLabel}
            />
          )}

          {/* ── TAB 2: INBOUND RETURN SCANNER ──────────────────────────────── */}
          {tab === "returns" && !matchedParcel && (
            <section className="space-y-4">
              {cameraOpen ? (
                <div className="anim-fade-in relative overflow-hidden rounded-[var(--radius-sheet)] bg-slate-950">
                  {nativeCamera ? (
                    <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
                  ) : (
                    <div id="kyna-barcode-reader" className="min-h-64 w-full" />
                  )}
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
                  className="pressable flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-sheet)] bg-brand-solid text-on-brand shadow-[0_12px_30px_-12px_rgb(219_112_155/0.55)] hover:bg-brand-solid-hover dark:shadow-[var(--shadow-card)]"
                >
                  <ScanBarcode className="h-12 w-12" strokeWidth={1.6} />
                  <span className="text-[20px] font-bold">Scan return waybill</span>
                </button>
              )}

              {cameraError && (
                <p className="anim-fade-in px-1 text-[15px] font-semibold text-failed-ink">{cameraError}</p>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void lookupReturnBarcode(manualCode);
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
                    placeholder="Or type return tracking number"
                    className="h-12 w-full rounded-[var(--radius-control)] bg-surface px-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
                  />
                </label>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={lookingUp || manualCode.trim().length < 4}
                  className="shrink-0 bg-ink text-ink-inverse hover:bg-ink/90 disabled:bg-surface-track disabled:text-ink-3"
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
                  <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
                    {choices.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => openParcel(c)}
                          className="pressable-row flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
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

              <Group className="divide-y divide-hairline">
                <button
                  type="button"
                  onClick={() => setRecentOpen(true)}
                  className="group pressable-row flex min-h-[54px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
                >
                  <span className="text-[16px] font-semibold text-ink">Your returns today</span>
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink-3 tabular-nums">
                    <span>{todayCount}</span>
                    <ChevronRight className="chevron-nudge h-5 w-5 text-hairline-strong" />
                  </span>
                </button>

                {pendingMissing > 0 && (
                  <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-3">
                    <span className="text-[16px] font-semibold text-ink">Returned to seller, waiting to scan</span>
                    <span className="text-[15px] font-bold text-missing-ink tabular-nums">
                      {pendingMissing}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={openCheckSheet}
                  className="group pressable-row flex min-h-[54px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
                >
                  <span className="flex items-center gap-2.5 text-[16px] font-semibold text-ink">
                    <Printer className="h-5 w-5 text-brand" />
                    <span>Find or reprint a label</span>
                  </span>
                  <ChevronRight className="chevron-nudge h-5 w-5 text-hairline-strong" />
                </button>
              </Group>
            </section>
          )}

          {tab === "returns" && matchedParcel && (
            <section className="anim-rise-in space-y-6">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold text-ink-2">
                  {categoryLabel(matchedParcel.category)} · {shortCourier(matchedParcel.courier)}
                </span>
                <button
                  type="button"
                  onClick={() => setMatchedParcel(null)}
                  aria-label="Cancel this scan"
                  className="pressable -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-ink/[0.05]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-track/80">
                    <X className="h-4 w-4" strokeWidth={2.6} />
                  </span>
                </button>
              </div>

              {matchedParcel.alreadyScanned && (
                <p className="flex items-center gap-2 text-[15px] font-semibold text-failed-ink">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Scanned before. Saving logs a re-check.
                </p>
              )}

              {matchedParcel.lines.length > 1 ? (
                <Group>
                  <ul className="divide-y divide-hairline px-4">
                    {matchedParcel.lines.map((line, idx) => (
                      <li key={`${line.name}-${idx}`} className="flex items-center gap-3.5 py-3">
                        <ItemThumb src={line.imageUrl} alt={line.name} size="lg" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[17px] font-bold leading-snug text-ink">
                            <span className="tabular-nums">{line.quantity}× </span>
                            {line.name}
                          </p>
                          {line.variationName && (
                            <p className="mt-1 text-[15px] font-semibold text-ink-2">
                              {line.variationName}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Group>
              ) : (
                <div className="flex items-center gap-4">
                  <ItemThumb src={matchedParcel.itemImageUrl} alt={matchedParcel.itemSummary} size="xl" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[20px] font-bold leading-snug text-ink">
                      <span className="tabular-nums">{matchedParcel.quantity}× </span>
                      {matchedParcel.itemSummary}
                    </p>
                    {matchedParcel.variationName && (
                      <p className="mt-1.5 inline-block rounded-lg bg-surface-track/80 px-2.5 py-1 text-[15px] font-bold text-ink">
                        {matchedParcel.variationName}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Group>
                <div role="radiogroup" aria-label="Condition" className="divide-y divide-hairline">
                  {CONDITIONS.map((c) => {
                    const active = selectedCondition === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelectedCondition(c.id)}
                        className={`pressable flex min-h-14 w-full items-center gap-3.5 px-4 text-left transition-colors ${
                          active ? TONE_SELECTED_ROW[c.tone] : "bg-surface hover:bg-surface-subtle"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
                            active ? TONE_DOT[c.tone] : "border-hairline-strong bg-surface"
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
              </Group>

              <div className="space-y-2">
                <label
                  className={`pressable flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] text-[16px] font-bold ${
                    photos.length > 0
                      ? "bg-arrived-soft text-arrived"
                      : condition?.needsPhoto
                        ? "bg-ink text-ink-inverse"
                        : "bg-surface-muted text-ink"
                  }`}
                >
                  <Camera className="h-5 w-5" />
                  {photos.length > 0
                    ? `${photos.length} photo${photos.length > 1 ? "s" : ""} added`
                    : condition?.needsPhoto
                      ? "Take photo (required for dispute)"
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
                {needsPhotoMissing && (
                  <p className="px-1 text-[14px] font-semibold text-missing-ink">
                    Photo of the waybill &amp; item is required before saving an issue return.
                  </p>
                )}
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Note (optional)"
                  aria-label="Note"
                  className="h-12 w-full rounded-[var(--radius-control)] bg-surface px-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
                />
              </div>

              {lookupError && (
                <p role="alert" className="anim-fade-in px-1 text-[15px] font-semibold text-missing-ink">
                  {lookupError}
                </p>
              )}

              <Button
                size="lg"
                full
                onClick={handleConfirmScan}
                disabled={savingScan || needsPhotoMissing}
              >
                {savingScan
                  ? "Saving…"
                  : needsPhotoMissing
                    ? "Take photo to continue"
                    : "Confirm arrived"}
              </Button>
            </section>
          )}
        </div>
      </main>

      {/* Sheet 1: End-of-shift return list */}
      <Sheet open={recentOpen} onClose={() => setRecentOpen(false)} title="Your returns today">
        {recentScans.length === 0 ? (
          <p className="py-6 text-[16px] text-ink-3">Nothing scanned yet</p>
        ) : (
          <div className="space-y-4">
            {(() => {
              const issueCount = recentScans.filter((s) => Boolean(findCondition(s.condition)?.needsPhoto)).length;
              const goodCount = recentScans.length - issueCount;
              const handleCopyList = async () => {
                const courierCounts = new Map<string, number>();
                for (const s of recentScans) {
                  const c = shortCourier(s.parcel.courier);
                  courierCounts.set(c, (courierCounts.get(c) ?? 0) + 1);
                }
                const byCourier = Array.from(courierCounts.entries())
                  .map(([c, n]) => `${c}: ${n}`)
                  .join(" · ");
                const day = new Intl.DateTimeFormat("en-PH", {
                  timeZone: "Asia/Manila",
                  month: "short",
                  day: "numeric",
                }).format(new Date());
                const lines = [
                  `RETURNS RECEIVED — ${day} (${actorName})`,
                  `Total: ${recentScans.length} (${goodCount} shelf, ${issueCount} dispute)`,
                  ...(byCourier ? [`By courier: ${byCourier}`] : []),
                  ``,
                  ...recentScans.map((s, idx) => {
                    const qty = s.parcel.quantity && s.parcel.quantity > 1 ? `${s.parcel.quantity}x ` : "";
                    const variant = s.parcel.variationName ? ` (${s.parcel.variationName})` : "";
                    const tag = findCondition(s.condition)?.needsPhoto ? "Dispute" : "Shelf";
                    return `${idx + 1}. ${s.scannedBarcode} — ${qty}${s.parcel.itemSummary}${variant} [${tag}]`;
                  }),
                ];
                await navigator.clipboard.writeText(lines.join("\n"));
                setCopiedList(true);
                toast("Return list copied");
                setTimeout(() => setCopiedList(false), 1800);
              };
              return (
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface-muted px-3.5 py-2.5">
                  <span className="text-[14px] font-semibold text-ink-2 tabular-nums">
                    {recentScans.length} {recentScans.length === 1 ? "parcel" : "parcels"} · {goodCount} shelf
                    {issueCount > 0 ? ` · ${issueCount} dispute` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyList}
                    className="pressable inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-bold text-brand shadow-[var(--shadow-card)]"
                  >
                    {copiedList ? (
                      <>
                        <Check className="anim-pop h-3.5 w-3.5" strokeWidth={2.8} />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy list
                      </>
                    )}
                  </button>
                </div>
              );
            })()}
            <ul className="divide-y divide-hairline">
              {recentScans.map((s) => {
                const good = !findCondition(s.condition)?.needsPhoto;
                return (
                  <li key={s.id} className="flex items-center gap-3.5 py-3">
                    <ItemThumb src={s.parcel.itemImageUrl} alt={s.parcel.itemSummary} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold text-ink">
                        {s.parcel.quantity && s.parcel.quantity > 1 ? `${s.parcel.quantity}× ` : ""}
                        {s.parcel.itemSummary}
                      </span>
                      <span className="tabular-nums block truncate text-[14px] text-ink-3">
                        {s.scannedBarcode} · {shortCourier(s.parcel.courier)}
                      </span>
                    </span>
                    <span className={`text-[15px] font-semibold ${good ? "text-arrived" : "text-missing"}`}>
                      {good ? "Shelf" : "Dispute"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Sheet>

      {/* Sheet 2: Pull cancelled labels off the table */}
      <Sheet
        open={pullSheetOpen}
        onClose={() => setPullSheetOpen(false)}
        title="Pull cancelled labels"
      >
        {waveLoading ? (
          <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
        ) : cancelledToPull.length === 0 ? (
          <p className="py-6 text-[16px] text-ink-3">All clear — no cancelled labels to pull.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {cancelledToPull.map((p) => {
              const first = p.lines[0];
              const code6 = last6(p.trackingNumber, p.orderSn);
              return (
                <li key={p.packageId} className="space-y-3 py-4 first:pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-lg bg-missing-solid px-2.5 py-1 text-[18px] font-extrabold tracking-wide text-white tabular-nums">
                      ···{code6}
                    </span>
                    <span className="text-[14px] font-bold text-ink-2">
                      {shortCourier(p.courier)}
                    </span>
                  </div>
                  <p className="tabular-nums text-[13px] text-ink-3">
                    {p.trackingNumber ? `${p.trackingNumber} · ` : ""}Order {p.orderSn}
                  </p>
                  <div className="flex items-center gap-3">
                    <ItemThumb src={first?.imageUrl ?? null} alt={first?.shortName ?? p.orderSn} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold text-ink">
                        {p.totalPieces}× {first?.shortName ?? p.orderSn}
                        {p.lines.length > 1 ? ` +${p.lines.length - 1} more` : ""}
                      </p>
                      {first?.variationName && (
                        <p className="text-[13px] font-semibold text-ink-2">{first.variationName}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    full
                    variant="danger"
                    disabled={pullingId === p.packageId}
                    onClick={() => void handleMarkCancelledPulled(p)}
                  >
                    {pullingId === p.packageId ? "Saving…" : "Pulled off table"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>

      {/* Sheet 3: Printed 3h+ ago, still not picked up by rider */}
      <Sheet
        open={unpickedSheetOpen}
        onClose={() => setUnpickedSheetOpen(false)}
        title="Not picked up yet (3h+)"
      >
        {waveLoading ? (
          <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
        ) : unpickedParcels.length === 0 ? (
          <p className="py-6 text-[16px] text-ink-3">All printed parcels have been picked up!</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] text-ink-3">
              These labels printed 3+ hours ago but the courier hasn&apos;t scanned them yet. Check if a pouch was left behind or if the printer jammed.
            </p>
            <ul className="divide-y divide-hairline">
              {unpickedParcels.map((p) => {
                const first = p.lines[0];
                const code6 = last6(p.trackingNumber, p.orderSn);
                return (
                  <li key={p.packageId} className="space-y-2.5 py-3.5">
                    <div className="flex items-center gap-3">
                      <ItemThumb src={first?.imageUrl ?? null} alt={first?.shortName ?? p.orderSn} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-bold text-ink">
                          <span className="mr-1.5 font-extrabold text-brand tabular-nums">···{code6}</span>
                          {p.totalPieces}× {first?.shortName ?? p.orderSn}
                        </p>
                        <p className="truncate text-[13px] text-ink-3 tabular-nums">
                          {shortCourier(p.courier)} · {p.orderSn}
                        </p>
                      </div>
                    </div>
                    {p.canReprint && (
                      <Button
                        full
                        variant="secondary"
                        disabled={reprintingSn === p.orderSn}
                        onClick={() => void handleReprintLabel(p.orderSn)}
                        className="h-10 text-[14px]"
                      >
                        <Printer className="mr-1.5 h-4 w-4" />
                        {reprintingSn === p.orderSn ? "Sending…" : "Reprint missing label"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Sheet>

      {/* Sheet 4: Optional Check Photo / Reprint torn or jammed label */}
      <Sheet
        open={checkSheetOpen}
        onClose={() => setCheckSheetOpen(false)}
        title="Check item or reprint label"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-ink-3">
            Type the last 6 digits, order number, or garment name to see photos or reprint a torn/jammed sticker.
          </p>
          <form onSubmit={handleCheckSearch} className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search parcel</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input
                value={checkQuery}
                onChange={(e) => setCheckQuery(e.target.value)}
                placeholder="Last 6 digits, order no. or item"
                className="h-12 w-full rounded-[var(--radius-control)] bg-surface-muted pl-9 pr-3 text-[16px] text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
              />
            </label>
            <Button
              type="submit"
              disabled={checkSearching || checkQuery.trim().length < 3}
              className="shrink-0"
            >
              {checkSearching ? "…" : "Find"}
            </Button>
          </form>

          {checkError && <p className="anim-fade-in text-[14px] font-semibold text-missing-ink">{checkError}</p>}

          {checkResults.length > 0 && (
            <ul className="anim-rise-in divide-y divide-hairline">
              {checkResults.map((p) => (
                <li key={p.packageId} className="space-y-3 py-3.5">
                  <div className="flex items-center justify-between gap-2 text-[13px] font-bold text-ink-2 tabular-nums">
                    <span>
                      ···{last6(p.trackingNumber, p.orderSn)} · {shortCourier(p.courier)}
                    </span>
                    {p.isCancelled && (
                      <span className="rounded-full bg-missing-solid px-2 py-0.5 text-[12px] text-white">
                        CANCELLED
                      </span>
                    )}
                  </div>
                  <ul className="space-y-2">
                    {p.lines.map((line) => (
                      <li key={line.id} className="flex items-center gap-3">
                        <ItemThumb src={line.imageUrl} alt={line.shortName} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-bold text-ink">
                            {line.quantity}× {line.shortName}
                          </p>
                          {line.variationName && (
                            <p className="mt-0.5 inline-block rounded bg-ink px-2 py-0.5 text-[12px] font-bold text-ink-inverse">
                              {line.variationName}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!p.isCancelled && p.canReprint && (
                    <Button
                      full
                      variant="secondary"
                      disabled={reprintingSn === p.orderSn}
                      onClick={() => void handleReprintLabel(p.orderSn)}
                      className="h-10 text-[14px]"
                    >
                      <Printer className="mr-1.5 h-4 w-4" />
                      {reprintingSn === p.orderSn ? "Sending…" : "Reprint label"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>

      <Toaster />
    </div>
  );
}
