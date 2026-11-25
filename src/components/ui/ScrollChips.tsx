"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const left = start ? "transparent 0, #000 40px" : "#000 0";
  const right = end ? "#000 calc(100% - 64px), transparent 100%" : "#000 100%";
  return `linear-gradient(to right, ${left}, ${right})`;
}

/**
 * A row of chips that scrolls sideways and looks like it does: the hidden side
 * fades out, a chevron button pages it along, and the very first row a device
 * sees nudges once to show it moves.
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
    return () => {
      el.removeEventListener("scroll", measure);
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

  function page(dir: 1 | -1) {
    const el = rowRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  const mask = maskFor(edges);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={rowRef}
        role={role}
        aria-label={label}
        className={`no-scrollbar relative flex overflow-x-auto ${rowClassName}`}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
      {edges.start && (
        <EdgeButton side="start" onClick={() => page(-1)} label={`Scroll ${label.toLowerCase()} back`} />
      )}
      {edges.end && <EdgeButton side="end" onClick={() => page(1)} label={`More ${label.toLowerCase()}`} />}
    </div>
  );
}

function EdgeButton({ side, onClick, label }: { side: "start" | "end"; onClick: () => void; label: string }) {
  const Icon = side === "end" ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      onClick={onClick}
      className={`anim-fade-in pressable absolute top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ground/90 text-ink-3 after:absolute after:-inset-2 after:content-[''] hover:text-ink active:bg-ink/[0.06] ${
        side === "end" ? "right-1.5" : "left-1.5"
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={2.2} />
    </button>
  );
}
