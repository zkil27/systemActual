"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/ui/motion";
import { scrollEdges, type ScrollEdges } from "@/lib/ui/pull";

const NUDGE_KEY = "kyna:chips-nudged";

function readFlag(): boolean {
  try {
    return window.localStorage.getItem(NUDGE_KEY) === "1";
  } catch {
    return true; // No storage: never nudge rather than nudge every visit.
  }
}

function writeFlag() {
  try {
    window.localStorage.setItem(NUDGE_KEY, "1");
  } catch {
    // Private mode; fine.
  }
}

function maskFor({ start, end }: ScrollEdges): string | undefined {
  if (!start && !end) return undefined;
  const left = start ? "transparent 0, #000 24px" : "#000 0";
  const right = end ? "#000 calc(100% - 24px), transparent 100%" : "#000 100%";
  return `linear-gradient(to right, ${left}, ${right})`;
}

/**
 * A row of chips that scrolls sideways smoothly with touch, wheel, or mouse drag,
 * softly fading overflowed edges without any overlapping buttons covering chips.
 */
export function ScrollChips({
  children,
  label,
  role = "group",
  className = "-mx-5",
  rowClassName = "gap-2 px-5 py-0.5",
}: {
  children: React.ReactNode;
  label: string;
  role?: "group" | "tablist";
  /** Outer wrapper; carries the negative gutter so chips run edge to edge. */
  className?: string;
  /** The scrolling row itself; carries gap and padding. */
  rowClassName?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  const dragRef = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const next = scrollEdges(el.scrollLeft, el.scrollWidth, el.clientWidth);
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  // Chip labels change (counts, custom dates), so re-measure after every render.
  useEffect(measure);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 2) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const canForward = e.deltaY > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const canBack = e.deltaY < 0 && el.scrollLeft > 1;
      if (!canForward && !canBack) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
      ro?.disconnect();
    };
  }, [measure]);

  // One nudge per device, ever: teaches the gesture without becoming repeat motion.
  useEffect(() => {
    const el = rowRef.current;
    if (!el || readFlag() || prefersReducedMotion()) return;
    if (el.scrollWidth - el.clientWidth < 24 || el.scrollLeft > 0) return;
    writeFlag();
    const out = setTimeout(() => el.scrollTo({ left: 56, behavior: "smooth" }), 700);
    const back = setTimeout(() => {
      if (el.scrollLeft <= 60) el.scrollTo({ left: 0, behavior: "smooth" });
    }, 1350);
    return () => {
      clearTimeout(out);
      clearTimeout(back);
    };
  }, []);

  const mask = maskFor(edges);

  return (
    <div data-no-pull="" className={`relative ${className}`}>
      <div
        ref={rowRef}
        role={role}
        aria-label={label}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0 || !rowRef.current) return;
          dragRef.current = { x: e.clientX, left: rowRef.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          const el = rowRef.current;
          if (!d || !el) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) > 5) {
            d.moved = true;
            suppressClickRef.current = true;
          }
          if (d.moved) {
            el.scrollLeft = d.left - dx;
          }
        }}
        onPointerUp={() => {
          dragRef.current = null;
          if (suppressClickRef.current) {
            setTimeout(() => {
              suppressClickRef.current = false;
            }, 0);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          suppressClickRef.current = false;
        }}
        onClickCapture={(e) => {
          if (suppressClickRef.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClickRef.current = false;
          }
        }}
        className={`no-scrollbar overscroll-x-contain touch-pan-x relative flex overflow-x-auto ${rowClassName}`}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
