"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Share2, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";

/**
 * Full-screen proof photo viewer. Keeps the owner inside the app (no new tab),
 * swipes/arrows between photos, and saves or shares the file for a dispute.
 */
export function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
  fileBaseName = "proof",
}: {
  photos: string[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  fileBaseName?: string;
}) {
  const open = index !== null && photos.length > 0;
  const [touchX, setTouchX] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const i = index ?? 0;
  const url = photos[i];

  const go = useCallback(
    (step: number) => {
      if (!photos.length) return;
      onIndexChange((i + step + photos.length) % photos.length);
    },
    [i, photos.length, onIndexChange]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, onClose]);

  async function fetchFile(): Promise<File | null> {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) return null;
      const blob = await res.blob();
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      return new File([blob], `${fileBaseName}-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" });
    } catch {
      return null;
    }
  }

  async function handleSave() {
    setBusy(true);
    const file = await fetchFile();
    setBusy(false);
    if (!file) return toast("Couldn't load the photo", "error");
    const href = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  }

  async function handleShare() {
    setBusy(true);
    const file = await fetchFile();
    setBusy(false);
    if (!file) return toast("Couldn't load the photo", "error");
    const data = { files: [file], title: file.name };
    if (navigator.canShare?.(data)) {
      try {
        await navigator.share(data);
      } catch {
        // Cancelled share sheet: nothing to do.
      }
    } else {
      await handleSave();
    }
  }

  if (!open || typeof document === "undefined") return null;

  const iconBtn =
    "pressable flex h-12 w-12 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/20 disabled:opacity-50";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${i + 1} of ${photos.length}`}
      className="anim-fade-in fixed inset-0 z-[60] flex flex-col bg-black/95"
      onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <span className="tabular-nums text-[15px] font-semibold text-white/80">
          {i + 1} / {photos.length}
        </span>
        <button type="button" onClick={onClose} aria-label="Close photo" className={iconBtn}>
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={url} src={url} alt={`Proof photo ${i + 1}`} className="anim-fade-in max-h-full max-w-full object-contain" />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className={`${iconBtn} absolute left-3 top-1/2 hidden -translate-y-1/2 md:flex`}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className={`${iconBtn} absolute right-3 top-1/2 hidden -translate-y-1/2 md:flex`}
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="pressable inline-flex h-12 items-center gap-2 rounded-full bg-white/12 px-5 text-[16px] font-semibold text-white hover:bg-white/20 disabled:opacity-50"
        >
          <Download className="h-5 w-5" /> Save
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={busy}
          className="pressable inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-[16px] font-bold text-black disabled:opacity-50"
        >
          <Share2 className="h-5 w-5" /> Share
        </button>
      </div>
    </div>,
    document.body
  );
}
