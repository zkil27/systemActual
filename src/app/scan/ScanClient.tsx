"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  Check,
  Delete,
  Lock,
  OctagonAlert,
  PackageCheck,
  PackagePlus,
  Printer,
  RefreshCw,
  ScanBarcode,
  ShieldAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import type { StaffSafeOutboundPackage, StaffSafeParcel } from "@/lib/auth";
import type { OutboundScanEvaluation } from "@/lib/shipping/outbound";
import { CONDITIONS, DEFAULT_CONDITION, findCondition, type ConditionTone } from "@/lib/ui/conditions";
import { compressImageFile } from "@/lib/ui/compress-image";
import { manilaDateTime, manilaTime, shortCourier } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/motion";
import { categoryLabel } from "@/lib/ui/parcel-status";
import { PIN_LENGTH, applyPinKey, keyFromKeyboard } from "@/lib/ui/pin";
import type { StaffPickGroup } from "@/app/api/scan/wave/route";

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
    itemImageUrl: string | null;
  };
}

export interface ScanInitialState {
  unlocked: boolean;
  actorName: string;
  isOwnerActor: boolean;
  todayCount: number;
  todayPackedCount: number;
  unpackedWaveCount: number;
  pendingMissing: number;
  recentScans: RecentScanItem[];
  staffList: StaffOption[];
}

interface StaffWaveData {
  id: string;
  status: string;
  createdAt: string;
  parcelCount: number;
  singles: number;
  multis: number;
  groups: StaffPickGroup[];
}

type PackerTab = "pack" | "pick" | "returns";

const PACKER_TABS: readonly { id: PackerTab; label: string }[] = [
  { id: "pack", label: "Pack" },
  { id: "pick", label: "Pick list" },
  { id: "returns", label: "Returns" },
];

const COURIER_LOCKS = [
  { id: "ALL", label: "All couriers" },
  { id: "J&T Express", label: "J&T" },
  { id: "SPX Express", label: "SPX" },
  { id: "Flash Express", label: "Flash" },
] as const;

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

function playBeep(kind: "ok" | "warn" | "error" | "multi") {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const beep = (freq: number, delay: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.value = 0.09;
      const startAt = ctx.currentTime + delay;
      osc.start(startAt);
      osc.stop(startAt + duration);
    };
    if (kind === "multi") {
      beep(740, 0, 0.09);
      beep(988, 0.11, 0.14);
      return;
    }
    beep(kind === "ok" ? 880 : kind === "warn" ? 520 : 260, 0, kind === "ok" ? 0.12 : 0.28);
  } catch {
    // Ignore audio errors on restricted browsers
  }
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
  const [todayPackedCount, setTodayPackedCount] = useState(initial.todayPackedCount);
  const [unpackedWaveCount, setUnpackedWaveCount] = useState(initial.unpackedWaveCount);
  const [pendingMissing, setPendingMissing] = useState(initial.pendingMissing);
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>(initial.recentScans);
  const [recentOpen, setRecentOpen] = useState(false);

  const [tab, setTab] = useState<PackerTab>("pack");
  const [courierLock, setCourierLock] = useState<string>("ALL");

  const [staffList, setStaffList] = useState<StaffOption[]>(initial.staffList);
  const [selectedStaffId, setSelectedStaffId] = useState(initial.staffList[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [wrongCount, setWrongCount] = useState(0);
  const [unlocking, setUnlocking] = useState(false);

  // Shared camera + barcode input state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [nativeCamera, setNativeCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lastScannedCode, setLastScannedCode] = useState("");

  // Outbound Pack mode state
  const [outboundResult, setOutboundResult] = useState<{
    pkg: StaffSafeOutboundPackage;
    evaluation: OutboundScanEvaluation;
    autoPacked: boolean;
  } | null>(null);
  const [outboundChoices, setOutboundChoices] = useState<StaffSafeOutboundPackage[]>([]);
  const [packingConfirm, setPackingConfirm] = useState(false);
  const [reprintingSn, setReprintingSn] = useState<string | null>(null);
  const [packNotice, setPackNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  // Wave Pick list & Unpacked leftovers state
  const [waveData, setWaveData] = useState<StaffWaveData | null>(null);
  const [unpackedParcels, setUnpackedParcels] = useState<StaffSafeOutboundPackage[]>([]);
  const [waveLoading, setWaveLoading] = useState(false);
  const [waveError, setWaveError] = useState("");
  const [leftoversOpen, setLeftoversOpen] = useState(false);
  const [checkedPickKeys, setCheckedPickKeys] = useState<Record<string, boolean>>({});

  // Inbound Returns mode state
  const [matchedParcel, setMatchedParcel] = useState<StaffSafeParcel | null>(null);
  const [choices, setChoices] = useState<StaffSafeParcel[]>([]);
  const [selectedCondition, setSelectedCondition] = useState<string>(DEFAULT_CONDITION);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [savingScan, setSavingScan] = useState(false);
  const [saved, setSaved] = useState<{ id: number; text: string; restocked: boolean } | null>(null);

  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectBusyRef = useRef(false);
  const lookupInFlightRef = useRef(false);
  const tabRef = useRef<PackerTab>(tab);
  const courierLockRef = useRef<string>(courierLock);

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    courierLockRef.current = courierLock;
  }, [courierLock]);

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/scan/session");
    const data = await res.json();
    if (data.unlocked) {
      setUnlocked(true);
      setActorName(data.actor?.name || "Staff");
      setIsOwnerActor(data.actor?.actorType === "owner");
      setTodayCount(data.todayCount ?? 0);
      setTodayPackedCount(data.todayPackedCount ?? 0);
      setUnpackedWaveCount(data.unpackedWaveCount ?? 0);
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
      const nextUnpacked: StaffSafeOutboundPackage[] = data.unpackedParcels ?? [];
      setUnpackedParcels(nextUnpacked);
      setUnpackedWaveCount(nextUnpacked.length);
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
    if (unlocked && (tab === "pick" || leftoversOpen)) {
      void loadWave();
    }
  }, [unlocked, tab, leftoversOpen, loadWave]);

  // The success card leaves by itself; the scanner is usable the whole time.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 3200);
    return () => clearTimeout(t);
  }, [saved]);

  useEffect(() => {
    if (!packNotice) return;
    const t = setTimeout(() => setPackNotice(null), 3000);
    return () => clearTimeout(t);
  }, [packNotice]);

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

  const applyOutboundLookup = useCallback(
    (
      pkg: StaffSafeOutboundPackage,
      evaluation: OutboundScanEvaluation,
      autoPacked: boolean,
      stats?: { todayPackedCount?: number; unpackedWaveCount?: number }
    ) => {
      setOutboundChoices([]);
      setOutboundResult({ pkg, evaluation, autoPacked });
      setManualCode("");
      if (typeof stats?.todayPackedCount === "number") {
        setTodayPackedCount(stats.todayPackedCount);
      }
      if (typeof stats?.unpackedWaveCount === "number") {
        setUnpackedWaveCount(stats.unpackedWaveCount);
      }

      if (evaluation.status === "BLOCKED_CANCELLED" || evaluation.status === "BLOCKED_WRONG_COURIER") {
        playBeep("error");
        haptic([80, 60, 80]);
      } else if (evaluation.status === "NEEDS_MULTI_CONFIRM") {
        playBeep("multi");
        haptic([20, 40, 20]);
      } else if (evaluation.status === "ALREADY_PACKED") {
        playBeep("warn");
        haptic(16);
      } else {
        playBeep("ok");
        haptic(12);
      }
    },
    []
  );

  const lookupBarcode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || lookupInFlightRef.current) return;
      lookupInFlightRef.current = true;
      setLookupError("");
      setLookingUp(true);
      try {
        await stopCamera();
        const activeTab = tabRef.current;
        const mode = activeTab === "returns" ? "return" : "outbound";
        const params = new URLSearchParams({
          code,
          mode,
          ...(mode === "outbound"
            ? { courierLock: courierLockRef.current, autoPack: "1" }
            : {}),
        });
        const res = await fetch(`/api/scan/lookup?${params.toString()}`);
        const data = await res.json();
        setChoices([]);
        setOutboundChoices([]);

        if (!res.ok || !data.found) {
          playBeep("error");
          haptic([30, 40, 30]);
          if (mode === "outbound") {
            setOutboundResult(null);
          } else {
            setMatchedParcel(null);
          }
          setLookupError(data.error || `No parcel found for ${code}. Try the last 6 digits.`);
          return;
        }

        setLastScannedCode(code);

        if (data.kind === "outbound") {
          if (Array.isArray(data.outboundMatches)) {
            setOutboundResult(null);
            setOutboundChoices(data.outboundMatches);
            playBeep("warn");
            haptic(12);
            return;
          }
          applyOutboundLookup(data.outbound, data.evaluation, Boolean(data.autoPacked), {
            todayPackedCount: data.todayPackedCount,
            unpackedWaveCount: data.unpackedWaveCount,
          });
          return;
        }

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
        lookupInFlightRef.current = false;
        setLookingUp(false);
      }
    },
    [stopCamera, openParcel, applyOutboundLookup]
  );

  async function startCamera() {
    setCameraError("");
    setLookupError("");
    setMatchedParcel(null);
    setChoices([]);
    setOutboundChoices([]);

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
                void lookupBarcode(raw);
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
            void lookupBarcode(decodedText);
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

  // Keyboard digits work on the shared warehouse PC too.
  useEffect(() => {
    if (unlocked) return;
    const onKey = (e: KeyboardEvent) => {
      const key = keyFromKeyboard(e.key);
      if (key) pressKey(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [unlocked, pressKey]);

  async function handleConfirmOutboundPack(pkg: StaffSafeOutboundPackage, ignoreLock = false) {
    setPackingConfirm(true);
    setLookupError("");
    try {
      const res = await fetch("/api/scan/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_pack",
          packageId: pkg.packageId,
          courierLock: ignoreLock ? "ALL" : courierLock,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        playBeep("error");
        setLookupError(data.error || "Couldn't mark packed.");
        return;
      }
      playBeep("ok");
      haptic(16);
      const updated = data.outbound as StaffSafeOutboundPackage;
      setOutboundResult({
        pkg: updated,
        evaluation: { status: "AUTO_PACK_OK", courierMismatch: false, expectedCourier: null },
        autoPacked: true,
      });
      if (typeof data.todayPackedCount === "number") setTodayPackedCount(data.todayPackedCount);
      if (typeof data.unpackedWaveCount === "number") setUnpackedWaveCount(data.unpackedWaveCount);
      setUnpackedParcels((prev) => prev.filter((p) => p.packageId !== pkg.packageId));
      setPackNotice({ text: `Packed ${updated.orderSn}`, tone: "ok" });
    } catch {
      setLookupError("No connection. Try again.");
    } finally {
      setPackingConfirm(false);
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
        setPackNotice({ text: data.error || "Couldn't queue reprint.", tone: "error" });
        return;
      }
      haptic(12);
      setPackNotice({ text: `Sent ${data.orderSn} to printer`, tone: "ok" });
    } catch {
      setPackNotice({ text: "No connection. Try again.", tone: "error" });
    } finally {
      setReprintingSn(null);
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
        setRecentScans((prev) => [data.recentScan as RecentScanItem, ...prev].slice(0, 8));
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
    setOutboundResult(null);
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
    setOutboundResult(null);
    setOutboundChoices([]);
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

  // ── Unlocked: Packer Station (Pack / Pick list / Returns) ─────────
  const condition = findCondition(selectedCondition);
  const needsPhotoMissing = Boolean(condition?.needsPhoto && photos.length === 0);
  const showScannerBox =
    tab === "returns"
      ? !matchedParcel
      : tab === "pack" && outboundResult?.evaluation.status !== "NEEDS_MULTI_CONFIRM";

  return (
    <div className="min-h-dvh bg-ground pb-12">
      <header className="safe-top sticky top-0 z-30 border-b border-hairline bg-white/95">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-2 px-4">
          <button
            type="button"
            onClick={() => setRecentOpen(true)}
            className="pressable -ml-1.5 flex min-w-0 flex-col items-start rounded-[10px] px-2 py-1 text-left hover:bg-black/[0.03]"
          >
            <span className="truncate text-[17px] font-bold leading-tight text-ink">{actorName}</span>
            <span className="tabular-nums text-[12px] font-medium text-ink-3">
              {todayPackedCount} packed · {todayCount} returns ›
            </span>
          </button>
          <div className="flex items-center gap-1">
            {isOwnerActor && (
              <Link href="/" className="pressable rounded-full px-2.5 py-2 text-[14px] font-semibold text-brand">
                Dashboard
              </Link>
            )}
            <Link
              href="/stock-in"
              aria-label="Shelf and stock updates"
              title="Shelf & stock"
              className="pressable flex h-11 items-center gap-1 rounded-full px-3 text-[14px] font-bold text-brand hover:bg-brand-soft"
            >
              <PackagePlus className="h-5 w-5" />
              <span>Shelf &amp; stock</span>
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

      <main className="anim-page-in mx-auto max-w-md space-y-5 px-5 pt-4">
        <SegmentedControl
          options={PACKER_TABS}
          value={tab}
          onChange={handleTabChange}
          label="Packer mode"
        />

        {packNotice && (
          <div
            role="status"
            className={`anim-fade-in rounded-[var(--radius-control)] px-4 py-3 text-[15px] font-bold ${
              packNotice.tone === "error"
                ? "bg-missing-soft text-missing-ink"
                : "bg-arrived-soft text-arrived"
            }`}
          >
            {packNotice.text}
          </div>
        )}

        {saved && (
          <div
            key={saved.id}
            role="status"
            className={`anim-rise-in flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-3.5 text-white ${
              saved.restocked
                ? "bg-arrived shadow-[0_8px_24px_-10px_rgb(4_120_87/0.6)]"
                : "bg-missing shadow-[0_8px_24px_-10px_rgb(220_38_38/0.6)]"
            }`}
          >
            <CheckDraw />
            <span className="min-w-0">
              <span className="block text-[16px] font-bold leading-tight">
                {saved.restocked
                  ? "Saved · PUT BACK ON SHELF"
                  : "Saved · PUT IN DISPUTE BIN (Do not restock)"}
              </span>
              <span className="block truncate text-[14px] text-white/90">{saved.text}</span>
            </span>
          </div>
        )}

        {/* ── TAB 1: PACK (OUTBOUND SCAN-TO-PACK) ────────────────────────── */}
        {tab === "pack" && (
          <section className="space-y-4">
            <div className="space-y-2">
              <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5" role="group" aria-label="Lock courier sack">
                {COURIER_LOCKS.map((c) => {
                  const active = courierLock === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCourierLock(c.id)}
                      className={`pressable h-10 shrink-0 rounded-full px-3.5 text-[14px] font-semibold transition-colors ${
                        active ? "bg-ink text-white" : "bg-white text-ink-2 shadow-[var(--shadow-card)]"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {courierLock !== "ALL" && (
                <p className="px-1 text-[13px] font-semibold text-brand">
                  Sack guard on: alerts if parcel isn&apos;t {courierLock}
                </p>
              )}
            </div>

            {unpackedWaveCount > 0 && (
              <button
                type="button"
                onClick={() => setLeftoversOpen(true)}
                className="pressable flex w-full items-center justify-between rounded-[var(--radius-control)] bg-failed-soft px-4 py-3 text-left text-[14px] font-bold text-amber-900"
              >
                <span className="tabular-nums">
                  {unpackedWaveCount} printed today, still unpacked
                </span>
                <span>Check ›</span>
              </button>
            )}
          </section>
        )}

        {/* ── SHARED BARCODE SCANNER (PACK & RETURNS) ────────────────────── */}
        {tab !== "pick" && showScannerBox && (
          <section className="space-y-3.5">
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
                className={`pressable flex w-full flex-col items-center justify-center gap-2.5 rounded-[var(--radius-sheet)] bg-brand text-white shadow-[0_12px_30px_-12px_rgb(15_118_110/0.7)] hover:bg-brand-hover ${
                  outboundResult ? "min-h-28" : "min-h-44"
                }`}
              >
                <ScanBarcode className={outboundResult ? "h-9 w-9" : "h-12 w-12"} strokeWidth={1.6} />
                <span className="text-[19px] font-bold">
                  {tab === "pack"
                    ? outboundResult
                      ? "Scan next waybill"
                      : "Scan shipping waybill"
                    : "Scan return waybill"}
                </span>
              </button>
            )}

            {cameraError && (
              <p className="anim-fade-in px-1 text-[15px] font-semibold text-amber-800">{cameraError}</p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void lookupBarcode(manualCode);
              }}
              className="flex gap-2"
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Tracking or order number</span>
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  enterKeyHint="search"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Or type tracking / order number"
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
          </section>
        )}

        {/* ── OUTBOUND PACK RESULTS ──────────────────────────────────────── */}
        {tab === "pack" && outboundChoices.length > 0 && (
          <div className="anim-rise-in space-y-2" role="group" aria-label="Pick the package in your hand">
            <p className="px-1 text-[15px] font-semibold text-ink-2">
              {outboundChoices.length} packages match {lastScannedCode}. Tap one:
            </p>
            <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)]">
              {outboundChoices.map((c) => {
                const first = c.lines[0];
                return (
                  <li key={c.packageId}>
                    <button
                      type="button"
                      onClick={() =>
                        applyOutboundLookup(
                          c,
                          {
                            status: c.isCancelled
                              ? "BLOCKED_CANCELLED"
                              : c.packedAt
                                ? "ALREADY_PACKED"
                                : c.isMultiPiece
                                  ? "NEEDS_MULTI_CONFIRM"
                                  : "READY_TO_PACK",
                            courierMismatch: false,
                            expectedCourier: null,
                          },
                          false
                        )
                      }
                      className="pressable flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                    >
                      <ItemThumb src={first?.imageUrl ?? null} alt={first?.shortName ?? c.orderSn} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-ink">
                          {c.totalPieces}× {first?.shortName ?? c.orderSn}
                        </span>
                        <span className="block truncate text-[14px] text-ink-3">
                          {c.orderSn} · {shortCourier(c.courier)}
                          {c.packedAt ? " · already packed" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {tab === "pack" && outboundResult && (
          <section className="anim-rise-in space-y-4">
            {outboundResult.evaluation.status === "BLOCKED_CANCELLED" && (
              <div
                role="alert"
                className="space-y-3 rounded-[var(--radius-card)] bg-missing p-5 text-white shadow-[0_8px_24px_-10px_rgb(220_38_38/0.7)]"
              >
                <div className="flex items-start gap-3">
                  <OctagonAlert className="mt-0.5 h-8 w-8 shrink-0" />
                  <div>
                    <p className="text-[20px] font-extrabold leading-tight">STOP — BUYER CANCELLED!</p>
                    <p className="mt-1 text-[15px] font-medium text-white/95">
                      Do not pack or hand to courier. Put these items back on the shelf.
                    </p>
                  </div>
                </div>
                <p className="tabular-nums text-[14px] font-semibold text-white/90">
                  Order {outboundResult.pkg.orderSn} · {shortCourier(outboundResult.pkg.courier)}
                </p>
                <ul className="space-y-2 rounded-[var(--radius-control)] bg-black/15 p-3">
                  {outboundResult.pkg.lines.map((line) => (
                    <li key={line.id} className="flex items-center gap-3">
                      <ItemThumb src={line.imageUrl} alt={line.shortName} size="sm" />
                      <span className="min-w-0 flex-1 text-[15px] font-semibold">
                        {line.quantity}× {line.shortName}
                        {line.variationName ? ` (${line.variationName})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {outboundResult.evaluation.status === "BLOCKED_WRONG_COURIER" && (
              <div
                role="alert"
                className="space-y-3 rounded-[var(--radius-card)] bg-failed-soft p-5 text-amber-950 ring-2 ring-amber-500"
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-8 w-8 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-[20px] font-extrabold leading-tight">WRONG SACK!</p>
                    <p className="mt-1 text-[15px] font-semibold">
                      This parcel is {outboundResult.pkg.courier}, not {outboundResult.evaluation.expectedCourier}.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCourierLock(outboundResult.pkg.courier);
                      void handleConfirmOutboundPack(outboundResult.pkg, true);
                    }}
                    disabled={packingConfirm}
                    className="flex-1 bg-white"
                  >
                    Switch to {shortCourier(outboundResult.pkg.courier)} &amp; Pack
                  </Button>
                  <Button variant="plain" onClick={() => setOutboundResult(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            {outboundResult.evaluation.status !== "BLOCKED_CANCELLED" &&
              outboundResult.evaluation.status !== "BLOCKED_WRONG_COURIER" && (
                <div className="overflow-hidden rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)]">
                  {outboundResult.autoPacked && (
                    <div className="flex items-center justify-between gap-2 bg-arrived px-4 py-3 text-white">
                      <span className="flex items-center gap-2 text-[16px] font-bold">
                        <PackageCheck className="h-5 w-5" />
                        Packed
                        {outboundResult.pkg.wavePosition && outboundResult.pkg.waveTotal
                          ? ` · Label #${outboundResult.pkg.wavePosition}/${outboundResult.pkg.waveTotal}`
                          : ""}
                      </span>
                      <span className="text-[13px] font-semibold text-white/90">
                        {shortCourier(outboundResult.pkg.courier)}
                      </span>
                    </div>
                  )}

                  {outboundResult.evaluation.status === "NEEDS_MULTI_CONFIRM" && (
                    <div className="flex items-center justify-between gap-2 bg-failed-soft px-4 py-3 text-amber-950">
                      <span className="flex items-center gap-2 text-[15px] font-extrabold">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                        MULTI-ITEM ORDER ({outboundResult.pkg.totalPieces} pieces) — Check every piece
                      </span>
                    </div>
                  )}

                  {outboundResult.evaluation.status === "ALREADY_PACKED" && !outboundResult.autoPacked && (
                    <div className="flex items-center gap-2 bg-failed-soft px-4 py-3 text-[15px] font-bold text-amber-950">
                      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                      <span>
                        Already packed
                        {outboundResult.pkg.packedByName ? ` by ${outboundResult.pkg.packedByName}` : ""}
                        {outboundResult.pkg.packedAt ? ` at ${manilaTime(outboundResult.pkg.packedAt)}` : ""}
                      </span>
                    </div>
                  )}

                  <div className="space-y-4 p-4">
                    <div className="flex items-center justify-between text-[13px] font-semibold text-ink-3 tabular-nums">
                      <span>{outboundResult.pkg.orderSn}</span>
                      <span>
                        {outboundResult.pkg.platform === "SHOPEE" ? "Shopee" : "TikTok"} ·{" "}
                        {shortCourier(outboundResult.pkg.courier)}
                      </span>
                    </div>

                    <ul className="divide-y divide-hairline">
                      {outboundResult.pkg.lines.map((line) => (
                        <li key={line.id} className="flex items-center gap-3.5 py-2.5 first:pt-0 last:pb-0">
                          <ItemThumb
                            src={line.imageUrl}
                            alt={line.shortName}
                            size={outboundResult.pkg.lines.length === 1 ? "xl" : "lg"}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[18px] font-bold leading-snug text-ink">
                              <span
                                className={`mr-1.5 inline-flex items-center rounded-md px-1.5 py-0.5 text-[15px] font-extrabold tabular-nums ${
                                  line.quantity > 1
                                    ? "bg-missing text-white"
                                    : "bg-slate-100 text-ink"
                                }`}
                              >
                                {line.quantity}×
                              </span>
                              {line.shortName}
                            </p>
                            {line.variationName && (
                              <p className="mt-1.5 inline-block rounded-lg bg-ink px-2.5 py-1 text-[14px] font-bold text-white">
                                {line.variationName}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className="space-y-2 pt-1">
                      {(outboundResult.evaluation.status === "NEEDS_MULTI_CONFIRM" ||
                        outboundResult.evaluation.status === "READY_TO_PACK") && (
                        <Button
                          full
                          size="lg"
                          disabled={packingConfirm}
                          onClick={() => void handleConfirmOutboundPack(outboundResult.pkg)}
                        >
                          {packingConfirm
                            ? "Saving…"
                            : outboundResult.pkg.totalPieces > 1
                              ? `Confirm all ${outboundResult.pkg.totalPieces} pieces packed`
                              : "Confirm packed"}
                        </Button>
                      )}

                      <div className="flex gap-2">
                        {outboundResult.pkg.canReprint && (
                          <Button
                            full
                            variant="secondary"
                            disabled={reprintingSn === outboundResult.pkg.orderSn}
                            onClick={() => void handleReprintLabel(outboundResult.pkg.orderSn)}
                          >
                            <Printer className="mr-2 h-4 w-4" />
                            {reprintingSn === outboundResult.pkg.orderSn ? "Sending…" : "Reprint torn label"}
                          </Button>
                        )}
                        {outboundResult.evaluation.status === "NEEDS_MULTI_CONFIRM" && (
                          <Button
                            variant="plain"
                            onClick={() => setOutboundResult(null)}
                            className="shrink-0"
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </section>
        )}

        {/* ── TAB 2: LIVE PHOTO PICK LIST ────────────────────────────────── */}
        {tab === "pick" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-extrabold text-ink">
                  {waveData ? `Wave · ${waveData.parcelCount} parcels` : "Pick list"}
                </h2>
                {waveData && (
                  <p className="text-[13px] text-ink-3 tabular-nums">
                    {waveData.singles} single · {waveData.multis} multi · {manilaDateTime(waveData.createdAt)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void loadWave()}
                disabled={waveLoading}
                aria-label="Refresh pick list"
                className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand shadow-[var(--shadow-card)]"
              >
                <RefreshCw className={`h-5 w-5 ${waveLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {waveError && <p className="text-[15px] font-semibold text-missing-ink">{waveError}</p>}

            {!waveLoading && !waveData && !waveError && (
              <div className="rounded-[var(--radius-card)] bg-white p-5 text-[15px] text-ink-3 shadow-[var(--shadow-card)]">
                No wave pick list yet. When the owner starts or previews a wave, garments and photos appear here.
              </div>
            )}

            {waveData?.groups.map((g) => (
              <div
                key={g.key}
                className="overflow-hidden rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)]"
              >
                <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
                  <span className="text-[16px] font-bold text-ink">{g.title}</span>
                  <span className="text-[13px] font-semibold text-ink-3 tabular-nums">{g.count} parcels</span>
                </div>
                <ul className="divide-y divide-hairline px-4">
                  {g.garments.map((pg) => (
                    <li key={pg.key} className="space-y-2.5 py-3.5">
                      <div className="flex items-center gap-3">
                        <ItemThumb src={pg.imageUrl} alt={pg.shortName} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-bold text-ink">{pg.shortName}</p>
                          <p className="text-[13px] font-semibold text-ink-3 tabular-nums">
                            {pg.totalQty} {pg.totalQty === 1 ? "pc" : "pcs"} total
                          </p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {pg.variants.map((v, idx) => {
                          const checkKey = `${g.key}::${v.label}`;
                          const checked = Boolean(checkedPickKeys[checkKey]);
                          const stockLink = v.garmentVariantId
                            ? `/stock-in?mode=EMPTY_SHELF&variantId=${encodeURIComponent(v.garmentVariantId)}`
                            : `/stock-in?mode=EMPTY_SHELF&q=${encodeURIComponent(pg.shortName)}`;
                          return (
                            <div key={`${checkKey}-${idx}`} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => togglePickChecked(checkKey)}
                                className={`pressable flex min-h-12 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-left transition-colors ${
                                  checked
                                    ? "bg-arrived-soft text-arrived"
                                    : "bg-surface-subtle text-ink ring-1 ring-hairline/80"
                                }`}
                              >
                                <span
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                                    checked
                                      ? "border-arrived bg-arrived text-white"
                                      : "border-hairline-strong bg-white"
                                  }`}
                                >
                                  {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                </span>
                                <span
                                  className={`inline-flex min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[14px] font-extrabold tabular-nums ${
                                    v.qty > 1 ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-hairline"
                                  }`}
                                >
                                  {v.qty}×
                                </span>
                                <span
                                  className={`min-w-0 flex-1 text-[14px] font-semibold ${
                                    checked ? "line-through opacity-75" : ""
                                  }`}
                                >
                                  {v.color ?? "Standard"}
                                </span>
                                {v.size && (
                                  <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[13px] font-bold text-ink-2 ring-1 ring-hairline">
                                    {v.size}
                                  </span>
                                )}
                              </button>
                              <Link
                                href={stockLink}
                                className="pressable shrink-0 rounded-[var(--radius-control)] bg-missing-soft px-2.5 py-2.5 text-[12px] font-bold text-missing-ink"
                              >
                                0 left?
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {/* ── TAB 3: INBOUND RETURN SCANNER ──────────────────────────────── */}
        {tab === "returns" && !matchedParcel && (
          <section className="space-y-4">
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
            {matchedParcel.lines.length > 1 ? (
              <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-white px-4 shadow-[var(--shadow-card)]">
                {matchedParcel.lines.map((line, idx) => (
                  <li key={`${line.name}-${idx}`} className="flex items-center gap-3.5 py-3">
                    <ItemThumb src={line.imageUrl} alt={line.name} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[17px] font-bold leading-snug text-ink">
                        <span className="tabular-nums">{line.quantity}× </span>
                        {line.name}
                      </p>
                      {line.variationName && (
                        <p className="mt-1 inline-block rounded-lg bg-ink px-2 py-0.5 text-[13px] font-bold text-white">
                          {line.variationName}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
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
            )}

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
                className="h-12 w-full rounded-[var(--radius-control)] bg-white px-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
              />
            </div>

            {lookupError && (
              <p role="alert" className="px-1 text-[15px] font-semibold text-missing-ink">
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

      <Sheet
        open={leftoversOpen}
        onClose={() => setLeftoversOpen(false)}
        title="Printed today, not packed"
      >
        {waveLoading ? (
          <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-100" />
        ) : unpackedParcels.length === 0 ? (
          <p className="py-6 text-[16px] text-ink-3">All printed labels from today are packed!</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {unpackedParcels.map((p) => {
              const first = p.lines[0];
              return (
                <li key={p.packageId} className="space-y-2.5 py-3.5">
                  <div className="flex items-center gap-3">
                    <ItemThumb src={first?.imageUrl ?? null} alt={first?.shortName ?? p.orderSn} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-bold text-ink">
                        {p.totalPieces}× {first?.shortName ?? p.orderSn}
                        {p.lines.length > 1 ? ` +${p.lines.length - 1} more` : ""}
                      </p>
                      <p className="truncate text-[13px] text-ink-3 tabular-nums">
                        {p.wavePosition && p.waveTotal ? `#${p.wavePosition}/${p.waveTotal} · ` : ""}
                        {shortCourier(p.courier)} · {p.trackingNumber || p.orderSn}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={packingConfirm}
                      onClick={() => void handleConfirmOutboundPack(p, true)}
                      className="h-10 flex-1 text-[14px]"
                    >
                      Mark packed
                    </Button>
                    {p.canReprint && (
                      <Button
                        variant="plain"
                        disabled={reprintingSn === p.orderSn}
                        onClick={() => void handleReprintLabel(p.orderSn)}
                        className="h-10 px-3 text-[14px]"
                      >
                        <Printer className="mr-1.5 h-4 w-4" />
                        Reprint
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
