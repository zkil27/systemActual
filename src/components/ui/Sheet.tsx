"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  getSheetDepth,
  isTopSheet,
  pushSheet,
  removeSheet,
  resistDrag,
  shouldDismiss,
} from "@/lib/ui/sheet";

const EXIT_MS = 280;

let openStack: symbol[] = [];
let mountedCount = 0;
let savedBodyOverflow = "";

/**
 * Bottom sheet on phones, centred panel on desktop.
 * Slides up, closes by swiping the handle down, tapping the backdrop,
 * the close button, or Escape. Focus moves in and returns on close.
 */
export function Sheet({
  open,
  onClose,
  title,
  stickyHeader,
  footer,
  bodyClassName = "",
  panelClassName = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Visible heading and accessible name. */
  title: string;
  /** Optional non-scrolling region rendered below the header (outside drag handle). */
  stickyHeader?: React.ReactNode;
  /** Optional non-scrolling footer rendered below the scrollable body. */
  footer?: React.ReactNode;
  /** Extra classes merged onto the scrollable body container. */
  bodyClassName?: string;
  /** Extra classes merged onto the sheet dialog panel. */
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const [sheetId] = useState(() => Symbol("sheet"));
  const [zIndex, setZIndex] = useState(50);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const dragStart = useRef<{ y: number; t: number; lastY: number; lastT: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    openStack = pushSheet(openStack, sheetId);
    setZIndex(50 + getSheetDepth(openStack, sheetId) * 10);
    return () => {
      openStack = removeSheet(openStack, sheetId);
    };
  }, [open, sheetId]);

  // Mount → next frame slide in. Close → slide out, then unmount.
  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      setDrag(0);
      return;
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    let id = 0;
    id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setShown(true));
    });
    return () => cancelAnimationFrame(id);
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (mountedCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    mountedCount += 1;
    return () => {
      mountedCount = Math.max(0, mountedCount - 1);
      if (mountedCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
      restoreFocus.current?.focus?.();
    };
  }, [mounted]);

  useEffect(() => {
    if (shown) panelRef.current?.focus({ preventScroll: true });
  }, [shown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isTopSheet(openStack, sheetId)) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        // Keep Tab inside the sheet.
        const items = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]):not([tabindex="-1"]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, sheetId]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const now = performance.now();
    dragStart.current = { y: e.clientY, t: now, lastY: e.clientY, lastT: now };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = dragStart.current;
    if (!s) return;
    s.lastY = e.clientY;
    s.lastT = performance.now();
    setDrag(resistDrag(e.clientY - s.y));
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const s = dragStart.current;
      dragStart.current = null;
      setDragging(false);
      if (!s) return;
      const dy = e.clientY - s.y;
      const dt = Math.max(1, performance.now() - s.t);
      const height = panelRef.current?.offsetHeight ?? 600;
      if (shouldDismiss(dy, dy / dt, height)) {
        onClose();
      } else {
        setDrag(0);
      }
    },
    [onClose]
  );

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{ zIndex }}
      className="fixed inset-0 flex items-end justify-center md:items-center md:p-6"
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/45 transition-opacity duration-300 dark:bg-black/65 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-motion="slide"
        className={`relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[var(--radius-sheet)] bg-surface shadow-[var(--shadow-sheet)] outline-none md:rounded-[var(--radius-sheet)] ${
          dragging
            ? ""
            : `transition-[translate,transform,opacity] ease-[var(--ease-ios)] ${
                // Exit is quicker than entrance and finishes before unmount.
                shown ? "duration-[350ms]" : "duration-[260ms]"
              }`
        } ${
          shown
            ? "translate-y-0 opacity-100"
            : "translate-y-full motion-reduce:opacity-0 md:translate-y-6 md:opacity-0"
        } ${panelClassName}`}
        style={shown && drag !== 0 ? { transform: `translateY(${drag}px)` } : undefined}
      >
        {/* Grab area: handle + title. Dragging here pulls the sheet down. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="shrink-0 cursor-grab touch-none select-none px-5 pb-2 pt-2.5 active:cursor-grabbing"
        >
          <div aria-hidden="true" className="mx-auto h-[5px] w-9 rounded-full bg-hairline-strong md:hidden" />
          <div className="mt-2 flex items-center justify-between gap-3 md:mt-1">
            <h2 className="text-[20px] font-extrabold tracking-[-0.01em] text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close"
              className="pressable -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface-muted"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted">
                <X className="h-4 w-4" strokeWidth={2.6} />
              </span>
            </button>
          </div>
        </div>
        {stickyHeader && <div className="shrink-0 px-5 pb-3">{stickyHeader}</div>}
        <div
          className={`${footer ? "" : "safe-bottom "}min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 ${bodyClassName}`}
        >
          {children}
        </div>
        {footer && (
          <div className="safe-bottom shrink-0 border-t border-hairline px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
